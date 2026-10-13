'use strict';

const { test, after } = require( 'node:test' );
const assert  = require( 'node:assert' );
const path    = require( 'path' );
const { desk, rootDir, cleanup } = require( '../test-assets/helpers.js' );

async function run ( action, params ) {

	return await desk.execute( Object.assign( { action, silent: true }, params ) );

}

function errorMessage ( res ) {

	return res.error && res.error.message;

}

test( 'string parameters escape spaces in the command line', async () => {

	const res = await run( 'echo_string', { value: 'hello world' } );

	assert.ok( res.commandLine.includes( 'str=hello\\ world' ) );

} );

test( 'escapedString escapes spaces, parentheses and commas', async () => {

	const res = await run( 'echo_escaped', { value: 'a (b), c' } );

	assert.ok( res.commandLine.includes( 'esc=a\\ \\(b\\)\\,\\ c' ) );

} );

test( 'int parameter is accepted within bounds', async () => {

	const res = await run( 'echo_int', { value: 5 } );

	assert.ok( res.commandLine.endsWith( ' 5' ) );

} );

test( 'int parameter rejects non-integers', async () => {

	const res = await run( 'echo_int', { value: 'abc' } );

	assert.strictEqual( res.status, 'ERROR' );
	assert.ok( errorMessage( res ).includes( 'must be an int' ) );

} );

test( 'int parameter rejects values above max', async () => {

	const res = await run( 'echo_int', { value: 11 } );

	assert.strictEqual( res.status, 'ERROR' );
	assert.ok( errorMessage( res ).includes( 'max value is' ) );

} );

test( 'int parameter rejects values below min', async () => {

	const res = await run( 'echo_int', { value: -1 } );

	assert.strictEqual( res.status, 'ERROR' );
	assert.ok( errorMessage( res ).includes( 'min value is' ) );

} );

test( 'float parameter accepts numbers', async () => {

	const res = await run( 'echo_float', { value: 2.5 } );

	assert.ok( res.commandLine.endsWith( ' 2.5' ) );

} );

test( 'float parameter rejects non-numbers', async () => {

	const res = await run( 'echo_float', { value: 'nope' } );

	assert.strictEqual( res.status, 'ERROR' );
	assert.ok( errorMessage( res ).includes( 'must be a number' ) );

} );

test( 'file parameter resolves to an absolute escaped path', async () => {

	const res = await run( 'echo_file', { value: 'data' } );

	assert.ok( res.commandLine.includes( path.join( rootDir, 'data' ) ) );

} );

test( 'fileArray joins escaped absolute paths', async () => {

	const res = await run( 'echo_filearray', { value: [ 'data', 'code' ] } );

	assert.ok( res.commandLine.includes(
		'files=' + path.join( rootDir, 'data' ) + ' ' + path.join( rootDir, 'code' )
	) );

} );

test( 'intArray respects separator and length', async () => {

	const res = await run( 'echo_intarray', { value: [ 2, 5, 10 ] } );

	assert.ok( res.commandLine.includes( 'ints=[2,5,10]' ) );

} );

test( 'intArray enforces its declared length', async () => {

	const res = await run( 'echo_intarray', { value: [ 1, 2 ] } );

	assert.strictEqual( res.status, 'ERROR' );
	assert.ok( errorMessage( res ).includes( 'must be of length' ) );

} );

test( 'floatArray joins values with the separator', async () => {

	const res = await run( 'echo_floatarray', { value: [ 1.1, 3, 9 ] } );

	assert.ok( res.commandLine.includes( 'floats=[1.1 3 9]' ) );

} );

test( 'stringArray joins with a custom separator', async () => {

	const res = await run( 'echo_stringarray', { value: [ 'hello', 'world' ] } );

	assert.ok( res.commandLine.includes( ' hello,world' ) );

} );

test( 'base64data parameter is appended with its prefix', async () => {

	const res = await run( 'echo_base64', { value: 'aGVsbG8=' } );

	assert.ok( res.commandLine.includes( 'b64=aGVsbG8=' ) );

} );

test( 'flag parameter contributes its prefix', async () => {

	const res = await run( 'echo_flag', { recursive: 'true' } );

	assert.ok( res.commandLine.includes( '-r' ) );

} );

test( 'flag parameter rejects non-boolean values', async () => {

	const res = await run( 'echo_flag', { recursive: 'maybe' } );

	assert.strictEqual( res.status, 'ERROR' );
	assert.ok( errorMessage( res ).includes( 'must be a bool' ) );

} );

test( 'alias parameter is used when the primary key is absent', async () => {

	const res = await run( 'echo_alias', { value2: 'from-alias' } );

	assert.ok( res.commandLine.includes( ' from-alias' ) );

} );

test( 'defaultValue is used when no value is provided', async () => {

	const res = await run( 'echo_alias', {} );

	assert.ok( res.commandLine.includes( ' defaulted' ) );

} );

test( 'missing required parameter produces an error', async () => {

	const res = await run( 'echo_string', {} );

	assert.strictEqual( res.status, 'ERROR' );
	assert.ok( errorMessage( res ).includes( 'is required' ) );

} );

test( 'optional parameter is skipped when absent', async () => {

	const res = await run( 'echo_optional', {} );

	assert.ok( res.commandLine.trim().endsWith( 'echo' ) );

} );

test( 'static text parameter is appended verbatim', async () => {

	const res = await run( 'echo_text', {} );

	assert.ok( res.commandLine.includes( 'this is literal text' ) );

} );

after( cleanup );
