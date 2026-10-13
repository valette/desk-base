'use strict';

const { test, after } = require( 'node:test' );
const assert  = require( 'node:assert' );
const path    = require( 'path' );
const { desk, rootDir, cleanup } = require( '../test-assets/helpers.js' );

test( 'getRootDir returns the configured root directory', () => {

	assert.strictEqual( desk.getRootDir(), rootDir );

} );

test( 'getSettings exposes actions, permissions and dataDirs', () => {

	const settings = desk.getSettings();

	assert.ok( settings.actions );
	assert.strictEqual( typeof settings.actions, 'object' );
	assert.strictEqual( typeof settings.permissions, 'number' );
	assert.ok( settings.dataDirs );

} );

test( 'built-in base actions are registered', () => {

	const actions = desk.getSettings().actions;

	for ( let name of [ 'cpuLoad', 'ping', 'pwd', 'ls', 'exists', 'getRootDir' ] ) {

		assert.ok( actions[ name ], 'expected action ' + name );

	}

} );

test( 'included fixture actions are registered', () => {

	const actions = desk.getSettings().actions;

	for ( let name of [ 'echo_string', 'echo_int', 'cache_write', 'echo_text' ] ) {

		assert.ok( actions[ name ], 'expected action ' + name );

	}

} );

test( 'fullPath joins relative segments under rootDir', () => {

	assert.strictEqual( desk.fullPath( 'cache' ), path.join( rootDir, 'cache' ) );
	assert.strictEqual(
		desk.fullPath( 'data', 'sub' ),
		path.join( rootDir, 'data', 'sub' )
	);

} );

test( 'fullPath leaves absolute first segments untouched', () => {

	assert.strictEqual( desk.fullPath( '/tmp' ), '/tmp' );

} );

test( 'include registers a new action definition', () => {

	const before = desk.getSettings().actions[ 'late_action' ];

	assert.strictEqual( before, undefined );

	desk.include( path.join( __dirname, '..', 'test-assets', 'fixtures', 'late.json' ) );

	const after = desk.getSettings().actions[ 'late_action' ];

	assert.ok( after, 'late_action should be registered after include()' );
	assert.strictEqual( after.command, 'echo' );

} );

	test( 'validatePathAsync resolves for allowed directories', async () => {

	const err = await desk.validatePathAsync( 'cache' );

	assert.ok( !err );

} );

test( 'validatePathAsync rejects for disallowed paths', async () => {

	let err;
	try { await desk.validatePathAsync( 'not-a-real-dir' ); }
	catch ( e ) { err = e; }

	assert.ok( err, 'expected validation to fail' );

} );

after( cleanup );
