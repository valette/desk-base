'use strict';

const async        = require('async'),
      crypto       = require('crypto'),
      exec         = require('child_process').exec,
      EventEmitter = require('events').EventEmitter,
      fs           = require('fs-extra'),
      libpath      = require('path'),
      os           = require('os'),
      psTree       = require('ps-tree'),
      spawn        = require('child_process').spawn,
      _            = require('lodash'),
      util         = require('util');

// base directory where all data files are (data, cache, actions, ..)
var rootDir;

// object containing all settings : dataDirs, actions etc...
var globalSettings;

// random value to detect server crash...
var randomValue = Math.random();

// files/directories where user can add their own action definitions
var includes;

// object storing all the actions
var actions;

// permissions level (1 by default)
var permissions;

// allowed sub-directories in rootDir. They are automatically created if not existent
var directories = [];
var dataDirs = {};

// .js files to load by the client during startup
var initFiles = [];

// variable to enumerate actions for logging
var actionsCounter = 0;

// object storing all currently running actions
var ongoingActions = {}; // with 'handle' as index
var ongoingActions2 = {}; // with actionParameters hash as index

// one watcher for each json configuration file or directory
var watchedFiles = {};

exports = module.exports = new EventEmitter();

var emitLog = false;
var logToConsole = true;

exports.setEmitLog = (bool) => {emitLog = bool;};
exports.setLogToConsole = (bool) => {logToConsole = bool;};

var log = function (message) {
	if (logToConsole) {
		console.log(message);
	}

	if (emitLog) {
		exports.emit("log", message.toString());
	}
};

exports.setRootDir = function (dir) {
	rootDir = dir;
	var extensionsDir = libpath.join(rootDir, 'extensions') + '/';
	fs.mkdirsSync(extensionsDir);
	includes = [
		{
			file : libpath.join(__dirname, 'includes'),
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
exports.getSettings = () => globalSettings;

exports.validatePath = function (dir, callback) {
	fs.realpath(libpath.join(rootDir, dir), function (err, realPath) {
		if (!err && !_.some(directories, function (subDir) {
				return realPath.slice(0, subDir.length) === subDir;
			})) {
			err = "path " + dir + " not allowed"; 
		}

		callback (err);
	});
};

exports.validatePathAsync = util.promisify( exports.validatePath );

function watch (file) {
	if (!fs.existsSync(file)) {
		log("Warning : no file " + file + " found. Will watch parent directory for updates");
		file = libpath.dirname(file);
	}
	watchedFiles[file] = fs.watch(file, update);
}

exports.include = function (file, priority) {
	priority = priority || 0;
	if (watchedFiles[file]) return;
	include(file, priority);
	includes.push({file : file, priority : priority});
	exportActions();
};

function includeDirectory ( dir, priority, visited ) {

//	log( 'include directory : ' + dir );
//	console.log( new Error().stack );
	priority = priority || 0;

	fs.readdirSync( dir ).forEach( function( child ) {

		var fullChild = libpath.join( dir, child );

		if ( !visited && fs.statSync( fullChild ).isDirectory() ) {

			includeDirectory( fullChild, priority, true );
			return;

		} else if ( libpath.extname( child ).toLowerCase() === '.json' ) {

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

	try {

		if ( fs.statSync(file).isDirectory() ) {
			includeDirectory( file, priority );
			return;
		}

		log('include : ' + file);

		var lib = libpath.basename( file, libpath.extname( file ) );
		var actionsObject = require( file );
		delete require.cache[ require.resolve( file ) ];


		var localActions = actionsObject.actions || [];
		var dir = fs.realpathSync(libpath.dirname(file));
		Object.keys(localActions).forEach(function (name) {
			var action = localActions[name];
			action.lib = action.lib || lib;

			// backwards compatibility
			if (action.attributes) {
				Object.assign(action, action.attributes);
				delete action.attributes;
			}

			if ( typeof (action.js) === 'string' ) {
				var jsRequire = libpath.join(dir, action.js);
				log('load js from ' + jsRequire + '.js' );
				action.module = require(jsRequire);
				delete require.cache[require.resolve(jsRequire)];
				action.executable = libpath.join(dir, action.js + '.js');
				watch(action.executable);
			} else if ( typeof (action.executable) === 'string' ) {
				if (action.executable.charAt(0) !== '/') {
					action.executable = libpath.join(dir, action.executable);
				}
			}

			if (action.priority === undefined) {
				action.priority = priority;
			}

			if ( action.dependencies ) {

				action.dependencies = action.dependencies.map( dep => {

					return dep.includes( '/' ) ? libpath.join( dir, dep ) : dep;

				} );

			}

			if (actions[name] && (action.priority < actions[name].priority)) {
				return;
			}
			actions[name] = action;
		});

		var dirs = actionsObject.dataDirs || {};
		Object.keys(dirs).forEach(function (key) {
			var source = dirs[key];
			var obj;
			if (typeof source === 'object')
			{
				obj = source;
				source = obj.path;
			}
			if (source.indexOf('/') > 0) {
				// source is relative
				source = libpath.join(libpath.dirname(file), source);
			} else if (source.indexOf('/') < 0) {
				//source is a simple directory
				source = libpath.join(rootDir, source);
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
				child = libpath.join(libpath.dirname(file), child);
			}
			include(child, priority);
		});

		(actionsObject.init || []).forEach(file => {
			initFiles.push(file)
			watch(libpath.join(rootDir, file));
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
	var dir = libpath.join(rootDir, key)
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

var updateSync = function () {
	log("updating actions:");

	// clear actions
	actions = {};
	dataDirs = {};
	initFiles = [];

	// expose home directory by default
	addDirectory('home', os.homedir());
	dataDirs.home = os.homedir();

	permissions = 1;
	Object.keys(watchedFiles).forEach(file => watchedFiles[file].close());
	watchedFiles = {};

	// also include directories in the extension dir
//	includeDirectory( libpath.join(rootDir, 'extensions') + '/' );

	includes.forEach(file => include(file.file, file.priority));
	exportActions();
}

var settingsVersion = 0;

function exportActions() {
	// filter actions according to permissions
	actions = _.pickBy(actions, function(action) {
		var perm = action.permissions;
		if (perm !== 0) {
			perm = 1;
		}
		return permissions >= perm;
	});

	log(Object.keys(actions).length + ' actions included');

	settingsVersion++;

	globalSettings = {
		actions : actions,
		permissions : permissions,
		dataDirs : dataDirs,
		init : initFiles,
		time : process.hrtime(),
		version : settingsVersion,
		randomValue : randomValue
	};

	// export filtered actions.json
	log("version : " + globalSettings.version);
	fs.writeFileSync(libpath.join(rootDir, "actions.json"), JSON.stringify( globalSettings, null, '\t' ) );
	exports.emit("actions updated", globalSettings);
}

var update = _.throttle( updateSync, 1000, { leading: false } );

var validateValue = function ( value, parameter ) {

	for ( let bound of [ 'min', 'max' ] ) {

		if ( !parameter[ bound ] ) continue;

		const compare = parseFloat( parameter[ bound ] );

		if ( bound === 'min' ? value < compare : value > compare ) {

			return ( 'error for parameter ' + parameter.name +
				' : ' + bound + ' value is ' + compare )

		}

	}

}

var manageActions = function ( POST, callback ) {

	switch (POST.manage) {

	case "kill" :

		var handle = ongoingActions[POST.actionHandle];
		if (!handle) {
			callback ({status : 'not found'});
			return;
		}
		log("kill requested : " + POST.actionHandle);
		var proc = handle.childProcess;
		if (proc) {
			proc.stdout.pause();
			proc.stderr.pause();
			log("Killing master process : " + proc.pid);
			psTree(proc.pid, function (err, children) {
				children.map(function (child) {
					log('killing process ' + child.PID);
					process.kill(child.PID);
				});
				proc.kill();
				callback ({status : 'killed'});
			});
		} else {
			handle.toKill = true;
			callback ({status : 'killing defered'});
		}
		return;

	case "list" :
	default:
		// we need to remove circular dependencies before sending the list
		var cache = [];
		var objString = JSON.stringify({ ongoingActions : ongoingActions},
			function(key, value) {
				if (typeof value === 'object' && value !== null) {
					if (cache.indexOf(value) !== -1) {
						// Circular reference found, discard key
						return;
					}
					// Store value in our collection
					cache.push(value);
				}
				return value;
			}
		);
		callback(JSON.parse(objString));
		return;

	}	

}

var queue = async.queue( (task, cb ) => new RPC().execute( task, cb ), os.cpus().length );

exports.execute = function ( POST, callback ) {

	POST.handle  = POST.handle || Math.random().toString();
	ongoingActions[ POST.handle ] =  { POST };

	if ( POST.manage ) {

		manageActions( POST, finished );

	} else {

		var action = actions[ POST.action ];

		if ( action && action.lib === "base" ) {

			new RPC().execute( POST, finished );

		} else {

			queue.push( POST, finished );

		}

	}

	function finished( msg ) {

		msg.handle = POST.handle;
		delete ongoingActions[ POST.handle ];
		callback( msg );

	}

};

const actionsDirectoriesQueue = async.queue( async function( task ) {

	const counterFile = libpath.join( rootDir, "actions/counter.json" );

	let index = 1;

	try {

		index = JSON.parse( await fs.readFile( counterFile ) ).value + 1;

	} catch ( e ) {}

	const outputDirectory = libpath.join( "actions", index + "" );
	await fs.writeFile( counterFile, JSON.stringify( { value : index } ) );
	return outputDirectory;

} );

actionsDirectoriesQueue.pushAsync = util.promisify( actionsDirectoriesQueue.push );

const RPC = function ( ) {};

RPC.prototype.execute = function ( POST, callback ) {

	this.id = actionsCounter++;

	this.POST = POST;
	this.POSTFiles = {};
	this.inputMTime = -1;

	var header = "[" + this.id + "] ";
	this.log = POST.silent ? () => {} : (msg) => log(header + msg);

	this.response = {};
	this.action = actions[ POST.action ];
	this.cached = false;

	if ( !this.action ) return callback( { error : "action " + POST.action + " not found" } );

	this.commandLine = "nice " + (this.action.engine || '') + " "
		+ (this.action.executable || this.action.command);

	this.log("handle : " + this.POST.handle);

	// array used to store concurrent similar actions
	this.similarActions = [];

	async.series([

		this.parseParameters.bind(this),
		this.handleDependenciesMTime.bind(this),
		this.handleExtraCacheMTime.bind(this),
		this.handleInputMTimes.bind(this),
		this.handleOutputDirectory.bind(this),
		this.handleLogAndCache.bind(this),
		this.executeAction.bind(this)

		],

		(err) => {

			if (err) {

				this.response.status = "ERROR";
				this.response.error = err;
				this.log("error for:");
				this.log(this.commandLine);
				this.log(err);
				console.log(new Error().stack);

			} else {

				this.log("done");

			}

			callback( this.response );

		}

	);

};

RPC.prototype.parseParameters = async function () {

	this.action.parameters.forEach( ( parameter, index ) => {

		const value = this.parseParameter( parameter );

		if ( typeof value !== "string" ) return;

		let prefix = this.action.parameters[ index ].prefix;
		if ( typeof prefix !== 'string' ) prefix = '';

		let suffix = this.action.parameters[ index ].suffix;
		if ( typeof suffix !== 'string' ) suffix = '';
		this.commandLine += ' '+ prefix + value +  suffix;

	} );

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

	if (parameter.type.indexOf("Array") < 0) value = value.toString();

	switch ( parameter.type ) {

	case 'file':
	case 'directory':

		const path = libpath.join( rootDir, value );
		this.POSTFiles[ parameter.name ] = path;
		return path.split( " " ).join( "\\ " );

	case 'fileArray':

		if ( files.some( file => !file ) ) throw 'Error : one file is empty';

		const files = value.map( file => libpath.join( rootDir, file ) );
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

			if ( dependency.includes('/') ) {

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

	await Promise.all( cache.map ( file =>
		this.addMTime( libpath.join( rootDir, file ) ) ) );

};

//const statAsync = util.promisify( fs.stat );

RPC.prototype.addMTime = async function ( file ) {

	if ( !file ) return;

	try {

		const stats = await fs.stat( file );
		if ( !stats.isFile() ) return callback();

		this.inputMTime = Math.max( stats.mtime.getTime(), this.inputMTime );

	} catch ( e ) {  }

};

RPC.prototype.handleInputMTimes = async function ( ) {

	await Promise.all( this.action.parameters.map ( async ( parameter ) => {

		if ( this.POST[ parameter.name ] === undefined ) return;

		switch ( parameter.type ) {

			case "file":
			case "directory" :

				await this.addMTime( libpath.join( rootDir,
					this.POST[ parameter.name ].toString() ) );

				break;

			case "fileArray" :

				await Promise.all( this.POST[ parameter.name ].map( async (file) => {

					await this.addMTime( libpath.join(rootDir, file.toString() ) );

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

		var shasum = crypto.createHash( 'sha1' );
		shasum.update( this.commandLine );
		var hash = shasum.digest( 'hex' );
		this.outputDirectory = libpath.join( "cache", hash.charAt(0), hash.charAt(1), hash );
		break;

	default :

		await exports.validatePathAsync( libpath.normalize(
			this.outputDirectory ).split( "/" )[ 0 ] );

	}

	await fs.mkdirs( libpath.join( rootDir, this.outputDirectory ) );

};

RPC.prototype.handleLogAndCache = async function ( ) {

	if ( this.outputDirectory.length ) {

		this.outputDirectory = libpath.normalize( this.outputDirectory );

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

		var outputFiles = this.action.output;

		Object.keys( outputFiles ).forEach( function ( output ) {

			var field = 'output' + output[ 0 ].toUpperCase() + output.slice( 1 );
			params[ field ] = this.response[ field ] = libpath.join( this.outputDirectory, outputFiles[ output ] );

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
	const actionFile = libpath.join( rootDir, this.outputDirectory, "action.json" );

	try {

		const stats = await fs.stat( actionFile )

		if  ( stats.mtime.getTime() < this.inputMTime ) return;

		if ( await fs.readFile( actionFile ) == this.parametersString ) {

			this.log("cached");
			this.cached = true;

		} 

	} catch ( e ) { }

};

RPC.prototype.executeAction = function ( callback ) {

	if ( this.cached ) return this.cacheAction( callback );

	this.startTime = new Date().getTime();
	this.writeJSON = false;

	const commandOptions = {

		cwd: libpath.join( rootDir, this.outputDirectory ),
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

	const shasum = crypto.createHash('sha1');
	shasum.update(this.parametersString + this.outputDirectory);
	const hash = shasum.digest('hex');
	const opts = ongoingActions[this.POST.handle];

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

		var actionParameters2 = _.extend( JSON.parse( this.parametersString ), this.POSTFiles );
		actionParameters2.output_directory =  libpath.join( rootDir, this.outputDirectory );
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

		this.logStream = fs.createWriteStream( libpath.join( rootDir,
			this.outputDirectory, "action.log" ) );
		this.logStream2 = fs.createWriteStream( libpath.join( rootDir,
			this.outputDirectory, "action.err" ) );
		child.stdout.pipe( this.logStream );
		child.stderr.pipe( this.logStream2 );

	}

};

RPC.prototype.cacheAction = async function ( callback ) {

	this.response.status = 'CACHED';
	const now = new Date();

	const promises = [

		fs.utimes( libpath.join( rootDir, this.outputDirectory, "action.json" ), now, now ),
		fs.utimes( libpath.join( rootDir, this.outputDirectory ), now, now )

	];

	if (this.POST.stdout) {


		for ( let extension of [ 'log', 'err' ] ) {

			promises.push( fs.readFile( libpath.join( rootDir,
				this.outputDirectory, 'action.' + extension ) ) );

		}

	} else {

		this.response.stdout = 'stdout and stderr not included. Launch action with parameter stdout=true';

	}

	const results = await Promise.all( promises );

	if ( results[ 2 ] ) this.response.stdout = results[ 2 ].toString();
	if ( results[ 3 ] ) this.response.stderr = results[ 3 ].toString();

	callback();

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

		fs.utimes( libpath.join( rootDir, this.outputDirectory ), now, now ),
		fs.writeFile(libpath.join(rootDir, this.outputDirectory, "action.json"),
			this.parametersString )

	] );

	callback();

};
