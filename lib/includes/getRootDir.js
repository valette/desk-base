
exports.execute = function (parameters, callback) {

	const actions = require( __dirname + '/../index.js');
	callback( null, actions.getRootDir() );

};
