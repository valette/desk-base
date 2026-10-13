# AGENTS.md

Guidance for AI coding agents (and human contributors) working in this
repository. Read this before editing.

## What this repo is

`desk-base` is the shared **library** at the heart of the DESK remote desktop
project. It exports an **action execution engine**: given a POST describing a
named action and typed parameters, it builds a shell command line (or calls a
JavaScript module), runs it, caches the result, and returns a structured
response. It is **not** a standalone server — the HTTP/WebSocket server and UI
live in the parent application (desk-server / desk-electron / desk-nw).

- Language: JavaScript (CommonJS, Node ≥ 8.1).
- Entry point: `lib/index.js` (`"main": "./lib/index.js"`).
- License: CeCILL-B.

## Module map

| File | Role |
|------|------|
| `lib/index.js` | Entry. Sets rootDir (`~/desk/`), cron cache cleaner, node-ipc socket server (skipped if `DESK_SINGLE`). |
| `lib/cl-rpc.js` | **Engine**: queues, `RPC` class, parameter parsing, command-line building, caching, kill/stream/dedup. |
| `lib/config.js` | Registry: loads/watches JSON action definitions, dataDirs, permissions, exports `actions.json`, emits `actions updated`. |
| `lib/cacheCleaner.js` | Deletes cache dirs older than `maxAge`. |
| `lib/includes/base.json` + `*.js` | Built-in actions. |
| `lib/includes/testing/` | `testAllParameters` — exercises every parameter type. |

The exported object is the `config` EventEmitter extended by `cl-rpc.js`. All
three files reassign `exports = module.exports`, so `desk-base`, `config.js`,
and `cl-rpc.js` export the **same singleton**.

## Key invariants (do not break these)

1. **Command-line construction**: every action builds
   `nice <engine> <executable|command> <prefix>value<suffix> ...` from its typed
   parameters, in declaration order. `parseParameters` / `parseParameter` in
   `cl-rpc.js` own this. Path-like and string types escape spaces/parens/commas.
2. **Caching contract**: non-void, non-`noCache` actions cache by SHA-1 of the
   command line under `<root>/cache/<h0>/<h1>/<hash>/`. Invalidation compares the
   max input MTime (deps + `POST.cache` + file-type params) against the
   `action.json` manifest's `__extra.MTime`, and `assert.deepEqual` on
   `filteredPOST`. `voidAction`, `noCache`, `force_update`/`forceUpdate` bypass.
3. **Permissions model**: running permission = min across includes; actions with
   higher required permission are dropped in `exportActions()`. At level `0` no
   output directory is used.
4. **Output directory** resolution order: `"actions/"` counter dir → hash cache
   dir → explicit `outputDirectory` (validated via `validatePath`).
5. **Concurrency**: two `async.queue`s (regular + base, each `nCPUS` wide);
   identical concurrent runs dedup via `ongoingActions2` hash.
6. **Environment flags**: `DESK_SINGLE` disables the cron cleaner and IPC server.

Full detail: [docs/architecture.md](docs/architecture.md),
[docs/caching.md](docs/caching.md), [docs/parameter-types.md](docs/parameter-types.md).

## Conventions

- CommonJS `require`; export singletons via `exports = module.exports = X`.
- Promisify node-style callbacks with
  `Promise.promisify || require('util').promisify`.
- Dependencies are pinned to exact versions in `package.json` (async, cron,
  fs-extra, lodash, ms, node-ipc, tree-kill). Avoid adding dependencies unless
  necessary.
- Code style: spaces, semicolons, single quotes; methods grouped on `RPC.prototype`.
- **Do not add code comments** unless explicitly requested.
- Preserve the existing style when editing (this codebase predates modern
  formatting and favors compact idioms like destructured `require`s).

## Testing

There is **no automated test framework**. Verification approaches:

- `testAllParameters` action (in `lib/includes/testing/`) exercises every
  parameter type — invoke it against a running DESK server to sanity-check the
  engine. Note: `lib/includes/testing/testing.js` uses browser/desk globals
  (`desk.Actions`, `btoa`) and is not runnable directly in plain Node.
- Manually exercise the engine by requiring `lib/index.js` (or `lib/cl-rpc.js`)
  and calling `execute(...)`, e.g. with `DESK_SINGLE` set to skip IPC/cron.
- After changes, confirm the module still loads cleanly:
  `node -e "require('./lib/index.js')"` (this will start IPC unless `DESK_SINGLE=1`).

## Useful entry points

- `desk.execute(POST[, cb])` — the public execution API (see
  [docs/api.md](docs/api.md)).
- `desk.setRootDir(dir)`, `desk.include(file, priority)`, `desk.getSettings()`.
- Events: `log`, `action finished`, `action started`, `actionEvent`,
  `actions updated`.
