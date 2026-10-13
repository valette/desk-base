# Architecture

This document explains how `desk-base` works internally. It is a Node.js
**library**, not a standalone server: it exports an action execution engine that
is consumed by the parent application (desk-server, desk-electron, desk-nw),
which is responsible for starting the HTTP/WebSocket server and exposing the UI.

## Module map

| File | Responsibility |
|------|----------------|
| `lib/index.js` | Entry point. Initializes the root directory, starts the cron cache cleaner and the node-ipc socket server. |
| `lib/cl-rpc.js` | The action execution engine: parameter parsing, command-line construction, caching, queues, concurrency, kill handling, streaming, events. |
| `lib/config.js` | Configuration & action registry: loads JSON action definitions, watches them for changes, manages data directories, permissions, and exports `actions.json`. |
| `lib/cacheCleaner.js` | Recursively deletes cache directories older than a given age. |
| `lib/includes/base.json` | Built-in action definitions. |
| `lib/includes/*.js` | JavaScript modules implementing built-in actions (e.g. `ls`, `exists`, `write_binary`). |
| `lib/includes/testing/` | A self-contained test action (`testAllParameters`) that exercises every parameter type. |

The exported object is the `config` EventEmitter (from `config.js`), extended
by `cl-rpc.js` with the action execution functions. So the public module *is*
an `EventEmitter` plus action helpers.

## Request lifecycle

An action execution is triggered by a POST object describing the action and its
parameters. It flows through the following stages:

```
POST { action, param1, ... }
   │
   ▼
actions.execute( POST )                     (lib/cl-rpc.js)
   │  ├─ manage request? → manageActions (kill / list ongoing)
   │  └─ normal action → push onto a concurrency-limited queue
   ▼
queue worker → new RPC().execute( POST )    (one RPC instance per action)
   │
   ├─ 1. Look up the action definition (settings.actions[POST.action])
   ├─ 2. Build the command line: "nice <engine> <executable|command> <params>"
   ├─ 3. parseParameters() → resolve each typed parameter into shell text
   ├─ 4. handleOutputDirectory() → decide where output/cache lives
   ├─ 5. isInCache()? → replay from cache  OR  executeAction()
   └─ 6. Emit "action finished" with the response
```

Each concurrent execution gets a unique `handle` (used by clients to identify
and kill it) and a monotonically increasing numeric `id` (used for logging).

### Queues & concurrency

Two `async.queue` instances limit how many actions run at once, each with a
concurrency of `nCPUS` (the number of CPU cores):

- `actionsQueue` — for regular actions.
- `baseActionsQueue` — for actions whose `lib === "base"` (built-ins), so that
  core filesystem/utility actions are never starved by heavy user actions.

`queue.pushAsync` is a promisified version of `queue.push` so callers can `await`
the completion of their action directly.

## Root directory layout

`desk-base` centralizes all state under a root directory (default
`~/desk/`), set with `actions.setRootDir( dir )`. It is also called by
`lib/index.js` at startup, which uses `DESK_ROOTDIR` when set.

| Path (relative to root) | Purpose |
|-------------------------|---------|
| `data/` | General user data. |
| `code/` | Code / scripts directory. |
| `cache/` | Default location for cached action outputs (hash-addressed subdirectories). |
| `actions/` | Output directory used when an action requests `outputDirectory: "actions/"` (incremental counter). |
| `extensions/` | Directory where users can drop their own JSON action definitions (watched, priority 0). |
| `home/` | Symlink (by default) to the user's home directory; always exposed as a data dir. |
| `actions.json` | Generated manifest of all filtered actions/settings, written on every reload (skipped when `DESK_SINGLE` is set). |

`fullPath( ...dirs )` resolves a path against the root directory; absolute paths
are returned unchanged.

## Action registry & configuration (`config.js`)

Action definitions live in JSON files. At startup, `setRootDir()` registers two
"include" locations:

1. `lib/includes` (the built-in actions) — priority `-1` (lowest).
2. `<root>/extensions/` — priority `0` (user actions).

Additional includes can be registered at runtime via `actions.include( file,
priority )`.

### Includes and file watching

- Each JSON file is `require()`d, then evicted from the require cache so it can
  be reloaded later.
- Every included file (or its parent directory if the file doesn't exist yet) is
  watched with `fs.watch`; any change triggers a throttled full reload
  (`updateSync`, throttled to once per second).
- A JSON include can itself declare more `includes`, an `init` list of client
  files, `dataDirs`, and a `permissions` ceiling.
- JavaScript modules referenced by `action.js` are loaded the same way and
  watched for changes too.

### Actions merging & priorities

- Each action is registered under its `name` (and its `alias` if present).
- If the same action name is declared by several files, the definition with the
  **lowest** priority wins (and lower priority means it *overrides* higher
  priority, because built-ins have `-1`).
- A back-compat `attributes` object is merged into the action if present.
- `action.dependencies` entries containing `/` are resolved relative to the JSON
  file's directory and are used as cache-invalidation inputs (see
  [caching.md](caching.md)).

### Data directories (`dataDirs`)

Each include can declare named data directories. `addDirectory` ensures the
corresponding `<root>/<key>` entry exists:

- If the source equals the target path, it just creates the directory.
- Otherwise it creates `<root>/<key>` as a **symlink** to the source (removing a
  wrong existing symlink first).
- All resolved data dirs are added to the `directories` allow-list used by
  `validatePath`.

`validatePath( dir )` uses `fs.realpath` to confirm a path stays inside one of
the allowed data directories; this is used to block actions from writing outside
the sandbox.

### Permissions

- Each include may declare a `permissions` number; the running `permissions`
  level is the *minimum* across all includes (default `1`).
- Each action declares its own `permissions` (`0` or `1`).
- During `exportActions()`, actions whose required permission is higher than the
  current level are removed.
- When `permissions === 0`, no output directory is used at all
  (`handleOutputDirectory` clears it).

### Export

On every reload, `exportActions()`:

1. Filters actions by permission.
2. Computes each action's transitive dependency file list (`action.deps`).
3. Builds `settings = { actions, permissions, dataDirs, init, time, version,
   randomValue }`.
4. Writes `actions.json` at the root (unless `DESK_SINGLE`).
5. Emits the `actions updated` event.

`randomValue` is a random number per process, used by clients to detect that the
server restarted.

## Event model

`desk-base` is an `EventEmitter`. The main events are:

| Event | Payload | Emitted when |
|-------|---------|--------------|
| `log` | string | Any log message (unless `logToConsole`). |
| `action finished` | `{ handle, ...response }` or `{ handle, error }` | An action completed (success or error). |
| `action started` | `POST` | A command-line action begins executing. |
| `actionEvent` | `{ handle, type, data }` | Streaming output (`type` is `stdout`/`stderr`) or an `outputDirectory` notification during a streamed action. |
| `actions updated` | `settings` | The action registry was reloaded. |

Logging behavior is controlled by `setEmitLog( bool )` (emit `log` events
instead of printing) and `setLogToConsole( bool )` (print to the console).

## Inter-process communication (IPC)

`lib/index.js` starts a node-ipc **socket server** when the module is loaded
(unless `DESK_SINGLE` is set, which disables both the cron cleaner and IPC):

- Socket root and id are `~/desk/` and `socket`.
- It listens for an `execute` message, runs `actions.execute( action )`, and
  replies with an `action finished` message.

This allows separate processes (e.g. a helper daemon) to invoke actions through
the Unix socket instead of requiring the module directly.

## Cache cleaner

On startup, `lib/index.js` registers a `CronJob` that fires once a day at a
random hour and calls `cacheCleaner.cleanCache( <root>/cache, '30d' )`.
`cleanCache` walks the three-level hash directory layout and `rm -rf`s any
directory whose mtime is older than `maxAge`. See [caching.md](caching.md) for
the cache layout and invalidation rules.

## Code conventions

- CommonJS (`require` / `module.exports`).
- The module often reassigns `exports = module.exports = ...` to export a
  singleton.
- `Promise.promisify || require('util').promisify` is used to promisify
  node-style callbacks, with graceful fallback.
- Dependencies are pinned to exact versions in `package.json`.
