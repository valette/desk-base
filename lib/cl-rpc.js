'use strict';

const async        = require('async'),
      crypto       = require('crypto'),
      exec         = require('child_process').exec,
      EventEmitter = require('events').EventEmitter,
      fs           = require('fs-extra'),
      libpath      = require('path'),
      os           = require('os'),
      prettyPrint  = require('pretty-data').pd,
      psTree       = require('ps-tree'),
      spawn        = require('child_process').spawn,
      _            = require('lodash');

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

function include (file, priority, visited) {
	if (watchedFiles[file]) {
		// file has already been included
		return;
	}

	priority = priority || 0;

	watch(file);

	try {

		if (fs.statSync(file).isDirectory() && !visited) {
			fs.readdirSync(file).forEach(function(child) {
				include(libpath.join(file, child), priority, true);
			});
			return;
		}

		if (libpath.extname(file).toLowerCase() !== '.json') {
			return;
		}

		log('importing ' + file);

		var lib = libpath.basename(file, '.json');
		var actionsObject = JSON.parse(fs.readFileSync(file));

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
				log('loaded javascript from ' + action.js);
				var jsRequire = libpath.join(dir, action.js);
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
	var extensionsDir = libpath.join(rootDir, 'extensions') + '/';
	fs.readdirSync(extensionsDir).forEach(function(child) {
		include(libpath.join(extensionsDir, child));
	});

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
	fs.writeFileSync(libpath.join(rootDir, "actions.json"), prettyPrint.json(globalSettings));
	exports.emit("actions updated", globalSettings);
};

var update = _.throttle(updateSync, 1000, {leading: false});

var validateValue = function (value, parameter) {
	['min', 'max'].forEach(function (bound) {
		if (!parameter[bound]) {return;}
		var compare = parseFloat(parameter[bound]);
		if (bound === 'min' ? value > compare : value < compare) {
			return ('error for parameter ' + parameter.name +
				' : ' + bound + ' value is ' + compare)
		}
	});
}

var manageActions = function (POST, callback) {
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

var queue = async.queue(function (task, callback) {
	new RPC(task, callback);
}, os.cpus().length);


exports.execute = function (POST, callback) {
	POST.handle  = POST.handle || Math.random().toString();
	ongoingActions[POST.handle] =  {POST : POST};

	if (POST.manage) {
		manageActions(POST, finished);
	} else {
		var action = actions[POST.action];
		if (action && action.lib === "base") {
			new RPC(POST, finished);
			return;
		}
		queue.push(POST, finished);
	}

	function finished(msg) {
		msg.handle = POST.handle;
		delete ongoingActions[POST.handle];
		callback(msg);
	}
};

var actionsDirectoriesQueue = async.queue(function (task, callback) {
	var counterFile = libpath.join(rootDir, "actions/counter.json");
	fs.readFile(counterFile, function (err, data) {
		var index = 1;
		if (!err) {index = JSON.parse(data).value + 1;} 

		var outputDirectory = libpath.join("actions", index + "");
		fs.mkdirs(libpath.join(rootDir, outputDirectory), function (err) {
			if ( err ) {
				callback( err.message );
				return;
			}
			fs.writeFile(counterFile, JSON.stringify({value : index}), 
				function(err) {
					if (err) {
						callback(err);
						return;
					}
					callback(null, outputDirectory);
				}
			);
		});
	});
}, 1);

var RPC = function (POST, callback) {
	this.id = actionsCounter++;

	this.POST = POST;
	this.POSTFiles = {};
	this.inputMTime = -1;

	var header = "[" + this.id + "] ";
	this.log = POST.silent ? () => {} : (msg) => log(header + msg);

	this.response = {};
	this.action = actions[POST.action];
	this.cached = false;

	if (!this.action) {
		callback({error : "action " + POST.action + " not found"});
		return;
	};

	this.commandLine = "nice " + (this.action.engine || '') + " "
		+ (this.action.executable || this.action.command);
	this.log("handle : " + this.POST.handle);

	// array used to store concurrent similar actions
	this.similarActions = [];

	async.series([
		this.parseParameters.bind(this),
		this.handleExecutableMTime.bind(this),
		this.handleInputMTimes.bind(this),
		this.handleOutputDirectory.bind(this),
		this.handleLogAndCache.bind(this),
		this.checkMemory.bind(this),
		this.executeAction.bind(this)
		],
		(err) => {
			if (err) {
				this.response.status = "ERROR";
				this.response.error = err;
				this.log("error for:");
				this.log(this.commandLine);
				this.log(err);
			} else {
				this.log("done");
			}
			callback(this.response);
		}
	);
};

RPC.prototype.parseParameters = function (callback) {
	async.map(this.action.parameters,
		this.parseParameter.bind(this),
		(err, values) => {
			values.forEach( (value, index) => {
				if (typeof value === "string") {
					var prefix = this.action.parameters[index].prefix;
					if (typeof prefix !== 'string') prefix = '';
					var suffix = this.action.parameters[index].suffix;
					if (typeof suffix !== 'string') suffix = '';

					this.commandLine += ' '+ prefix + value +  suffix;
				}
			});
			callback (err);
		});
};

RPC.prototype.parseParameter = function (parameter, cb) {

	function callback (err, value) {
		if (err) {
			err = "error for parameter " + parameter.name + " : " + err;
		}
		cb (err, value);
	}

	if (parameter.text !== undefined) {
		// parameter is actually a text anchor
		callback(null, parameter.text);
		return;
	}

	var value = this.POST[parameter.name];

	if (value === undefined || value === null) {
		if (parameter.required) {
			callback ("parameter " + parameter.name + " is required!");
		} else {
			callback();
		}
		return;
	}

	if (parameter.type.indexOf("Array") < 0) {
		value = value.toString();
	}

	switch (parameter.type) {
	case 'file':
	case 'directory':
		var path = libpath.join(rootDir, value);
		this.POSTFiles[parameter.name] = path;
		callback (null, path.split(" ").join("\\ "));
		break;
	case 'fileArray':
		var failed = false;
		var files = value.map( function (file) {
			if ( !file ) {
				failed = true;
				return;
			}
			return libpath.join(rootDir, file);
		} );
		if ( failed ) {
			callback( 'Error : one file is empty' );
			return;
		}
		this.POSTFiles[parameter.name] = files;
		callback (null, files.map(function (file) {
			return file.split(" ").join("\\ ");
		}).join(" "));
		break;
	case 'int':
		var number = parseInt(value, 10);
		if (isNaN(number)) {
			callback ("parameter " + parameter.name + " must be an integer value");
		} else {
			callback (validateValue(number, parameter), value);
		}
		break;
	case 'float':
		number = parseFloat(value);
		if (isNaN(number)) {
			callback ("parameter " + parameter.name + " must be a floating point value");
		} else {
			callback (validateValue(number, parameter), value);
		}
		break;
	case 'text':
	case 'string':
	case 'base64data':
		callback (null, value.split(" ").join("\\ "));
		break;
	case 'flag' :
		value = '' + value;
		switch(value){
			case "true":
			case "yes":
			case "1":
				callback (null, '');
				break;
			case "false":
			case "no":
			case "0":
				callback (null, '');
				break;
			default:
				callback ("parameter " + parameter.name + " must be a boolean");
		}
		break;
	default:
		callback ("parameter type not handled : " + parameter.type);
	}
};

RPC.prototype.handleExecutableMTime = function (callback) {
	this.addMTime(this.action.executable, callback);
};

RPC.prototype.addMTime = function (file, callback) {
	if (!file) {
		callback();
		return;
	}
	fs.exists(file, (exists) => {
		if (!exists) {
			callback();
			return;
		}
		fs.stat(file , (err, stats) => {
			if (!err) {
				this.inputMTime = Math.max(stats.mtime.getTime(), this.inputMTime);
			}
			callback (err);
		});
	});
};

RPC.prototype.handleInputMTimes = function (callback) {
	async.each(this.action.parameters, (parameter, callback) => {
		if (this.POST[parameter.name] === undefined) {
			callback();
			return;
		}
		switch (parameter.type) {
			case "file":
			case "directory" : 
				this.addMTime(libpath.join(rootDir, this.POST[parameter.name].toString()), callback);
				break;
			case "fileArray" :
				async.each(this.POST[parameter.name], (file, callback) => {
					this.addMTime(libpath.join(rootDir, file.toString()), callback);
				}, callback);
				break;
			default : 
				callback();
		}
	},
	function (err) {
			callback(err);
		}
	);
};

RPC.prototype.handleOutputDirectory = function (callback) {
	if (permissions === 0) {this.POST.output_directory = "cache/";}

	if (this.inputMTime > 0) {
		this.response.timeStamp = this.inputMTime;
	}
	this.outputDirectory = this.POST.outputDirectory || this.POST.output_directory || "";

	if (this.action.voidAction) {
		callback();
		return;
	}

	switch (this.outputDirectory) {
	case "actions/" :
		actionsDirectoriesQueue.push({}, (err, dir) => {
			this.outputDirectory = dir;
			callback(err);
		});
		break;
	case "cache/" :
	case "" : 
		var shasum = crypto.createHash('sha1');
		shasum.update(this.commandLine);
		var hash = shasum.digest('hex');
		this.outputDirectory = libpath.join("cache", hash.charAt(0), hash.charAt(1), hash);
		fs.mkdirs(libpath.join(rootDir, this.outputDirectory), callback);
		break;
	default :
		exports.validatePath (libpath.normalize(this.outputDirectory).split("/")[0], (err) => {
			if (err) {
				callback(err);
				return;
			}
			fs.mkdirs(libpath.join(rootDir, this.outputDirectory), callback);
		});
	}
};

RPC.prototype.handleLogAndCache = function (callback) {
	if (this.outputDirectory.length) {
		this.outputDirectory = libpath.normalize(this.outputDirectory);
		if (this.outputDirectory.charAt(this.outputDirectory.length -1) !== "/") {
			this.outputDirectory += "/";
		}
		this.response.outputDirectory = this.outputDirectory;
		if (this.POST.stream) {
			exports.emit("actionEvent", {
				handle : this.POST.handle,
				type : "outputDirectory",
				data : this.outputDirectory
			});
		}
	}

	var params = {action : this.POST.action, output_directory :  this.outputDirectory};
	this.action.parameters.forEach(function (parameter) {
		params[parameter.name] = this.POST[parameter.name];
	}, this);
	this.parametersString = JSON.stringify(params);

	this.log ('in : ' + this.outputDirectory);

	if (this.commandLine.length < 500) {
		this.log(this.commandLine);
	} else {
		this.log(this.commandLine.substr(0,500) + '...[trimmed]');
	}

	if (this.action.voidAction || this.POST.force_update || this.action.noCache) {
		callback();
		return;
	}

	// check if action was already performed
	var actionFile = libpath.join(rootDir, this.outputDirectory, "action.json");
	fs.stat(actionFile, (err, stats) => {
		if ((err) || (stats.mtime.getTime() < this.inputMTime)) {
			callback();
			return;
		}
		fs.readFile(actionFile, (err, data) => {
			if (data == this.parametersString) {
				this.log("cached");
				this.cached = true;
			} 
			callback();
		});
	});

};

var totalMem = os.totalmem();
var requiredAvailableMemoryRatio = parseInt(process.env.DESK_MEMORY_RATIO || '0');
var availableMemoryRatio;
var memoryUpdatePeriod = 5000;
var getAvailableMemory = function () {
	setTimeout(getAvailableMemory, memoryUpdatePeriod);
	var prc = spawn('free');
	prc.stdout.on('data', function (data) {
		availableMemoryRatio = data.toString()
			.split(/\n/g)
			.map(line => line.split(/\s+/))
			[1][6]
			* 1000 / totalMem;
	});
}
getAvailableMemory();

RPC.prototype.checkMemory = function (callback) {
	if (this.cached) {
		callback();
		return;
	}

	var first = true;
	async.whilst( function () {
		return  availableMemoryRatio < requiredAvailableMemoryRatio;
	}, function (callback) {
		if (first) {
			log("Available memory below " + (requiredAvailableMemoryRatio * 100)
				+ "\% : one action delayed");
		}
		first = false;
		setTimeout(callback, memoryUpdatePeriod);
	}, callback);
};

RPC.prototype.executeAction = function (callback) {
	if (this.cached) {
		this.cacheAction(callback);
		return;
	}

	this.startTime = new Date().getTime();
	this.writeJSON = false;

	var commandOptions = {
		cwd: libpath.join(rootDir, this.outputDirectory),
		maxBuffer : 1e10,
		env : Object.assign({}, process.env, this.action.env)
	};

	if (!this.action.voidAction) {
		this.writeJSON = true;
	}

	var after = (err, stdout, stderr) => {
		this.afterExecution(err, stdout, stderr, callback);
		delete ongoingActions2[hash];
		this.similarActions.forEach((opts) => {
			opts.RPC.afterExecution(err, stdout, stderr, opts.callback);
			this.log("triggering completion for same action [" + opts.RPC.id + "]");
		});
	};

	var shasum = crypto.createHash('sha1');
	shasum.update(this.parametersString + this.outputDirectory);
	var hash = shasum.digest('hex');
	var opts = ongoingActions[this.POST.handle];

	if (opts.toKill) {
		this.log("execution aborted due to kill request");
		after({killed : true});
		return;
	}

	opts.RPC = this;
	opts.callback = callback;

	var existingOpts = ongoingActions2[hash];
	if (existingOpts) {
		opts.childProcess = existingOpts.childProcess;
		existingOpts.RPC.similarActions.push(opts);
		this.log("same as action [" + existingOpts.RPC.id + "], wait for its completion");
		return;
	}

	var js = this.action.module;
	if ( typeof (js) === "object" ) {
		var actionParameters2 = _.extend(JSON.parse(this.parametersString), this.POSTFiles);
		actionParameters2.output_directory =  libpath.join(rootDir, this.outputDirectory);
		js.execute(actionParameters2, after);
		return;
	}

	var child = opts.childProcess = exec(this.commandLine, commandOptions, after);
	ongoingActions2[hash] = opts;

	if (this.POST.stream) {
		this.log("will stream stdout and stderr to client");
		["stdout", "stderr"].forEach(function (type) {
			child[type].on("data", data => {
				exports.emit("actionEvent", {
				type : type,
				handle : this.POST.handle,
				data : data
			})});
		}, this);
	}

	if (this.outputDirectory) {
		this.logStream = fs.createWriteStream(libpath.join(rootDir, this.outputDirectory, "action.log"));
		this.logStream2 = fs.createWriteStream(libpath.join(rootDir, this.outputDirectory, "action.err"));
		child.stdout.pipe(this.logStream);
		child.stderr.pipe(this.logStream2);
	}
};

RPC.prototype.cacheAction = function (callback) {
	this.response.status = 'CACHED';
	var now = new Date();

	async.parallel([

		(callback) => {
			fs.utimes(libpath.join(rootDir, this.outputDirectory, "action.json"), now, now, callback);
		},

		(callback) => {
			fs.utimes(libpath.join(rootDir, this.outputDirectory), now, now, callback);
		},

		(callback) => {
			if (this.POST.stdout) {
				async.parallel([ (callback) => {
						fs.readFile(libpath.join(rootDir, this.outputDirectory, 'action.log'),
							(err, content) => {
								if (content) this.response.stdout = content.toString();
								callback();
						});
					},
					(callback) => {
						fs.readFile(libpath.join(rootDir,this.outputDirectory, 'action.err'),
							(err, content) => {
								if (content) this.response.stderr = content.toString();
								callback();
						});
					}],
				callback);
			} else {
				this.response.stdout = 'stdout and stderr not included. Launch action with parameter stdout=true';
				callback();
			}
		}
	], callback);
};

RPC.prototype.afterExecution = function(err, stdout, stderr, callback) {
	if (this.logStream) {
		this.logStream.end();
		this.logStream2.end();
	}

	if (this.POST.stdout) {
		this.response.stdout = stdout;
		this.response.stderr = stderr;
	} else {
		this.response.stdout = 'stdout and stderr not included. Launch action with parameter stdout=true';
	}

	if (err) {
		if (err.killed) {
			this.response.status = "KILLED";
			callback();
		} else {
			callback(err);
		}
		return;
	}

	this.response.status = 'OK (' + (new Date().getTime() - this.startTime) / 1000 + 's)';
	if (!this.writeJSON) {
		callback();
		return;
	}
	// Touch output directory to avoid automatic deletion
	var now = new Date();
	fs.utimes(libpath.join(rootDir, this.outputDirectory), now, now);

	fs.writeFile(libpath.join(rootDir, this.outputDirectory, "action.json"),
		this.parametersString, (err) => {
		if (err) {throw err;}
		callback();
	});
};
