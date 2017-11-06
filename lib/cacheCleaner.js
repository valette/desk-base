const EventEmitter = require('events').EventEmitter,
	  fs           = require('fs-extra'),
	  path         = require('path'),
	  ms           = require('ms'),
	  promisify    = Promise.promisify || require('util').promisify,
	  exec         = promisify( require('child_process').exec );

exports = module.exports = new EventEmitter();

exports.cleanCache = async function ( cwd, maxAge ) {

	exports.emit( 'log', new Date().toLocaleString() +
		' : Start clean cache (maxAge : '+ ms( maxAge, { long: true } ) + ')' );

	if ( !fs.existsSync( cwd ) ) throw 'wrong cache directory :' + cwd;
	let numberOfOldDirectories = 0;
	let numberOfDirectories = 0;
	console.time( 'cache cleaning' );

	for ( let subdir of await fs.readdir( cwd ) ) {

		const dir1 = path.join( cwd, subdir );

		if ( !( await fs.stat( dir1 ) ).isDirectory() ) continue;

		for ( let subdir2 of await fs.readdir( dir1 ) ) {

			const dir2 = path.join( dir1, subdir2 );

			if ( !( await fs.stat( dir2 ) ).isDirectory() ) continue;

			for ( let subdir3 of await fs.readdir( dir2 ) ) {

				const dir3 = path.join( dir2, subdir3 );
				const stats = await fs.stat( dir3 );

				if ( !stats.isDirectory() ) continue;

				numberOfDirectories++;
				const time = stats.mtime.getTime();
				const currentTime = new Date().getTime();
				const age = currentTime - time;

				if ( age <  maxAge ) continue;

				numberOfOldDirectories++;
				await exec( 'rm -rf ' + path.join( subdir, subdir2, subdir3 ), { cwd } );

			}

		}

	}

	exports.emit( 'log', 'cache cleaning done, ' + numberOfOldDirectories
		+ '/' + numberOfDirectories + ' directories deleted ' );

	console.timeEnd( 'cache cleaning' );

};
