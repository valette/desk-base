const EventEmitter = require( 'events' ).EventEmitter,
      fs           = require( 'fs-extra' ),
      path         = require( 'path' ),
      promisify    = Promise.promisify || require( 'util' ).promisify,
      throttle     = require( 'lodash' ).throttle;

exports = module.exports = new EventEmitter();

// object storing all the actions
let actions;

// object containing all settings : dataDirs, actions etc...
let settings;

// base directory where all data files are (data, cache, actions, ..)
let rootDir;

// random value to detect server crash...
const randomValue = Math.random();

// files/directories where user can add their own action definitions
let includes;

// allowed sub-directories in rootDir. They are automatically created if not existent
const directories = [];
let dataDirs = {};

// .js files to load by the client during startup
let initFiles = [];

// permissions level (1 by default)
let permissions;

// one watcher for each json configuration file or directory
let watchedFiles = {};

let version = 0;

const fullPath = exports.fullPath = ( ...dirs ) => {

	const dir = path.join( ...dirs );
	if ( dir.includes( '..' ) ) throw ( "path forbidden : " + dir );
	return path.join( rootDir, dir );

}

function log( msg ) { exports.emit( 'log', msg ); }

exports.setRootDir = function ( dir ) {

	rootDir = dir;

	const extensionsDir = fullPath( 'extensions') + '/';
	fs.mkdirsSync( extensionsDir );

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
	
	fs.realpath( fullPath( dir ), ( err, realPath ) => {

		if ( !err && !directories.some( subDir =>
			realPath.slice( 0, subDir.length ) === subDir ) ) {

			err = "path " + dir + " not allowed"; 

		}

		callback ( err );

	} );

};

exports.validatePathAsync = promisify( exports.validatePath );

const update = throttle( updateSync, 1000, { leading: false } );

function watch ( file ) {

	if ( !fs.existsSync( file ) ) {

		log( "Warning : no file " + file + " found. Will watch parent directory for updates" );
		file = path.dirname( file );

	}

	watchedFiles[ file ] = fs.watch( file, update );

}

exports.include = function ( file, priority ) {

	priority = priority || 0;
	if ( watchedFiles[ file ] ) return;
	include( file, priority );
	includes.push( { file , priority } );
	exportActions();

};

function includeDirectory ( dir, priority, visited ) {

	priority = priority || 0;

	for ( let child of fs.readdirSync( dir ) ) {

		const fullChild = path.join( dir, child );

		if ( !visited && fs.statSync( fullChild ).isDirectory() ) {

			includeDirectory( fullChild, priority, true );

		} else if ( path.extname( child ).toLowerCase() === '.json' ) {

			include( fullChild, priority );

		}

	}

}

function include ( file, priority ) {

	if ( watchedFiles[ file ] ) return log( 'WARNING : ' + file + ' included twice' );

	priority = priority || 0;

	watch( file );
	let lib;

	try {

		if ( fs.statSync( file ).isDirectory() ) return includeDirectory( file, priority );

		log('include : ' + file);

		lib = path.basename( file, path.extname( file ) );
		const actionsObject = require( file );
		delete require.cache[ require.resolve( file ) ];

		const localActions = actionsObject.actions || [];
		const dir = fs.realpathSync( path.dirname( file ) );

		for ( let name of Object.keys( localActions ) ) {

			const action = localActions[ name ];
			action.lib = action.lib || lib;

			// backwards compatibility
			if ( action.attributes ) {

				Object.assign( action, action.attributes );
				delete action.attributes;

			}

			if ( typeof ( action.js ) === 'string' ) {

				const jsRequire = path.join( dir, action.js );
				log('load js from ' + jsRequire + '.js' );
				action.module = require( jsRequire );

				action.module.executeAsync = params =>

					new Promise( resolve => {

						const test = action.module.execute( params, ( err, res ) =>

							resolve( { err, stdout : res } ) );

						if ( test && ( typeof test.then === 'function' ) ) {

							test.then( res => resolve ( { stdout : res } ) )
								.catch( err => resolve( { err } ) );

						}

					} );

				delete require.cache[ require.resolve( jsRequire ) ];
				action.executable = path.join( dir, action.js + '.js' );
				watch( action.executable );

			} else if ( typeof ( action.executable ) === 'string' ) {

				if ( action.executable.charAt( 0 ) !== '/' ) {

					action.executable = path.join(dir, action.executable);

				}

			}

			if ( action.priority === undefined ) action.priority = priority;

			if ( action.dependencies ) {

				action.dependencies = action.dependencies.map( dep => {

					return dep.includes( '/' ) ? path.join( dir, dep ) : dep;

				} );

			}

			if ( actions[ name ] && ( action.priority < actions[ name ].priority ) ) {

				continue;

			}

			actions[ name ] = action;

		}

		const dirs = actionsObject.dataDirs || {};

		for ( let key of Object.keys( dirs ) ) {

			let source = dirs[ key ];
			let obj;

			if ( typeof source === 'object' ) {

				obj = source;
				source = obj.path;

			}

			if ( source.indexOf( '/' ) > 0 ) {

				// source is relative
				source = path.join(path.dirname( file ), source );

			} else if ( source.indexOf( '/' ) < 0 ) {

				//source is a simple directory
				source = fullPath( source );

			}

			addDirectory( key, source );

			if (obj) {

				obj.path = source;
				source = obj;

			}

			dataDirs[ key ] = source;

		}

		for ( let child of ( actionsObject.include || [] ) ) {

			if ( child.charAt( 0 ) !== '/' ) {

				// the path is relative. Prepend directory
				child = path.join( path.dirname( file ), child );

			}

			include(child, priority);

		}

		for ( let file of ( actionsObject.init || [] ) ) {

			initFiles.push( file )
			watch(fullPath( file ) );

		}

		if ( typeof( actionsObject.permissions ) === 'number' ) {

			permissions = Math.min( permissions, actionsObject.permissions );

		}

	} catch ( error ) {

		log( 'error importing ' + file );
		log( error.toString() );
		if ( lib ) actions[ 'import_error_' + lib ] = { lib : lib };

	}

};

function addDirectory( key, source ) {

	const dir = fullPath( key )

	if ( source === dir ) {

		if ( !fs.existsSync( dir ) ) {

			fs.mkdirSync( dir );
			log( 'directory ' + dir + ' created' );

		}

	} else {

		if ( !fs.existsSync( dir ) || !( fs.readlinkSync( dir ) === source ) ) {

			try {

				fs.unlinkSync( dir );
				log( "removed wrong symbolic link " + dir );

			} catch (e) {}

			if ( fs.existsSync( source ) ) {

				fs.symlinkSync( source, dir, 'dir' );
				log( 'directory ' + dir + ' created as a symlink to ' + source );

			} else {

				log( 'ERROR : Cannot create directory ' + dir + ' as source directory '
					+ source + ' does not exist' );
				return;

			}
		}
	}

	directories.push( fs.realpathSync( dir ) );
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
	for ( let file of Object.keys( watchedFiles ) ) watchedFiles[ file ].close();
	watchedFiles = {};

	for ( let file of includes ) include( file.file, file.priority );

	exportActions();

}

function exportActions() {

	// filter actions according to permissions
	for ( let action of Object.keys( actions ) ) {

		let perm = actions[ action ].permissions;
		if ( perm !== 0 ) perm = 1;
		if ( permissions < perm ) delete actions[ action ];

	}

	let visited;

	function visit( root, actionName ) {

		if ( visited[ actionName ] ) return;
		const obj = actions[ actionName ];
		if ( !obj ) return log( "WARNING : action '" + root +
			"' : incorrect dependency : '" + actionName + "'" );

		visited[ actionName ] = obj;

		if ( !obj.dependencies ) return;
		for ( let dep of obj.dependencies.filter( d => !d.includes( '/' ) ) ) {

			visit( root, dep );

		}

	}

	for ( let [ name, action ] of Object.entries( actions ) ) {

		visited = {};
		visit( name, name );
		const deps = action.deps = [];
		const included = {};

		for ( let [ actionName, obj ] of Object.entries( visited ) ) {

			for ( let dependency of [ obj.executable,
				...( obj.dependencies || [] )
					.filter( d => d.includes( '/' ) ) ] ) {

				if ( !dependency || included[ dependency ] ) continue;
				deps.push( dependency );
				included[ dependency ] = true;

			}

		}

	}

	log( Object.keys( actions ).length + ' actions included' );

	version++;

	settings = { actions, permissions, dataDirs, init : initFiles,
		time : process.hrtime(), version, randomValue };

	// export filtered actions.json
	log( "version : " + version );
	fs.writeFileSync( fullPath( "actions.json" ), JSON.stringify( settings, null, '\t' ) );
	exports.emit( "actions updated", settings );

}
