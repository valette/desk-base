const cp           = require('child_process'),
	  EventEmitter = require('events').EventEmitter,
	  fs           = require('fs'),
	  libpath      = require('path'),
	  ms           = require('ms'),
	  util         = require('util');

const [ readdir, stat, exec ] = [ fs.readdir, fs.stat, cp.exec ].map(
	Promise.promisify || util.promisify );

exports = module.exports = new EventEmitter();

exports.cleanCache = async function ( dir, maxAge ) {

	exports.emit( 'log', new Date().toLocaleString()
		+ ' : Start clean cache (maxAge : '+ ms(maxAge, {long: true}) + ')' );

	if ( !fs.existsSync( dir ) ) {

		exports.emit( 'log', 'error : wrong cache directory :' + dir );
		return;

	}

	let numberOfOldDirectories = 0;
	let numberOfDirectories = 0;

	console.time( 'cache cleaning' );

	for ( let subdir of await readdir( dir ) ) {

		const dir1 = libpath.join( dir, subdir );

		if ( !( await stat( dir1 ) ).isDirectory() ) continue;

		for ( let subdir2 of await readdir( dir1 ) ) {

			const dir2 = libpath.join( dir1, subdir2 );

			if ( !( await stat( dir2 ) ).isDirectory() ) continue;

			for ( let subdir3 of await readdir( dir2 ) ) {

				const dir3 = libpath.join( dir2, subdir3 );
				const stats = await stat( dir3 );

				if ( !stats.isDirectory() ) continue;

				numberOfDirectories++;
				const time = stats.mtime.getTime();
				const currentTime = new Date().getTime();
				const age = currentTime - time;

				if (age <  maxAge) continue;

				numberOfOldDirectories++;
				await exec('rm -rf ' + libpath.join (subdir, subdir2, subdir3 ), { cwd : dir } );

			}

		}

	}

	exports.emit( 'log', 'cache cleaning done, ' + numberOfOldDirectories
		+ '/' + numberOfDirectories + ' directories deleted ' );

	console.timeEnd( 'cache cleaning' );

};
