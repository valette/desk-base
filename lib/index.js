const actions      = require(__dirname + '/cl-rpc.js');
      cacheCleaner = require(__dirname + '/cacheCleaner.js');
      CronJob      = require('cron').CronJob,
      ipc          = require('node-ipc'),
      path         = require('path'),
      ms           = require('ms'),
      os           = require('os');

// base directory where all data files are (data, cache, actions, ..)
const rootDir = path.join( os.homedir(), 'desk' ) + '/';
const maxAge = ms( '30d' );

cacheCleaner.on("log", function ( message ) {

	console.log( message );
	actions.emit("log", message)

} );

new CronJob( {

	cronTime: '0 0 ' + Math.floor( 5 * Math.random() ) + ' * * *',
	start: true,
	onTick: function () {

		cacheCleaner.cleanCache( path.join( rootDir, 'cache' ), maxAge );

	}

} );

actions.setRootDir( rootDir );
ipc.config.socketRoot = rootDir;
ipc.config.silent = true;
ipc.config.id = 'socket';

ipc.serve( function () {

	ipc.server.on('execute', function( action, socket ) {

		actions.execute( action, function ( response ) {

			ipc.server.emit( socket, 'action finished', response );

		} );

	} );

} );

ipc.server.start();
exports = module.exports = actions;
