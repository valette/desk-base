var async   = require('async'),
    fs      = require('fs-extra'),
    libPath = require('path');

exports.execute = function (parameters, callback) {
	var dir = parameters.directory;

	async.waterfall([
		function (callback) {
			fs.readdir(dir, callback)
		},
		function (files, callback) {
			async.map(files, function (file, callback) {
				fs.stat(libPath.join(dir, file), function (err, stats) {
					var res;
					if (err) {
						// broken symlinks cause error...
						res = {
							name : file,
							size : 0,
							isDirectory : 0,
							mtime : 0
						};
					} else {
						res = {
							name : file,
							size : stats.size,
							isDirectory : stats.isDirectory(),
							mtime : stats.mtime.getTime()
						};
					}
					callback(null, res);
				});
			}, callback);
		}],
		function (error, files) {
			callback (error, JSON.stringify(files || []));
		}
	);
};
