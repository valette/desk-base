# API Reference

`desk-base` exports a single object: an `EventEmitter` (from `config.js`) onto
which `cl-rpc.js` attaches the action execution API. It is the same object in
`config.js`, `cl-rpc.js`, and `index.js` — they all reassign
`exports = module.exports`.

```js
const desk = require('desk-base');
// desk is an EventEmitter + the functions below
```

## Configuration & paths

### `desk.setRootDir( dir )`
Sets the root directory (default `~/desk/`). Creates `<root>/extensions/`,
registers the built-in includes, and triggers the first full reload.
Called automatically by `lib/index.js`.

### `desk.getRootDir()` → `string`
Returns the current root directory.

### `desk.fullPath( ...dirs )` → `string`
Resolves path segments against the root directory. Absolute first segments are
returned as-is; relative segments are joined under `rootDir`.

### `desk.getSettings()` → `object`
Returns the current `settings` object:
`{ actions, permissions, dataDirs, init, time, version, randomValue }`.

### `desk.include( file, priority )`
Registers an additional action-definition file (or directory) and watches it for
changes. `priority` defaults to `0`; lower values win on conflicts.

### `desk.validatePath( dir, callback )` / `desk.validatePathAsync( dir )`
Validates that `dir` (resolved under root) points inside one of the allowed data
directories. The callback receives an error (or `null`); the `Async` variant
returns a Promise.

## Action execution

### `desk.execute( POST [, callback] )` → `Promise<response>`
Executes an action. `POST` is an object:

| Field | Description |
|-------|-------------|
| `action` | (string) Name of the action to run. Required unless `manage` is set. |
| `handle` | (string, optional) Client-chosen identifier; a random one is used if absent. |
| `manage` | (string, optional) `"kill"` or `"list"` — see below. |
| `actionHandle` | (string) Handle of the action to kill (used with `manage: "kill"`). |
| `stdout` | (boolean) When true, include `stdout`/`stderr` in the response. |
| `stream` | (boolean) When true, stream stdout/stderr via `actionEvent` events. |
| `cacheRoot` | (string) Override the cache directory root (default `cache`). |
| `cache` | (array) Extra input files participating in cache invalidation. |
| `force_update` / `forceUpdate` | (boolean) Bypass the cache. |
| `forceCache` | (boolean) Use the cache even if inputs are stale. |
| `outputDirectory` / `output_directory` | (string) Explicit output directory; `"actions/"` uses the counter directory. |
| `silent` | (boolean) Suppress per-action log lines. |
| `...parameters` | Named parameter values matching the action's parameter definitions. |

If `callback` is provided, it is called with the response and the function
returns `undefined`; otherwise it returns a Promise resolving to the response.
The response is also emitted via the `action finished` event, with `handle`
attached.

### Management requests

Pass `manage` instead of `action` to inspect or control running actions:

- `{ manage: "kill", actionHandle }` — kills a running action. If it has no child
  process yet, marks it `toKill` and returns `{ status: 'killing defered' }`.
  Otherwise pauses its stdout/stderr and `tree-kill`s its process tree, returning
  `{ status: 'killed' }`. The killed action's response is `{ killed: true,
  status: 'KILLED' }`.
- `{ manage: "list" }` — returns a JSON snapshot of all `ongoingActions`
  (with `childProcess` stripped).

### `desk.setEmitLog( bool )` / `desk.setLogToConsole( bool )`
Control logging: when `setEmitLog(true)` is set, log messages are emitted as
`log` events instead of printed; `setLogToConsole(false)` disables console output.

## Events

`desk` is an `EventEmitter`. See [architecture.md](architecture.md#event-model)
for the full event table. The most important are:

- `desk.on('log', msg => ...)` — log messages.
- `desk.on('action finished', res => ...)` — every action result (or error).
- `desk.on('action started', POST => ...)` — command-line action about to run.
- `desk.on('actionEvent', evt => ...)` — streaming output / output directory
  notifications (`evt = { handle, type, data }`).
- `desk.on('actions updated', settings => ...)` — registry reloaded.

## IPC

`lib/index.js` starts a node-ipc Unix socket server at
`<root>/socket` (id `socket`) unless `DESK_SINGLE` is set. It responds to an
`execute` message by calling `desk.execute` and emitting an `action finished`
message back to the requesting socket.

## Environment variables

| Variable | Effect |
|----------|--------|
| `DESK_SINGLE` | When set, `lib/index.js` skips both the cron cache cleaner and the IPC server. The module still exports the action API. |

## The action runtime (`cl-rpc.js` internals)

The exported API delegates to an internal `RPC` class. One `RPC` instance is
created per action execution and carries:

- `execute(POST)` — the full pipeline (parse → output dir → cache → execute).
- `parseParameters()` / `parseParameter(parameter)` — command-line construction.
- `getInputMTime()` — max mtime over inputs (cache invalidation).
- `handleOutputDirectory()` — resolves/creates the output directory.
- `isInCache()` / `replayActionFromCache()` — cache checks & replay.
- `executeAction()` — spawns the child process or calls the JS module, with
  deduplication of concurrent identical runs.

These are documented in detail in [architecture.md](architecture.md),
[caching.md](caching.md), and [parameter-types.md](parameter-types.md).
