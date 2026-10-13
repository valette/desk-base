'use strict';

const { test, after } = require( 'node:test' );
const assert  = require( 'node:assert' );
const fs      = require( 'fs-extra' );
const path    = require( 'path' );
const ms      = require( 'ms' );
const { cleanCache } = require( '../lib/cacheCleaner.js' );
const { rootDir, cleanup } = require( '../test-assets/helpers.js' );

test( 'cleanCache deletes old directories and keeps fresh ones', async () => {

	const cwd   = path.join( rootDir, 'cache' );
	const oldDir = path.join( cwd, 'a', 'b', 'old' );
	const newDir = path.join( cwd, 'a', 'b', 'new' );

	fs.mkdirsSync( oldDir );
	fs.mkdirsSync( newDir );

	const twoDaysAgo = new Date( Date.now() - 2 * 86400000 );
	fs.utimesSync( oldDir, twoDaysAgo, twoDaysAgo );

	await cleanCache( cwd, ms( '1d' ) );

	assert.ok( !fs.existsSync( oldDir ), 'old directory should be deleted' );
	assert.ok( fs.existsSync( newDir ), 'fresh directory should be kept' );

} );

test( 'cleanCache leaves non-cache-shaped files untouched', async () => {

	const cwd   = path.join( rootDir, 'cache2' );
	const leaf  = path.join( cwd, 'a', 'b', 'keep.txt' );

	fs.mkdirsSync( path.dirname( leaf ) );
	fs.writeFileSync( leaf, 'x' );

	await cleanCache( cwd, ms( '1d' ) );

	assert.ok( fs.existsSync( leaf ) );

} );

after( cleanup );
