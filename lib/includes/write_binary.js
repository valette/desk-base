const fs = require( 'fs-extra' );

exports.execute = async function ( parameters ) {

	await fs.mkdirs( parameters.output_directory );
	await fs.writeFile( parameters.output_directory + "/" + parameters.file_name,
			new Buffer( parameters.base64data, 'base64' ) );

};
