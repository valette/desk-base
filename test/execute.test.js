'use strict';

const { test, after } = require( 'node:test' );
const assert  = require( 'node:assert' );
const { desk, cleanup } = require( '../test-assets/helpers.js' );

async function run ( action, params ) {

	return await desk.execute( Object.assign( { action, silent: true, stdout: true }, params ) );

}

test( 'execute runs a JS module action and returns its output', async () => {

	const res = await run( 'exists', { path: 'data' } );

	assert.ok( res.status.startsWith( 'OK' ) );
	assert.strictEqual( res.stdout, 'true' );

} );

test( 'execute runs the cpuLoad JS module action', async () => {

	const res = await run( 'cpuLoad', {} );

	assert.ok( res.status.startsWith( 'OK' ) );
	assert.ok( Array.isArray( JSON.parse( res.stdout ) ) );

} );

test( 'execute returns the built command line', async () => {

	const res = await run( 'echo_text', {} );

	assert.ok( res.commandLine.includes( 'echo' ) );

} );

test( 'execute attaches a handle to the response', async () => {

	const res = await run( 'echo_text', {} );

	assert.ok( res.handle );

} );

test( 'action finished event is emitted with the response', async () => {

	let emitted;
	desk.once( 'action finished', res => { emitted = res; } );
	await run( 'echo_text', {} );

	assert.ok( emitted );
	assert.ok( emitted.commandLine.includes( 'echo' ) );

} );

test( 'execute rejects when the action name is missing', async () => {

	const res = await desk.execute( { silent: true } );

	assert.ok( String( res.error ).includes( 'action name is missing' ) );

} );

test( 'execute reports an unknown action as an error', async () => {

	const res = await run( 'no_such_action', {} );

	assert.ok( res.error );

} );

test( 'execute runs a void command action and captures stdout', async () => {

	const res = await run( 'echo_string', { value: 'ping' } );

	assert.ok( res.status.startsWith( 'OK' ) );
	assert.ok( res.stdout.includes( 'ping' ) );

} );

test( 'execute records a duration in the response', async () => {

	const res = await run( 'echo_string', { value: 'x' } );

	assert.strictEqual( typeof res.duration, 'number' );

} );

after( cleanup );
