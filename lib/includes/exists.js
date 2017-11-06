const fs = require( 'fs-extra' );

exports.execute = async function ( parameters ) {

	return JSON.stringify( await fs.exists( parameters.path ) );

};
