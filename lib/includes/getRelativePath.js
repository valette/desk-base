
exports.execute = function ( parameters, callback ) {

	const actions = require( __dirname + '/../index.js'),
		  path    = require( 'path' );

	var dirs = actions.getSettings().dataDirs;

	for ( let dir of Object.keys( dirs ) ) {

		let realPath = dirs[ dir ];
		if ( typeof realPath === 'object' ) {

			realPath = realPath.path;

		}

		if ( parameters.path.indexOf( realPath ) === 0 ) {

			callback( null, path.join( dir, parameters.path.slice( realPath.length ) ) );
			return;

		}

	}

	callback( "getRelativePath : invalid path : " +  parameters.path );

};
