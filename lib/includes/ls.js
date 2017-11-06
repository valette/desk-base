const fs   = require( 'fs-extra' ),
      path = require( 'path' );

exports.execute = async function ( parameters ) {

	const dir = parameters.directory;

	const promises = ( await fs.readdir( dir ) )
		.map( async file => {

			try {

				const stats = await fs.stat( path.join( dir, file ) );

				return {

					name : file,
					size : stats.size,
					isDirectory : stats.isDirectory(),
					mtime : stats.mtime.getTime()

				};

			} catch ( e ) {

				// broken symlinks cause error...
				return {

					name : file,
					size : 0,
					isDirectory : 0,
					mtime : 0

				};

			}

		} )

	return JSON.stringify( await Promise.all( promises ) );

};
