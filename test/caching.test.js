'use strict';

const { test, after } = require( 'node:test' );
const assert  = require( 'node:assert' );
const fs      = require( 'fs-extra' );
const path    = require( 'path' );
const { desk, rootDir, cleanup } = require( '../test-assets/helpers.js' );

async function run ( action, params ) {

	return await desk.execute( Object.assign( { action, silent: true, stdout: true }, params ) );

}

function setupInput ( content ) {

	const file = path.join( rootDir, 'data', 'in.txt' );
	fs.mkdirsSync( path.dirname( file ) );
	fs.writeFileSync( file, content );
	return file;

}

test( 'first execution runs and writes a cache entry', async () => {

	const res = await run( 'pwd', { cacheRoot: 'cA' } );

	assert.ok( res.status.startsWith( 'OK' ) );
	assert.ok( fs.existsSync( path.join( rootDir, res.outputDirectory, 'action.json' ) ) );
	assert.ok( fs.existsSync( path.join( rootDir, res.outputDirectory, 'action.log' ) ) );

} );

test( 'an identical run is served from cache', async () => {

	const first = await run( 'pwd', { cacheRoot: 'cB' } );
	const second = await run( 'pwd', { cacheRoot: 'cB' } );

	assert.ok( first.status.startsWith( 'OK' ) );
	assert.ok( second.status.includes( 'CACHED' ) );
	assert.strictEqual( second.outputDirectory, first.outputDirectory );

} );

test( 'force_update bypasses the cache', async () => {

	await run( 'pwd', { cacheRoot: 'cC' } );
	const res = await run( 'pwd', { cacheRoot: 'cC', force_update: true } );

	assert.ok( res.status.startsWith( 'OK' ) );
	assert.ok( !res.status.includes( 'CACHED' ) );

} );

test( 'touching a cache-listed input file invalidates the cache', async () => {

	const input = setupInput( 'v1' );
	const first = await run( 'pwd', { cache: [ 'data/in.txt' ] } );
	assert.ok( first.status.startsWith( 'OK' ) );

	const future = new Date( Date.now() + 10000 );
	fs.utimesSync( input, future, future );

	const second = await run( 'pwd', { cache: [ 'data/in.txt' ] } );
	assert.ok( second.status.startsWith( 'OK' ) );
	assert.ok( !second.status.includes( 'CACHED' ) );

} );

test( 'cacheRoot can be overridden', async () => {

	const res = await run( 'pwd', { cacheRoot: 'mycache' } );

	assert.ok( res.outputDirectory.includes( 'mycache' ) );
	assert.ok( fs.existsSync( path.join( rootDir, 'mycache' ) ) );

} );

after( cleanup );
