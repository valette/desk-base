'use strict';

process.env.DESK_SINGLE = '1';

const fs       = require( 'fs-extra' ),
      os       = require( 'os' ),
      path     = require( 'path' ),
      desk     = require( '../lib/cl-rpc.js' );

const rootDir = fs.mkdtempSync( path.join( os.tmpdir(), 'desk-test-' ) );

desk.setLogToConsole( false );
desk.setEmitLog( false );
desk.setRootDir( rootDir );

desk.include( path.join( __dirname, 'fixtures', 'test-actions.json' ), -2 );

function cleanup () {

	try { fs.removeSync( rootDir ); } catch ( e ) {}

}

module.exports = { desk, rootDir, cleanup };
