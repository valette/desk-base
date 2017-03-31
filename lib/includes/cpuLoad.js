const os = require('os');

const nCPUS = os.cpus().length;

exports.execute = function ( parameters, cb ) {

	setTimeout( function () {

		cb ( null, JSON.stringify( os.loadavg().map( avg => avg / nCPUS ) ) );

	}, 1 );

};

