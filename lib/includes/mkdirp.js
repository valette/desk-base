const fs = require( 'fs-extra' );

exports.execute = async function ( parameters ) {

	await fs.mkdirs( parameters.directory );

};
