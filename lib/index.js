const actions      = require( './cl-rpc.js' );
      cacheCleaner = require( './cacheCleaner.js' );
      CronJob      = require( 'cron' ).CronJob,
      ipc          = require( 'node-ipc' ).default,
      path         = require( 'path' ),
      ms           = require( 'ms' ),
      os           = require( 'os' );

// base directory where all data files are (data, cache, actions, ..)
const rootDir = path.join( os.homedir(), 'desk' ) + '/';
actions.setRootDir( rootDir );
exports = module.exports = actions;

if ( process.env.DESK_SINGLE ) return;

const maxAge = ms( '30d' );

cacheCleaner.on( "log", message => actions.emit( "log", message ) );

new CronJob( {

	cronTime: '0 0 ' + Math.floor( 5 * Math.random() ) + ' * * *',
	start: true,

	onTick: function () {

		cacheCleaner.cleanCache( path.join( rootDir, 'cache' ), maxAge );

	}

} );

ipc.config.socketRoot = rootDir;
ipc.config.silent = true;
ipc.config.id = 'socket';

ipc.serve( function () {

	ipc.server.on( 'execute', async function( action, socket ) {

		const response = await actions.execute( action );
		ipc.server.emit( socket, 'action finished', response );

	} );

} );

ipc.server.start();
