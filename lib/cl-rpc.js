const assert    = require( 'assert' ),
      config    = require( './config.js' ),
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
config.on( "log", msg => { if ( logToConsole ) console.log( msg ) } );

const actionsQueue = queue( async task => await new RPC().execute( task ), nCPUS );
actionsQueue.pushAsync = promisify( actionsQueue.push.bind( actionsQueue ) );
const baseActionsQueue = queue( async task => await new RPC().execute( task ), nCPUS );
baseActionsQueue.pushAsync = promisify( baseActionsQueue.push.bind( baseActionsQueue ) );

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

			const queue = ( action && action.lib === "base" ) ?
				baseActionsQueue : actionsQueue;

			msg = await queue.pushAsync( POST );

		}

		msg.handle = handle;

		if ( callback ) callback( msg )
			else return msg;

	} catch ( error ) {

		log( 'Error ' );
		log( error );
		if ( callback ) callback( { handle, error } )
			else return( { handle, error } )

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
	let value = 1;

	try { value = JSON.parse( await fs.readFile( file ) ).value + 1; }
		catch ( e ) {}

	await fs.writeFile( file, JSON.stringify( { value } ) );
	return path.join( "actions", value + "" );

} );

actionsDirectoriesQueue.pushAsync = promisify( actionsDirectoriesQueue.push );

function RPC() {};

RPC.prototype.execute = async function ( POST ) {

	const response = this.response = { };

	try {

		this.POST = POST;
		ongoingActions[ POST.handle ] =  this;
		this.id = actionsCounter++;
		this.log( "action : " + POST.action + ", handle : " + POST.handle );
		const action = this.action = settings.actions[ POST.action ];
		if ( !action ) throw "action '" + POST.action + "' not found";
		this.commandLine = "nice " + ( action.engine || '' ) + " "
			+ ( action.executable || action.command );

		this.parseParameters();
		await this.handleOutputDirectory();
		this.log( this.commandLine.substr( 0, 500 ) );
		let res;

		if ( await this.isInCache() ) {

			res = await this.replayActionFromCache();

		} else {

			this.promise = this.executeAction();
			res = await this.promise;

		}

		if ( this.POST.stdout ) {

			this.response.stdout = res.stdout;
			this.response.stderr = res.stderr;

		}

		if ( res.err ) throw res.err;
		this.response.status = res.status;
		this.log( res.status );

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

	this.POSTFiles = {};
	this.filteredPOST = { action : this.POST.action };

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

		const key = parameter.aliases.find( alias => this.POST[ alias ] );
		value = this.POST[ key ];
		
	}

	if ( ( value === undefined ) && parameter.hasOwnProperty( 'defaultValue' ) ) {

		value = parameter.defaultValue;

	}

	if ( value === undefined ) {

		if ( parameter.required ) throw "parameter " + parameter.name + " is required!";
		return;

	}

	if ( !parameter.type ) throw "parameter \"" + parameter.name +
		"\" needs a \"type\" field, please check JSON file";

	if ( !parameter.type.includes( "Array" ) ) value = value.toString();

	this.filteredPOST[ parameter.name ] = value;

	switch ( parameter.type ) {

	case 'file':
	case 'directory':

		const dir = fullPath( value );
		this.POSTFiles[ parameter.name ] = dir;
		return dir.split( " " ).join( "\\ " );

	case 'fileArray':

		if ( value.some( file => !file ) ) throw 'one file is empty';

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

RPC.prototype.getInputMTime = async function ( ) {

	const files = this.action.deps.slice();
	if ( this.POST.cache ) files.push( ...this.POST.cache.map( p => fullPath( p ) ) );

	for ( let param of this.action.parameters ) {

		const value = this.POST[ param.name ];
		if ( value === undefined ) continue;

		if ( ( param.type == "file" ) || ( param.type == "directory" ) ) {

			files.push( fullPath( '' + value ) );

		} else if ( param.type == "fileArray" ) {

			files.push( ...value.map( v => fullPath( '' + v ) ) );

		}

	}

	let MTime = -1;
	await Promise.all( files.map( async file => {

		try {

			MTime = Math.max( ( await fs.stat( file ) ).mtime.getTime(), MTime );

		} catch ( e ) { throw "file does not exist : " + file +
			", check options or JSON of action '" + this.POST.action + "'";}

	}  ) );

	return MTime;
}

RPC.prototype.handleOutputDirectory = async function () {

	if ( settings.permissions === 0 )  this.POST.outputDirectory = "cache/";
	let dir = this.POST.outputDirectory || this.POST.output_directory;
	if ( !dir && this.action.voidAction ) return;

	switch ( dir ) {

	case "actions/" :

		dir = await actionsDirectoriesQueue.pushAsync( {} );
		break;

	case "cache/" :
	case undefined :

		const shasum = crypto.createHash( 'sha1' );
		shasum.update( this.commandLine );
		const hash = shasum.digest( 'hex' );
		dir = path.join( "cache", hash.charAt(0), hash.charAt(1), hash );
		break;

	default :

		await exports.validatePathAsync( path.normalize( dir ).split( "/" )[ 0 ] );

	}

	dir = path.normalize( dir  + "/" );
	await fs.mkdirs( fullPath( dir ) );

	if ( this.POST.stream ) {

		exports.emit( "actionEvent", {

			handle : this.POST.handle,
			type : "outputDirectory",
			data : dir

		} );

	}

	this.filteredPOST.output_directory = this.outputDirectory =
		this.response.outputDirectory = dir;

	this.log( 'in : ' + this.outputDirectory );
	if ( !this.action.output ) return;

	for ( let [ key, value ] of Object.entries( this.action.output ) ) {

		const field = 'output' + key[ 0 ].toUpperCase() + key.slice( 1 );
		this.filteredPOST[ field ] = this.response[ field ] = path.join( this.outputDirectory, value );

	}

};

RPC.prototype.isInCache = async function ( ) {

	if ( this.action.voidAction || this.POST.force_update
		|| this.POST.forceUpdate || this.action.noCache ) return false;

	try {

		const file = fullPath( this.outputDirectory, "action.json" );
		const cachedPOST = JSON.parse( await fs.readFile( file ) );
		const inputMTime = await this.getInputMTime();
		const cachedMTime = cachedPOST.__extra.MTime;
		if ( inputMTime >  cachedMTime ) return false;
		const extra = cachedPOST.__extra;
		delete cachedPOST.__extra;
		assert.deepEqual( this.filteredPOST, cachedPOST );
		this.response.timeStamp = cachedMTime;
		this.response.duration = extra.duration;
		return true;

	} catch ( e ) {}

};

RPC.prototype.replayActionFromCache = async function () {

	const now = new Date();
	// touch output directory to avoid automatic deletion
	const promises = [ fs.utimes( fullPath( this.outputDirectory ), now, now ) ];
	const opts = { encoding : 'utf8' };

	if ( this.POST.stdout ) promises.push(

		fs.readFile( fullPath( this.outputDirectory, 'action.log' ), opts ),
		fs.readFile( fullPath( this.outputDirectory, 'action.err' ), opts )

	);

	const [ , stdout, stderr ] = await Promise.all( promises );
	return { status : 'CACHED', stdout, stderr };

};

RPC.prototype.executeAction = async function () {

	if ( this.toKill ) {

		this.childProcess = { killedByMe : true };
		this.log( "execution aborted due to kill request" );
		throw "killed";

	}

	const shasum = crypto.createHash( 'sha1' );
	shasum.update( JSON.stringify( this.filteredPOST ) );
	const hash = shasum.digest( 'hex' );
	const runningAction = ongoingActions2[ hash ];
	const cwd = fullPath( this.outputDirectory || "" );
	let res;
	const now = new Date();
	const MTime = now.getTime()

	if ( runningAction ) {

		this.childProcess = runningAction.childProcess;
		this.log( "same as action [" + runningAction.id + "]" );
		res = await runningAction.promise;

	} else if ( typeof ( this.action.module ) === "object" ) {

		const params = Object.assign( this.filteredPOST, this.POSTFiles );
		params.output_directory =  cwd;
		res = await this.action.module.executeAsync( params );
		res.duration = new Date().getTime() - MTime;

	} else {

		let child ;

		const options = { cwd, maxBuffer : 1e10,
			env : Object.assign( {}, process.env, this.action.env ) };

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

		if ( !this.action.voidAction && this.outputDirectory ) {

			const prefix = fullPath( this.outputDirectory, "action" );
			logStream = fs.createWriteStream( prefix + ".log" );
			logStream2 = fs.createWriteStream( prefix + ".err" );
			child.stdout.pipe( logStream );
			child.stderr.pipe( logStream2 );

		}

		res = await promise;
		delete ongoingActions2[ hash ];
		res.duration = new Date().getTime() - MTime;

		if ( !res.err && logStream ) {

			logStream.end();
			logStream2.end();
			this.filteredPOST.__extra = { duration : res.duration, MTime };

			await Promise.all( [

				fs.utimes( cwd, now, now ),
				fs.writeFile( cwd + "/action.json",
					JSON.stringify( this.filteredPOST ) )

			] );

		}

	}

	this.response.timeStamp = res.timeStamp = res.timeStamp || MTime;
	this.response.duration = res.duration || -1;
	res.status = res.status || 'OK (' +  this.response.duration / 1000 + 's)';
	return res;

};
