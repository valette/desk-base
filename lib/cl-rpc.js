'use strict';

const crypto       = require('crypto'),
      exec         = require('child_process').exec,
      EventEmitter = require('events').EventEmitter,
      fs           = require('fs-extra'),
      os           = require('os'),
      path         = require('path'),
      queue        = require('async').queue,
      throttle     = require('lodash').throttle,
      util         = require('util'),
      psTree       = util.promisify( require('ps-tree') );

// base directory where all data files are (data, cache, actions, ..)
let rootDir;

// object containing all settings : dataDirs, actions etc...
let settings;

// random value to detect server crash...
const randomValue = Math.random();

// files/directories where user can add their own action definitions
let includes;

// object storing all the actions
let actions;

// permissions level (1 by default)
let permissions;

// allowed sub-directories in rootDir. They are automatically created if not existent
const directories = [];
let dataDirs = {};

// .js files to load by the client during startup
let initFiles = [];

// variable to enumerate actions for logging
let actionsCounter = 0;

// object storing all currently running actions
const ongoingActions = {}; // with 'handle' as index
const ongoingActions2 = {}; // with actionParameters hash as index

// one watcher for each json configuration file or directory
let watchedFiles = {};

exports = module.exports = new EventEmitter();

let emitLog = false;
let logToConsole = true;

exports.setEmitLog = (bool) => {emitLog = bool;};
exports.setLogToConsole = (bool) => {logToConsole = bool;};

function log ( message ) {

	if ( logToConsole ) console.log( message );
	if ( emitLog ) exports.emit( "log", message.toString() );

}

exports.setRootDir = function (dir) {
	rootDir = dir;
	const extensionsDir = path.join(rootDir, 'extensions') + '/';
	fs.mkdirsSync(extensionsDir);
	includes = [
		{
			file : path.join(__dirname, 'includes'),
			priority : -1
		},
		{
			file : extensionsDir,
			priority : 0
		}
	];
	updateSync();
};

exports.getRootDir = () => rootDir;
exports.getSettings = () => settings;

exports.validatePath = function ( dir, callback ) {
	
	fs.realpath( path.join( rootDir, dir ), ( err, realPath ) => {

		if ( !err && !directories.some( subDir =>
			realPath.slice( 0, subDir.length ) === subDir ) ) {

			err = "path " + dir + " not allowed"; 

		}

		callback ( err );

	} );

};

exports.validatePathAsync = util.promisify( exports.validatePath );

function watch ( file ) {

	if ( !fs.existsSync( file ) ) {

		log("Warning : no file " + file + " found. Will watch parent directory for updates");
		file = path.dirname( file );

	}

	watchedFiles[ file ] = fs.watch( file, update );

}

exports.include = function (file, priority) {

	priority = priority || 0;
	if ( watchedFiles[ file ] ) return;
	include( file, priority );
	includes.push( { file , priority } );
	exportActions();

};

function includeDirectory ( dir, priority, visited ) {

	priority = priority || 0;

	fs.readdirSync( dir ).forEach( function( child ) {

		const fullChild = path.join( dir, child );

		if ( !visited && fs.statSync( fullChild ).isDirectory() ) {

			includeDirectory( fullChild, priority, true );
			return;

		} else if ( path.extname( child ).toLowerCase() === '.json' ) {

			include( fullChild, priority );

		}

	} );

}

function include ( file, priority ) {

	if ( watchedFiles[ file ] ) {

		log( 'WARNING : ' + file + ' included twice' );
		return;

	}

	priority = priority || 0;

	watch( file );
	let lib;

	try {

		if ( fs.statSync(file).isDirectory() ) {
			includeDirectory( file, priority );
			return;
		}

		log('include : ' + file);

		lib = path.basename( file, path.extname( file ) );
		const actionsObject = require( file );
		delete require.cache[ require.resolve( file ) ];


		const localActions = actionsObject.actions || [];
		const dir = fs.realpathSync(path.dirname(file));
		Object.keys(localActions).forEach(function (name) {
			const action = localActions[ name ];
			action.lib = action.lib || lib;

			// backwards compatibility
			if ( action.attributes ) {
				Object.assign(action, action.attributes);
				delete action.attributes;
			}

			if ( typeof (action.js) === 'string' ) {
				const jsRequire = path.join(dir, action.js);
				log('load js from ' + jsRequire + '.js' );
				action.module = require(jsRequire);
				delete require.cache[require.resolve(jsRequire)];
				action.executable = path.join(dir, action.js + '.js');
				watch(action.executable);
			} else if ( typeof (action.executable) === 'string' ) {
				if (action.executable.charAt(0) !== '/') {
					action.executable = path.join(dir, action.executable);
				}
			}

			if (action.priority === undefined) {
				action.priority = priority;
			}

			if ( action.dependencies ) {

				action.dependencies = action.dependencies.map( dep => {

					return dep.includes( '/' ) ? path.join( dir, dep ) : dep;

				} );

			}

			if (actions[name] && (action.priority < actions[name].priority)) {
				return;
			}
			actions[name] = action;
		});

		const dirs = actionsObject.dataDirs || {};
		Object.keys(dirs).forEach(function (key) {
			let source = dirs[key];
			let obj;
			if (typeof source === 'object')
			{
				obj = source;
				source = obj.path;
			}
			if (source.indexOf('/') > 0) {
				// source is relative
				source = path.join(path.dirname(file), source);
			} else if (source.indexOf('/') < 0) {
				//source is a simple directory
				source = path.join(rootDir, source);
			}
			addDirectory(key, source);
			if (obj) {
				obj.path = source;
				source = obj;
			}
			dataDirs[key] = source;
		});
	    (actionsObject.include || []).forEach(function (child) {
			if (child.charAt(0) !== '/') {
				// the path is relative. Prepend directory
				child = path.join(path.dirname(file), child);
			}
			include(child, priority);
		});

		(actionsObject.init || []).forEach(file => {
			initFiles.push(file)
			watch(path.join(rootDir, file));
		});

		if (typeof(actionsObject.permissions) === 'number') {
			permissions = Math.min(permissions, actionsObject.permissions);
		}
	} catch (error) {
		log('error importing ' + file);
		log(error.toString());
		if (lib) actions['import_error_' + lib] = {lib : lib};
	}
};

function addDirectory(key, source) {
	const dir = path.join(rootDir, key)
	if (source === dir) {
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir);
			log('directory ' + dir + ' created');
		}
	} else {
		if (!fs.existsSync(dir) || !(fs.readlinkSync(dir) === source)) {
			try {
				fs.unlinkSync(dir);
				log("removed wrong symbolic link " + dir);
			} catch (e) {}

			if (fs.existsSync(source)) {
				fs.symlinkSync(source, dir, 'dir');
				log('directory ' + dir + ' created as a symlink to ' + source);
			} else {
				log('ERROR : Cannot create directory ' + dir + ' as source directory ' + source + ' does not exist');
				return;
			}
		}
	}
	directories.push(fs.realpathSync(dir));
}

function updateSync () {

	log( "updating actions:" );

	// clear actions
	actions = {};
	dataDirs = {};
	initFiles = [];

	// expose home directory by default
	addDirectory( 'home', os.homedir() );
	dataDirs.home = os.homedir();

	permissions = 1;
	Object.keys( watchedFiles ).forEach( file => watchedFiles[ file ].close() );
	watchedFiles = {};

	includes.forEach( file => include( file.file, file.priority ) );
	exportActions();

}

let version = 0;

function exportActions() {

	// filter actions according to permissions
	for ( let action of Object.keys( actions ) ) {

		let perm = actions[ action ].permissions;
		if ( perm !== 0 ) perm = 1;
		if ( permissions < perm ) delete actions[ action ];

	}

	log( Object.keys( actions ).length + ' actions included' );

	version++;

	settings = { actions, permissions, dataDirs, init : initFiles,
		time : process.hrtime(), version, randomValue };

	// export filtered actions.json
	log( "version : " + version );
	fs.writeFileSync(path.join(rootDir, "actions.json"), JSON.stringify( settings, null, '\t' ) );
	exports.emit("actions updated", settings);

}

const update = throttle( updateSync, 1000, { leading: false } );

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

const manageActions = async function ( POST ) {

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

			const action = actions[ POST.action ];

			if ( action.lib === "base" ) {

				msg = await new RPC().execute( POST, finished );

			} else {

				actionsQueue.push( POST, finished );

			}

		}

		if ( !msg ) return;
		msg.handle = POST.handle;
		delete ongoingActions[ POST.handle ];
		callback( msg );

	} catch ( e ) {

	}

	function finished( msg ) {

		msg.handle = POST.handle;
		delete ongoingActions[ POST.handle ];
		callback( msg );

	}

};

const actionsDirectoriesQueue = queue( async function( task ) {

	const counterFile = path.join( rootDir, "actions/counter.json" );

	let index = 1;

	try {

		index = JSON.parse( await fs.readFile( counterFile ) ).value + 1;

	} catch ( e ) {}

	const outputDirectory = path.join( "actions", index + "" );
	await fs.writeFile( counterFile, JSON.stringify( { value : index } ) );
	return outputDirectory;

} );

actionsDirectoriesQueue.pushAsync = util.promisify( actionsDirectoriesQueue.push );

const RPC = function ( ) {};

RPC.prototype.execute = async function ( POST, callback ) {

	this.id = actionsCounter++;

	this.POST = POST;
	this.POSTFiles = {};
	this.inputMTime = -1;

	this.log = POST.silent ? () => {} : msg => log( "[" + this.id + "] " + msg );

	this.response = {};
	this.action = actions[ POST.action ];
	this.cached = false;

	if ( !this.action ) return callback( { error : "action " + POST.action + " not found" } );

	this.commandLine = "nice " + ( this.action.engine || '' ) + " "
		+ ( this.action.executable || this.action.command );

	this.log( "handle : " + this.POST.handle );

	// array used to store concurrent similar actions
	this.similarActions = [];

	this.parseParameters();

	await Promise.all( [ this.handleDependenciesMTime(),
		this.handleExtraCacheMTime(),
		this.handleInputMTimes(), 
		this.handleOutputDirectory(),
	] );

	await this.handleLogAndCache();

	if ( this.cached ) {

		await this.cacheAction( );
		if ( callback ) callback( this.response );
		return this.response;

	}

	this.executeAction( ( err ) => {

		if ( err ) {

			this.response.status = "ERROR";
			this.response.error = err;
			this.log("error for:");
			this.log(this.commandLine);
			this.log(err);
			console.log(new Error().stack);

		} else {

			this.log("done");

		}

		if ( callback ) callback( this.response );
		return this.response;

	} );

};

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

		value = parameter.defaultValue

	}

	if (value === undefined || value === null) {

		if ( parameter.required ) throw "parameter " + parameter.name + " is required!";

		return;

	}

	if ( !parameter.type ) throw "parameter \"" + parameter.name +
		"\" needs a \"type\" field, please check JSON file";

	if ( parameter.type.indexOf( "Array" ) < 0 ) value = value.toString();

	switch ( parameter.type ) {

	case 'file':
	case 'directory':

		const dir = path.join( rootDir, value );
		this.POSTFiles[ parameter.name ] = dir;
		return dir.split( " " ).join( "\\ " );

	case 'fileArray':

		if ( files.some( file => !file ) ) throw 'Error : one file is empty';

		const files = value.map( file => path.join( rootDir, file ) );
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

	await Promise.all( cache.map ( file => this.addMTime( path.join( rootDir, file ) ) ) );

};

//const statAsync = util.promisify( fs.stat );

RPC.prototype.addMTime = async function ( file ) {

	if ( !file ) return;

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

				await this.addMTime( path.join( rootDir,
					this.POST[ parameter.name ].toString() ) );

				break;

			case "fileArray" :

				await Promise.all( this.POST[ parameter.name ].map( async (file) => {

					await this.addMTime( path.join(rootDir, file.toString() ) );

				} ) );

				break;

			default :
		}

	} ) );

};

RPC.prototype.handleOutputDirectory = async function () {

	if ( permissions === 0 )  this.POST.output_directory = "cache/";

	if ( this.inputMTime > 0 ) this.response.timeStamp = this.inputMTime;

	this.outputDirectory = this.POST.outputDirectory || this.POST.output_directory || "";

	if ( this.action.voidAction ) return;

	switch ( this.outputDirectory ) {

	case "actions/" :

		this.outputDirectory = await actionsDirectoriesQueue.pushAsync( { } );
		break;

	case "cache/" :
	case "" : 

		const shasum = crypto.createHash( 'sha1' );
		shasum.update( this.commandLine );
		const hash = shasum.digest( 'hex' );
		this.outputDirectory = path.join( "cache", hash.charAt(0), hash.charAt(1), hash );
		break;

	default :

		await exports.validatePathAsync( path.normalize(
			this.outputDirectory ).split( "/" )[ 0 ] );

	}

	await fs.mkdirs( path.join( rootDir, this.outputDirectory ) );

};

RPC.prototype.handleLogAndCache = async function ( ) {

	if ( this.outputDirectory.length ) {

		this.outputDirectory = path.normalize( this.outputDirectory );

		if ( this.outputDirectory.charAt( this.outputDirectory.length -1 ) !== "/" ) {

			this.outputDirectory += "/";

		}

		this.response.outputDirectory = this.outputDirectory;

		if ( this.POST.stream ) {

			exports.emit( "actionEvent", {

				handle : this.POST.handle,
				type : "outputDirectory",
				data : this.outputDirectory

			} );

		}

	}

	const params = { action : this.POST.action, output_directory :  this.outputDirectory };

	if ( this.action.output ) {

		const outputFiles = this.action.output;

		Object.keys( outputFiles ).forEach( function ( output ) {

			const field = 'output' + output[ 0 ].toUpperCase() + output.slice( 1 );
			params[ field ] = this.response[ field ] = path.join( this.outputDirectory, outputFiles[ output ] );

		}.bind( this ) );

	}

	this.action.parameters.forEach(function (parameter) {

		params[parameter.name] = this.POST[parameter.name];

	}, this);

	this.parametersString = JSON.stringify( params );

	this.log ('in : ' + this.outputDirectory);

	if (this.commandLine.length < 500) {

		this.log(this.commandLine);

	} else {

		this.log(this.commandLine.substr(0,500) + '...[trimmed]');

	}

	if ( this.action.voidAction || this.POST.force_update || this.action.noCache ) {

		return;

	}

	// check if action was already performed
	const actionFile = path.join( rootDir, this.outputDirectory, "action.json" );

	try {

		const stats = await fs.stat( actionFile )

		if  ( stats.mtime.getTime() < this.inputMTime ) return;

		if ( await fs.readFile( actionFile ) == this.parametersString ) {

			this.log("cached");
			this.cached = true;

		} 

	} catch ( e ) { }

};

RPC.prototype.executeAction = async function ( callback ) {

	this.startTime = new Date().getTime();
	this.writeJSON = false;

	const commandOptions = {

		cwd: path.join( rootDir, this.outputDirectory ),
		maxBuffer : 1e10,
		env : Object.assign( {}, process.env, this.action.env )

	};

	if ( !this.action.voidAction ) this.writeJSON = true;

	const after = ( err, stdout, stderr ) => {

		this.afterExecution( err, stdout, stderr, callback );
		delete ongoingActions2[ hash ];

		for ( let opts of this.similarActions ) {

			opts.RPC.afterExecution( err, stdout, stderr, opts.callback );
			this.log( "triggering completion for same action [" + opts.RPC.id + "]" );

		}

	};

	const shasum = crypto.createHash( 'sha1' );
	shasum.update( this.parametersString + this.outputDirectory );
	const hash = shasum.digest( 'hex' );
	const opts = ongoingActions[ this.POST.handle ];

	if ( opts.toKill ) {

		this.log( "execution aborted due to kill request" );
		return after( { killed : true } );

	}

	opts.RPC = this;
	opts.callback = callback;

	const existingOpts = ongoingActions2[ hash ];

	if ( existingOpts ) {

		opts.childProcess = existingOpts.childProcess;
		existingOpts.RPC.similarActions.push( opts );
		this.log( "same as action [" + existingOpts.RPC.id + "], wait for its completion" );
		return;

	}

	if ( typeof ( this.action.module ) === "object" ) {

		const actionParameters2 = Object.assign( JSON.parse( this.parametersString ), this.POSTFiles );
		actionParameters2.output_directory =  path.join( rootDir, this.outputDirectory );
		this.action.module.execute( actionParameters2, after );
		return;

	}

	const child = opts.childProcess = exec( this.commandLine, commandOptions, after );
	ongoingActions2[ hash ] = opts;

	if ( this.POST.stream ) {

		this.log( "will stream stdout and stderr to client" );

		for ( let type of [ "stdout", "stderr" ] ) {

			child[ type ].on( "data", data => {

				exports.emit( "actionEvent", { type, handle : this.POST.handle, data } );

			} );

		}

	}

	if ( this.outputDirectory ) {

		this.logStream = fs.createWriteStream( path.join( rootDir,
			this.outputDirectory, "action.log" ) );
		this.logStream2 = fs.createWriteStream( path.join( rootDir,
			this.outputDirectory, "action.err" ) );
		child.stdout.pipe( this.logStream );
		child.stderr.pipe( this.logStream2 );

	}

};

RPC.prototype.cacheAction = async function () {

	this.response.status = 'CACHED';
	const now = new Date();

	const promises = [

		fs.utimes( path.join( rootDir, this.outputDirectory, "action.json" ), now, now ),
		fs.utimes( path.join( rootDir, this.outputDirectory ), now, now )

	];

	if ( this.POST.stdout ) {

		for ( let extension of [ 'log', 'err' ] ) {

			promises.push( fs.readFile( path.join( rootDir,
				this.outputDirectory, 'action.' + extension ) ) );

		}

	} else {

		this.response.stdout = 'stdout and stderr not included. Launch action with parameter stdout=true';

	}

	const results = await Promise.all( promises );

	if ( results[ 2 ] ) this.response.stdout = results[ 2 ].toString();
	if ( results[ 3 ] ) this.response.stderr = results[ 3 ].toString();

};

RPC.prototype.afterExecution = async function( err, stdout, stderr, callback ) {

	if ( this.logStream ) {

		this.logStream.end();
		this.logStream2.end();

	}

	if (this.POST.stdout) {

		this.response.stdout = stdout;
		this.response.stderr = stderr;

	} else {

		this.response.stdout = 'stdout and stderr not included. Launch action with parameter stdout=true';

	}

	if ( err ) {

		if ( err.killed ) {

			this.response.killed = true;

		}

		return callback( err );

	}

	this.response.status = 'OK (' + (new Date().getTime() - this.startTime) / 1000 + 's)';

	if ( !this.writeJSON ) return callback();

	// Touch output directory to avoid automatic deletion
	const now = new Date();

	await Promise.all( [

		fs.utimes( path.join( rootDir, this.outputDirectory ), now, now ),
		fs.writeFile( path.join(rootDir, this.outputDirectory, "action.json"),
			this.parametersString )

	] );

	callback();

};
