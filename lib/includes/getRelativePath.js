
exports.execute = async function ( parameters ) {

	const actions = require( __dirname + '/../index.js'),
		  path    = require( 'path' );

	const dirs = actions.getSettings().dataDirs;

	for ( let dir of Object.keys( dirs ) ) {

		let realPath = dirs[ dir ];
		if ( typeof realPath === 'object' ) realPath = realPath.path;

		if ( parameters.path.indexOf( realPath ) === 0 ) {

			return path.join( dir, parameters.path.slice( realPath.length ) );

		}

	}

	throw "getRelativePath : invalid path : " +  parameters.path;

};
