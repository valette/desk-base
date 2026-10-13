const fs = require( 'fs-extra' );

exports.execute = async function ( parameters ) {

	await fs.mkdirs( parameters.output_directory );
	await fs.writeFile( parameters.output_directory + "/result.txt", parameters.content );
	return parameters.content;

};
