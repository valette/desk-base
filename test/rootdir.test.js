'use strict';

const { test } = require( 'node:test' );
const assert  = require( 'node:assert' );
const os      = require( 'node:os' );
const path    = require( 'node:path' );
const { execFileSync } = require( 'node:child_process' );

const ENTRY = path.join( __dirname, '..', 'lib', 'index.js' );

function rootDirFrom( env ) {

	const script = 'const desk = require( process.argv[1] );' +
		'process.stdout.write( String( desk.getRootDir() ) );' +
		'process.exit( 0 );';

	const out = execFileSync( process.execPath, [ '-e', script, ENTRY ], {
		env: Object.assign( { DESK_SINGLE: '1' }, env ),
		encoding: 'utf8'
	} );

	return out.split( '\n' ).pop();

}

test( 'DESK_ROOTDIR overrides the default root directory', () => {

	const custom = path.join( os.tmpdir(), 'desk-custom-root-' + process.pid );

	const rootDir = rootDirFrom( { DESK_ROOTDIR: custom } );

	assert.strictEqual( rootDir, custom + '/' );

} );

test( 'default root is under the home directory when DESK_ROOTDIR is unset', () => {

	const rootDir = rootDirFrom( {} );

	assert.strictEqual( rootDir, path.join( os.homedir(), 'desk' ) + '/' );

} );

test( 'DESK_ROOTDIR accepts an absolute path with a trailing slash', () => {

	const custom = path.join( os.tmpdir(), 'desk-custom-root-slash-' + process.pid ) + '/';

	const rootDir = rootDirFrom( { DESK_ROOTDIR: custom } );

	assert.strictEqual( rootDir, custom );

} );
