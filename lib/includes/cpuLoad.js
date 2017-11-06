const os = require('os');

const nCPUS = os.cpus().length;

exports.execute = async function ( parameters ) {

	return JSON.stringify( os.loadavg().map( avg => avg / nCPUS ) );

};

