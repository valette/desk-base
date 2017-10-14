'use strict';

const config    = require( './config.js' ),
      crypto    = require( 'crypto' ),
      exec      = require( 'child_process' ).exec,
      fs        = require( 'fs-extra' ),
      nCPUS     = require( 'os' ).cpus().length,
      path      = require( 'path' ),
      promisify = Promise.promisify || require( 'util' ).promisify,
      queue     = require( 'async' ).queue,
      kill      = promisify( require( 'tree-kill') );

exports = module.exports = config;

// variable to enumerate actions for logging
let actionsCounter = 0;

// object storing all currently running actions
const ongoingActions = {}; // with 'handle' as index
const ongoingActions2 = {}; // with actionParameters hash as index

const fullPath = config.fullPath;
let emitLog = false;
let logToConsole = true;
let settings = config.getSettings();

exports.setEmitLog = bool => { emitLog = bool; };
exports.setLogToConsole = bool => { logToConsole = bool; };

function log ( message ) {

	if ( emitLog ) return exports.emit( "log", message );
	if ( logToConsole ) console.log( message );

}

config.on( "actions updated", obj => settings = obj );
config.on( "log", msg => { if ( logToConsole ) console.log( msg ) });

const actionsQueue = queue( async task => await new RPC().execute( task ), nCPUS);
actionsQueue.pushAsync = promisify( actionsQueue.push.bind( actionsQueue ) );

exports.execute = async function ( POST, callback ) {

	let handle

	try {

		handle = POST.handle  = '' + ( POST.handle || Math.random() );

		let msg;

		if ( POST.manage ) {

			msg = await manageActions( POST );

		} else {

			if ( POST.action === undefined ) throw "action name is missing";
			const action = settings.actions[ '' + POST.action ];

			if ( action && action.lib === "base" ) {

				msg = await new RPC().execute( POST );

			} else {

				msg = await actionsQueue.pushAsync( POST );

			}

		}

		msg.handle = handle;

		if ( callback ) callback( msg )
			else return msg;

	} catch ( err ) {

		log( 'Error ' );
		log( err );
		if ( callback ) callback( { handle, error : err } )
			else return( { handle, error : err } )

	}

};

async function manageActions( POST ) {

	switch ( POST.manage ) {

	case "kill" :

		const action = ongoingActions[ POST.actionHandle ];

		if ( !action ) throw "handle to kill not found : " + POST.actionHandle;

		log( "kill requested : " + POST.actionHandle );

		const childProcess = action.childProcess;

		if ( !childProcess ) {

			action.toKill = true;
			return ( { status : 'killing defered' } );

		}

		childProcess.killedByMe = true;
		childProcess.stdout.pause();
		childProcess.stderr.pause();
		await kill( childProcess.pid );
		return ( { status : 'killed' } );

	case "list" :
	default:

		return JSON.parse( JSON.stringify( { ongoingActions },
			( k, v ) =>  ( ( k !== "childProcess" ) ? v : undefined ) ) );

	}

}

const actionsDirectoriesQueue = queue( async function() {

	const file = fullPath( "actions/counter.json" );
	let index = 1;

	try { index = JSON.parse( await fs.readFile( file ) ).value + 1; }
		catch ( e ) {}

	await fs.writeFile( file, JSON.stringify( { value : index } ) );
	return path.join( "actions", index + "" );

} );

actionsDirectoriesQueue.pushAsync = promisify( actionsDirectoriesQueue.push );

function RPC() {};

RPC.prototype.execute = async function ( POST ) {

	const response = this.response = { };
	this.POST = POST;
	ongoingActions[ POST.handle ] =  this;

	try {

		this.id = actionsCounter++;
		this.log( "action : " + POST.action + ", handle : " + POST.handle );
		const action = this.action = settings.actions[ POST.action ];
		if ( !action ) throw "action '" + POST.action + "' not found";
		this.POSTFiles = {};
		const time = new Date().getTime();

		this.commandLine = "nice " + ( action.engine || '' ) + " "
			+ ( action.executable || action.command );

		this.parseParameters();
		this.MTime = -1;

		await Promise.all( [ 

			this.handleDependenciesMTime(),
			this.handleExtraCacheMTime(),
			this.handleInputMTimes(),
			this.handleOutputDirectory(),

		] );

		if ( this.MTime > 0 ) response.timeStamp = this.MTime;
		this.log( this.commandLine.substr( 0, 500 ) );

		if ( await this.isInCache() ) {

			await this.replayActionFromCache();
			response.status = 'CACHED';
			this.log( "cached" );

		} else {

			this.promise = this.executeAction();
			await this.promise;
			response.status = 'OK (' + ( new Date().getTime() - time ) / 1000 + 's)';
			this.log( "done" );

		}

	} catch ( err ) {

		if ( this.childProcess && this.childProcess.killedByMe ) {

			response.killed = true;
			this.log( "killed" );
			response.status = 'KILLED';

		} else {

			response.status = "ERROR";
			response.error = err;
			this.log( "error for:" );
			this.log( this.commandLine );
			log( err );

		}

	}

	try { delete ongoingActions[ POST.handle ];	} catch ( e ) {}

	return response;

};

RPC.prototype.log = function ( msg ) {

	if ( !this.POST.silent ) log( "[" + this.id + "] " + msg );

};

function validateValue ( value, parameter ) {

	for ( let bound of [ 'min', 'max' ] ) {

		if ( !parameter.hasOwnProperty( bound ) ) continue;

		const compare = parseFloat( parameter[ bound ] );

		if ( bound === 'min' ? value < compare : value > compare ) {

			throw 'error for parameter ' + parameter.name +
				' : ' + bound + ' value is ' + compare;

		}

	}

}

RPC.prototype.parseParameters = function () {

	for ( let parameter of this.action.parameters ) {

		const value = this.parseParameter( parameter );
		if ( typeof value !== "string" ) continue;
		let prefix = parameter.prefix;
		if ( typeof prefix !== 'string' ) prefix = '';
		let suffix = parameter.suffix;
		if ( typeof suffix !== 'string' ) suffix = '';
		this.commandLine += ' '+ prefix + value +  suffix;

	}

};

RPC.prototype.parseParameter = function ( parameter ) {

	if ( parameter.hasOwnProperty( "text" ) ) return parameter.text;

	let value = this.POST[ parameter.name ];

	if ( ( value === undefined ) && ( parameter.aliases ) ) {

		for ( let alias of parameter.aliases ) {

			const value2 = this.POST[ alias ];
			if ( value2 !== undefined ) {

				value = value2;
				break;

			}

		}

	}

	if ( ( value === undefined || value === null ) &&
		parameter.hasOwnProperty( 'defaultValue' ) ) {

		value = parameter.defaultValue;

	}

	if  ( value === undefined || value === null ) {

		if ( parameter.required ) throw "parameter " + parameter.name + " is required!";
		return;

	}

	if ( !parameter.type ) throw "parameter \"" + parameter.name +
		"\" needs a \"type\" field, please check JSON file";

	if ( !parameter.type.includes( "Array" ) ) value = value.toString();

	switch ( parameter.type ) {

	case 'file':
	case 'directory':

		const dir = fullPath( value );
		this.POSTFiles[ parameter.name ] = dir;
		return dir.split( " " ).join( "\\ " );

	case 'fileArray':

		if ( files.some( file => !file ) ) throw 'one file is empty';

		const files = value.map( file => fullPath( file ) );
		this.POSTFiles[ parameter.name ] = files;
		return files.map( file => file.split(" ").join("\\ ") ).join(" ");

	case 'int':

		const intNumber = parseInt( value, 10 );

		if ( isNaN( intNumber ) )
			throw "parameter " + parameter.name + " must be an int";

		validateValue( intNumber, parameter );
		return value;

	case 'float':

		const floatNumber = parseFloat( value );

		if ( isNaN( floatNumber ) )
			throw "parameter " + parameter.name + " must be a float";

		validateValue( floatNumber, parameter );
		return value;

	case 'text':
	case 'string':
	case 'base64data':

		return value.split( " " ).join( "\\ " );

	case 'flag' :

		value = '' + value;

		switch( value ){

			case "true":
			case "yes":
			case "1":
			case "false":
			case "no":
			case "0":

				return '';

			default:

				throw "parameter " + parameter.name + " must be a bool";
		}

	default:

		throw "parameter type not handled : " + parameter.type;

	}

};

RPC.prototype.handleDependenciesMTime = async function ( ) {

	const included = {};
	const dependencies = [];

	function includeAction( action ) {

		if ( included[ action ] ) return;

		const deps = action.dependencies || [];

		for ( let dependency of [ action.executable, ...deps ] ) {

			if ( !dependency || included[ dependency ] ) continue;

			if ( dependency.includes( '/' ) ) {

				// dependency is a file
				dependencies.push( dependency );

			} else {

				// dependency is an action
				includeAction( dependency );

			}

		}

	}

	includeAction( this.action );
	await Promise.all( dependencies.map( dep => this.addMTime( dep ) ) );

}

RPC.prototype.handleExtraCacheMTime = async function () {

	const cache = this.POST.cache;
	if ( !cache ) return;
	await Promise.all( cache.map ( file => this.addMTime( fullPath( file ) ) ) );

};

RPC.prototype.addMTime = async function ( file ) {

	try {

		const stats = await fs.stat( file );
		if ( !stats.isFile() ) return;
		this.MTime = Math.max( stats.mtime.getTime(), this.MTime );

	} catch ( e ) {  }

};

RPC.prototype.handleInputMTimes = async function ( ) {

	await Promise.all( this.action.parameters.map ( async parameter => {

		const value = this.POST[ parameter.name ];
		if ( value === undefined ) return;

		switch ( parameter.type ) {

			case "file":
			case "directory" :

				await this.addMTime( fullPath( value.toString() ) );

				break;

			case "fileArray" :

				await Promise.all( value.map( async ( file ) => {

					await this.addMTime( fullPath( file.toString() ) );

				} ) );

				break;

			default :
		}

	} ) );

};

RPC.prototype.handleOutputDirectory = async function () {

	if ( this.action.voidAction ) return;

	if ( settings.permissions === 0 )  this.POST.output_directory = "cache/";

	let dir = this.POST.outputDirectory || this.POST.output_directory || "";

	switch ( dir ) {

	case "actions/" :

		dir = await actionsDirectoriesQueue.pushAsync( {} );
		break;

	case "cache/" :
	case "" : 

		const shasum = crypto.createHash( 'sha1' );
		shasum.update( this.commandLine );
		const hash = shasum.digest( 'hex' );
		dir = path.join( "cache", hash.charAt(0), hash.charAt(1), hash );
		break;

	default :

		await exports.validatePathAsync( path.normalize( dir ).split( "/" )[ 0 ] );

	}

	dir = path.normalize( dir ) + "/";
	await fs.mkdirs( fullPath( dir ) );
	this.response.outputDirectory = dir;

	if ( this.POST.stream ) {

		exports.emit( "actionEvent", {

			handle : this.POST.handle,
			type : "outputDirectory",
			data : dir

		} );

	}

	this.outputDir = dir;
	this.log( 'in : ' + this.outputDir );

};

RPC.prototype.isInCache = async function ( ) {

	const params = { action : this.POST.action, output_directory :  this.outputDir };
	this.filteredPOST = params;

	for ( let [ key, value ] of Object.entries( this.action.output || {} ) ) {

		const field = 'output' + key[ 0 ].toUpperCase() + key.slice( 1 );

		params[ field ] = this.response[ field ] = path.join( this.outputDir, value );

	}

	for ( let parameter of this.action.parameters ) {

		params[ parameter.name ] = this.POST[ parameter.name ];

	}

	this.parametersString = JSON.stringify( params );

	if ( this.action.voidAction || this.POST.force_update
		|| this.POST.forceUpdate || this.action.noCache ) return;

	try {

		const file = fullPath( this.outputDir, "action.json" );

		return ( ( await fs.stat( file ) ).mtime.getTime() >= this.MTime ) &&
			( await fs.readFile( file ) == this.parametersString );

	} catch ( e ) { }

};

RPC.prototype.replayActionFromCache = async function () {

	const now = new Date();

	// touch output directory to avoid automatic deletion
	const promises = [

		fs.utimes( fullPath( this.outputDir, "action.json" ), now, now ),
		fs.utimes( fullPath( this.outputDir ), now, now )

	];

	if ( this.POST.stdout ) {

		for ( let extension of [ 'log', 'err' ] ) {

			promises.push( fs.readFile( 
				fullPath( this.outputDir, 'action.' + extension ) ) );

		}

	}

	const [ , , stdout, stderr ] = await Promise.all( promises );

	this.response.stdout = stdout ? stdout.toString() : undefined;
	this.response.stderr = stderr ? stderr.toString() : undefined;

};

RPC.prototype.executeAction = async function () {

	if ( this.toKill ) {

		this.childProcess = { killedByMe : true };
		this.log( "execution aborted due to kill request" );
		throw "killed";

	}

	const outputDirectory = this.outputDir || "";
	const shasum = crypto.createHash( 'sha1' );
	shasum.update( this.parametersString + outputDirectory );
	const hash = shasum.digest( 'hex' );
	const runningAction = ongoingActions2[ hash ];

	let res;

	if ( runningAction ) {

		this.childProcess = runningAction.childProcess;
		this.log( "same as action [" + runningAction.id + "]" );
		res = await runningAction.promise;

	} else if ( typeof ( this.action.module ) === "object" ) {

		const params = Object.assign( this.filteredPOST, this.POSTFiles );
		params.output_directory =  fullPath( outputDirectory );
		res = await this.action.module.executeAsync( params );

	} else {

		let child ;

		const options = {

			cwd: fullPath( outputDirectory ),
			maxBuffer : 1e10,
			env : Object.assign( {}, process.env, this.action.env )

		};

		const promise = new Promise ( resolve => {

			child = this.childProcess = exec( this.commandLine, options,
				( err, stdout, stderr ) => resolve ( { err, stdout, stderr } ) );

		} );

		ongoingActions2[ hash ] = this;

		if ( this.POST.stream ) {

			this.log( "will stream stdout and stderr to client" );

			for ( let type of [ "stdout", "stderr" ] ) {

				child[ type ].on( "data", data => exports.emit( "actionEvent",
					 { type, handle : this.POST.handle, data } ) );

			}

		}

		let logStream, logStream2;

		if ( this.outputDir ) {

			logStream = fs.createWriteStream( fullPath(
				this.outputDir, "action.log" ) );
			logStream2 = fs.createWriteStream( fullPath(
				this.outputDir, "action.err" ) );
			child.stdout.pipe( logStream );
			child.stderr.pipe( logStream2 );

		}

		res = await promise;
		delete ongoingActions2[ hash ];

		if ( !res.err && logStream ) {

			logStream.end();
			logStream2.end();

			const now = new Date();

			await Promise.all( [

				fs.utimes( fullPath( this.outputDir ), now, now ),
				fs.writeFile( fullPath( this.outputDir, "action.json" ),
					this.parametersString )

			] );

		}

	}

	this.response.stdout = this.POST.stdout ? res.stdout : undefined;
	this.response.stderr = this.POST.stdout ? res.stderr : undefined;
	if ( res.err ) throw res.err;
	return res;

};
