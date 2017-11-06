
exports.execute = async function ( parameters ) {

	const actions = require( __dirname + '/../index.js' );
	return actions.getRootDir();

};
