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

		if ( !handle ) throw "not found";

		log( "kill requested : " + POST.actionHandle );

		const proc = handle.childProcess;

		if ( proc ) {

			proc.stdout.pause();
			proc.stderr.pause();

			log( "Killing master process : " + proc.pid );

			for ( let child of await psTree( proc.pid ) ) {

				log( 'killing process ' + child.PID );
				process.kill( child.PID );

			}

			proc.kill();
			return ( { status : 'killed' } );

		} else {

			handle.toKill = true;
			return ( { status : 'killing defered' } );

		}

		return;

	case "list" :
	default:

		// we need to remove circular dependencies before sending the list
		const cache = [];

		const objString = JSON.stringify( { ongoingActions },
			function( key, value ) {
				if (typeof value === 'object' && value !== null) {
					if (cache.indexOf(value) !== -1) {
						// Circular reference found, discard key
						return;
					}
					// Store value in our collection
					cache.push( value );
				}
				return value;
			}
		);

		return JSON.parse( objString );

	}	

}

const actionsQueue = queue( (task, cb ) => new RPC().execute( task, cb ), os.cpus().length );
actionsQueue.pushAsync = util.promisify( actionsQueue.push.bind( actionsQueue ) );

exports.execute = async function ( POST, callback ) {

	try {

		POST.handle  = POST.handle || Math.random().toString();
		ongoingActions[ POST.handle ] =  { POST };

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

		delete ongoingActions[ POST.handle ];
		if ( callback ) callback( msg );

	} catch ( e ) {

		if ( callback ) callback( e );

	}

};

const actionsDirectoriesQueue = queue( async function( task ) {

	const counterFile = fullPath( "actions/counter.json" );
	let index = 1;

	try {

		index = JSON.parse( await fs.readFile( counterFile ) ).value + 1;

	} catch ( e ) {}

	await fs.writeFile( counterFile, JSON.stringify( { value : index } ) );
	return path.join( "actions", index + "" );

} );

actionsDirectoriesQueue.pushAsync = util.promisify( actionsDirectoriesQueue.push );

function RPC( ) {};

RPC.prototype.execute = async function ( POST, callback ) {

	try {

		this.id = actionsCounter++;
		this.action = settings.actions[ POST.action ];
		if ( !this.action ) throw { error : "action " + POST.action + " not found" };
		this.POST = POST;
		this.POSTFiles = {};
		this.inputMTime = -1;
		this.response = { handle : POST.handle };
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

		this.log( 'in : ' + this.outputDirectory );
		this.log( this.commandLine.substr( 0, 500 ) );

		if ( await this.isInCache() ) {

			await this.replayAction();
			this.response.status = 'CACHED';
			this.log( "cached" );

		} else {

			await this.executeAction( );
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
			console.log( err);
		}

	}

	if ( callback ) callback( this.response );
	return this.response;

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

		if ( isNaN( intNumber ) ) throw "parameter " + parameter.name + " must be an integer value";

		validateValue( intNumber, parameter );
		return value;

	case 'float':

		const floatNumber = parseFloat( value );

		if ( isNaN( floatNumber ) ) throw "parameter " + parameter.name + " must be a floating point value";

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

				throw "parameter " + parameter.name + " must be a boolean";
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

	await Promise.all( dependencies.map( dependency => {

		this.addMTime( dependency );

	} ) );

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

		this.inputMTime = Math.max( stats.mtime.getTime(), this.inputMTime );

	} catch ( e ) {  }

};

RPC.prototype.handleInputMTimes = async function ( ) {

	await Promise.all( this.action.parameters.map ( async parameter => {

		if ( this.POST[ parameter.name ] === undefined ) return;

		switch ( parameter.type ) {

			case "file":
			case "directory" :

				await this.addMTime( fullPath(
					this.POST[ parameter.name ].toString() ) );

				break;

			case "fileArray" :

				await Promise.all( this.POST[ parameter.name ].map( async (file) => {

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

	if ( this.inputMTime > 0 ) this.response.timeStamp = this.inputMTime;

	let outputDirectory = this.POST.outputDirectory || this.POST.output_directory || "";


	switch ( outputDirectory ) {

	case "actions/" :

		outputDirectory = await actionsDirectoriesQueue.pushAsync( { } );
		break;

	case "cache/" :
	case "" : 

		const shasum = crypto.createHash( 'sha1' );
		shasum.update( this.commandLine );
		const hash = shasum.digest( 'hex' );
		outputDirectory = path.join( "cache", hash.charAt(0), hash.charAt(1), hash );
		break;

	default :

		await exports.validatePathAsync( path.normalize(
			outputDirectory ).split( "/" )[ 0 ] );

	}

	outputDirectory = path.normalize( outputDirectory );

	if ( outputDirectory.charAt( outputDirectory.length -1 ) !== "/" ) {

		outputDirectory += "/";

	}

	await fs.mkdirs( fullPath( outputDirectory ) );

	this.response.outputDirectory = outputDirectory;

	if ( this.POST.stream ) {

		exports.emit( "actionEvent", {

			handle : this.POST.handle,
			type : "outputDirectory",
			data : outputDirectory

		} );

	}

	this.outputDirectory = outputDirectory;

};

RPC.prototype.isInCache = async function ( ) {

	const params = { action : this.POST.action, output_directory :  this.outputDirectory };

	if ( this.action.output ) {

		const outputFiles = this.action.output;

		for ( let output of Object.keys( outputFiles ) ) {

			const field = 'output' + output[ 0 ].toUpperCase() + output.slice( 1 );
			params[ field ] = this.response[ field ] = path.join( this.outputDirectory, outputFiles[ output ] );

		}

	}

	for ( let parameter of this.action.parameters ) {

		params[ parameter.name ] = this.POST[ parameter.name ];

	}

	this.parametersString = JSON.stringify( params );

	if ( this.action.voidAction || this.POST.force_update
		|| this.POST.forceUpdate || this.action.noCache ) return;

	// check if action was already performed
	const actionFile = fullPath( this.outputDirectory, "action.json" );

	try {

		const stats = await fs.stat( actionFile )
		return ( stats.mtime.getTime() >= this.inputMTime ) &&
			( await fs.readFile( actionFile ) == this.parametersString );

	} catch ( e ) { }

};

RPC.prototype.executeAction = async function () {

	this.writeJSON = false;

	const outputDirectory = this.outputDirectory || "";

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
	let err, stdout, stderr;

	if ( existingOpts ) {

		opts.childProcess = existingOpts.childProcess;

		const promise = new Promise ( resolve => { opts.callback = resolve; } );

		existingOpts.RPC.similarActions.push( opts );
		this.log( "same as action [" + existingOpts.RPC.id + "], wait for its completion" );
		const res = await promise;
		this.writeJSON = false;
		await this.afterExecution( res.err, res.stdout, res.stderr );		

	} else if ( typeof ( this.action.module ) === "object" ) {

		const actionParameters2 = Object.assign( JSON.parse( this.parametersString ), this.POSTFiles );
		actionParameters2.output_directory =  fullPath( outputDirectory );
		const response = await this.action.module.executeAsync( actionParameters2 );
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

		if ( this.outputDirectory ) {

			logStream = fs.createWriteStream( fullPath(
				this.outputDirectory, "action.log" ) );
			logStream2 = fs.createWriteStream( fullPath(
				this.outputDirectory, "action.err" ) );
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

RPC.prototype.replayAction = async function () {

	const now = new Date();

	const promises = [

		fs.utimes( fullPath( this.outputDirectory, "action.json" ), now, now ),
		fs.utimes( fullPath( this.outputDirectory ), now, now )

	];

	if ( this.POST.stdout ) {

		for ( let extension of [ 'log', 'err' ] ) {

			promises.push( fs.readFile( fullPath(
				this.outputDirectory, 'action.' + extension ) ) );

		}

	} else {

		this.response.stdout = 'stdout and stderr not included. Launch action with parameter stdout=true';

	}

	const results = await Promise.all( promises );

	if ( results[ 2 ] ) {

		this.response.stdout = results[ 2 ].toString();
		this.response.stderr = results[ 3 ].toString();

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

		this.log( "triggering completion for same action [" + opts.RPC.id + "]" );
		opts.callback( { err, stdout, stderr } );

	}

	if ( err ) throw err;

	if ( !this.writeJSON ) return;

	// Touch output directory to avoid automatic deletion
	const now = new Date();

	await Promise.all( [

		fs.utimes( fullPath( this.outputDirectory ), now, now ),
		fs.writeFile( fullPath( this.outputDirectory, "action.json" ),
			this.parametersString )

	] );

};
