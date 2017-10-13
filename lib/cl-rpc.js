'use strict';

const config       = require( './config.js' ),
      crypto       = require( 'crypto' ),
      exec         = require( 'child_process' ).exec,
      fs           = require( 'fs-extra' ),
      os           = require( 'os' ),
      path         = require( 'path' ),
      queue        = require( 'async' ).queue,
      util         = require( 'util' ),
      psTree       = util.promisify( require('ps-tree') );

// variable to enumerate actions for logging
let actionsCounter = 0;

// object storing all currently running actions
const ongoingActions = {}; // with 'handle' as index
const ongoingActions2 = {}; // with actionParameters hash as index

exports = module.exports = config;

const fullPath = config.fullPath;
let emitLog = false;
let logToConsole = true;
let settings = config.getSettings();

exports.setEmitLog = bool => { emitLog = bool; };
exports.setLogToConsole = bool => { logToConsole = bool; };

function log ( message ) {

	if ( logToConsole ) console.log( message );
	if ( emitLog ) exports.emit( "log", message.toString() );

}

config.on( "actions updated", obj => settings = obj );
config.on( "log", log );

async function manageActions( POST ) {

	switch ( POST.manage ) {

	case "kill" :

		const handle = ongoingActions[ POST.actionHandle ];

		if ( !handle ) throw "handle to kill not found";

		log( "kill requested : " + POST.actionHandle );

		const proc = handle.childProcess;

		if ( !proc ) {

			handle.toKill = true;
			return ( { status : 'killing defered' } );

		}

		proc.stdout.pause();
		proc.stderr.pause();

		log( "Killing master process : " + proc.pid );

		for ( let child of await psTree( proc.pid ) ) {

			log( 'killing process ' + child.PID );
			process.kill( child.PID );

		}

		proc.kill();
		return ( { status : 'killed' } );

	case "list" :
	default:

		return JSON.parse( JSON.stringify( { ongoingActions },
			( k, v ) =>  ( ( k !== "childProcess" ) ? v : undefined ) ) );

	}	

}

const actionsQueue = queue( (task, cb ) =>
	new RPC().execute( task, cb ), os.cpus().length );

actionsQueue.pushAsync = util.promisify( actionsQueue.push.bind( actionsQueue ) );

exports.execute = async function ( POST, callback ) {

	try {

		const handle = POST.handle  = '' + POST.handle || Math.random();
		ongoingActions[ handle ] =  { POST };

		let msg;

		if ( POST.manage ) {

			msg = await manageActions( POST );

		} else {

			const action = settings.actions[ POST.action ];

			if ( action.lib === "base" ) {

				msg = await new RPC().execute( POST );

			} else {

				msg = await actionsQueue.pushAsync( POST );

			}

		}

		msg.handle = handle;
		delete ongoingActions[ handle ];
		if ( callback ) callback( msg )
			else return msg;

	} catch ( err ) {

		try { delete ongoingActions[ POST.handle ];	} catch ( e ) {}

		log( err );

		if ( callback ) callback( err )
			else throw( err )

	}

};

const actionsDirectoriesQueue = queue( async function( task ) {

	const file = fullPath( "actions/counter.json" );
	let index = 1;

	try { index = JSON.parse( await fs.readFile( file ) ).value + 1; }
		catch ( e ) {}

	await fs.writeFile( file, JSON.stringify( { value : index } ) );
	return path.join( "actions", index + "" );

} );

actionsDirectoriesQueue.pushAsync = util.promisify( actionsDirectoriesQueue.push );

function RPC() {};

RPC.prototype.execute = async function ( POST, callback ) {

	try {

		this.id = actionsCounter++;
		this.action = settings.actions[ POST.action ];
		if ( !this.action ) throw { error : "action " + POST.action + " not found" };
		this.POST = POST;
		this.POSTFiles = {};
		this.MTime = -1;
		this.response = { };
		const startTime = new Date().getTime();
		this.commandLine = "nice " + ( this.action.engine || '' ) + " "
			+ ( this.action.executable || this.action.command );
		this.log( "handle : " + this.POST.handle );

		// array used to store concurrent similar actions
		this.similarActions = [];
		this.parseParameters();

		await Promise.all( [ 

			this.handleDependenciesMTime(),
			this.handleExtraCacheMTime(),
			this.handleInputMTimes(),
			this.handleOutputDirectory(),

		] );

		if ( this.MTime > 0 ) this.response.timeStamp = this.MTime;
		this.log( 'in : ' + this.outputDir );
		this.log( this.commandLine.substr( 0, 500 ) );

		if ( await this.isInCache() ) {

			await this.replayActionFromCache();
			this.response.status = 'CACHED';
			this.log( "cached" );

		} else {

			await this.executeAction();
			this.response.status = 'OK (' + ( new Date().getTime() - startTime ) / 1000 + 's)';
			this.log( "done" );

		}

	} catch ( err ) {

		if ( err.killed ) {

			this.response.killed = true;
			this.log( "killed" );
			this.response.status = 'KILLED';

		} else {

			this.response.status = "ERROR";
			this.response.error = err;
			this.log( "error for:" );
			this.log( this.commandLine );
			this.log( err );

		}

	}

	if ( callback ) callback( null, this.response )
		else return this.response;

};

RPC.prototype.log = function ( msg ) {

	if ( this.POST.silent ) return;
	log( "[" + this.id + "] " + msg );

};

function validateValue ( value, parameter ) {

	for ( let bound of [ 'min', 'max' ] ) {

		if ( !parameter[ bound ] ) continue;

		const compare = parseFloat( parameter[ bound ] );

		if ( bound === 'min' ? value < compare : value > compare ) {

			return ( 'error for parameter ' + parameter.name +
				' : ' + bound + ' value is ' + compare )

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

	if ( parameter.text !== undefined ) return parameter.text;

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
		( typeof parameter.defaultValue !== "undefined" ) ) {

		value = parameter.defaultValue;

	}

	if  ( value === undefined || value === null ) {

		if ( parameter.required ) throw "parameter " + parameter.name + " is required!";
		return;

	}

	if ( !parameter.type ) throw "parameter \"" + parameter.name +
		"\" needs a \"type\" field, please check JSON file";

	if ( parameter.type.indexOf( "Array" ) < 0 ) value = value.toString();

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

	const cache = this.POST.cache || [];
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

		dir = await actionsDirectoriesQueue.pushAsync( { } );
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

};

RPC.prototype.isInCache = async function ( ) {

	const params = { action : this.POST.action, output_directory :  this.outputDir };

	if ( this.action.output ) {

		const outputFiles = this.action.output;

		for ( let output of Object.keys( outputFiles ) ) {

			const field = 'output' + output[ 0 ].toUpperCase() + output.slice( 1 );

			params[ field ] = this.response[ field ] = path.join(
				this.outputDir, outputFiles[ output ] );

		}

	}

	for ( let parameter of this.action.parameters ) {

		params[ parameter.name ] = this.POST[ parameter.name ];

	}

	this.parametersString = JSON.stringify( params );

	if ( this.action.voidAction || this.POST.force_update
		|| this.POST.forceUpdate || this.action.noCache ) return;

	// check if action was already performed
	const actionFile = fullPath( this.outputDir, "action.json" );

	try {

		const stats = await fs.stat( actionFile )
		return ( stats.mtime.getTime() >= this.MTime ) &&
			( await fs.readFile( actionFile ) == this.parametersString );

	} catch ( e ) { }

};

RPC.prototype.replayActionFromCache = async function () {

	const now = new Date();

	const promises = [

		fs.utimes( fullPath( this.outputDir, "action.json" ), now, now ),
		fs.utimes( fullPath( this.outputDir ), now, now )

	];

	if ( this.POST.stdout ) {

		for ( let extension of [ 'log', 'err' ] ) {

			promises.push( fs.readFile( fullPath(
				this.outputDir, 'action.' + extension ) ) );

		}

	} else {

		this.response.stdout = 'stdout and stderr not included. Launch action with parameter stdout=true';

	}

	const [ , , stdout, stderr ] = await Promise.all( promises );

	if ( stdout ) {

		this.response.stdout = stdout.toString();
		this.response.stderr = stderr.toString();

	}

};

RPC.prototype.executeAction = async function () {

	this.writeJSON = false;
	const outputDirectory = this.outputDir || "";

	const commandOptions = {

		cwd: fullPath( outputDirectory ),
		maxBuffer : 1e10,
		env : Object.assign( {}, process.env, this.action.env )

	};

	if ( !this.action.voidAction ) this.writeJSON = true;
	const shasum = crypto.createHash( 'sha1' );
	shasum.update( this.parametersString + outputDirectory );
	const hash = shasum.digest( 'hex' );
	const opts = ongoingActions[ this.POST.handle ];

	if ( opts.toKill ) {

		this.log( "execution aborted due to kill request" );
		await this.afterExecution( { killed : true } );
		return;

	}

	opts.RPC = this;

	const existingOpts = ongoingActions2[ hash ];

	if ( existingOpts ) {

		opts.childProcess = existingOpts.childProcess;
		const promise = new Promise ( res => { opts.callback = res; } );
		existingOpts.RPC.similarActions.push( opts );
		this.log( "same as action [" + existingOpts.RPC.id + "], wait for its completion" );
		const res = await promise;
		this.writeJSON = false;
		await this.afterExecution( res.err, res.stdout, res.stderr );		

	} else if ( typeof ( this.action.module ) === "object" ) {

		const params = Object.assign( JSON.parse( this.parametersString ), this.POSTFiles );
		params.output_directory =  fullPath( outputDirectory );
		const response = await this.action.module.executeAsync( params );
		await this.afterExecution( null, response );

	} else {

		let child ;

		const promise = new Promise ( resolve => {

			child = opts.childProcess = exec( this.commandLine, commandOptions,
				( err, stdout, stderr ) => resolve ( { err, stdout, stderr } ) );

		} );

		ongoingActions2[ hash ] = opts;

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

		const res = await promise;
		delete ongoingActions2[ hash ];

		if ( logStream ) {

			logStream.end();
			logStream2.end();

		}

		await this.afterExecution( res.err, res.stdout, res.stderr );

	}
};

RPC.prototype.afterExecution = async function( err, stdout, stderr ) {

	if ( this.POST.stdout ) {

		this.response.stdout = stdout;
		this.response.stderr = stderr;

	} else {

		this.response.stdout = 'stdout and stderr not included. Launch action with parameter stdout=true';

	}

	for ( let opts of this.similarActions ) {

		this.log( "completion for similar action [" + opts.RPC.id + "]" );
		opts.callback( { err, stdout, stderr } );

	}

	if ( err ) throw err;
	if ( !this.writeJSON ) return;

	// Touch output directory to avoid automatic deletion
	const now = new Date();

	await Promise.all( [

		fs.utimes( fullPath( this.outputDir ), now, now ),
		fs.writeFile( fullPath( this.outputDir, "action.json" ),
			this.parametersString )

	] );

};
