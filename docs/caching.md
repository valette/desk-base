# Caching

Non-void actions cache their outputs so that re-running the same action with the
same inputs is fast. Caching is opt-out (via `voidAction` or `noCache`) and is
invalidated automatically when any input file changes.

## When caching applies

Caching is **skipped** entirely when any of these is true:

- `action.voidAction === true` — actions that produce no persistent output.
- `action.noCache === true` — actions explicitly marked never-to-cache.
- `POST.force_update` or `POST.forceUpdate` is set — the client forces a rerun.

## Output / cache directory

Every non-void action resolves an **output directory** (`handleOutputDirectory`),
chosen in this order:

1. **`actions/`** — an incrementing counter directory under the root
   (`actions/1`, `actions/2`, ...). Counter persisted in
   `<root>/actions/counter.json`, serialized through a queue so concurrent
   actions don't collide.
2. **undefined / default** — a hash-addressed directory:
   ```
   <cacheRoot>/<hash[0]>/<hash[1]>/<hash>
   ```
   where `hash` is the SHA-1 of the **command line**, and `cacheRoot` is
   `POST.cacheRoot` if provided, otherwise `cache`. This layout spreads entries
   across 256×256 subdirectories.
3. **explicit `outputDirectory`** — any other path; its top-level directory is
   validated against the allowed data directories via `validatePath`.

The directory is created with `fs.mkdirs` and is where:
- the child process runs (its `cwd`),
- stdout/stderr are piped to `action.log` / `action.err`,
- the cache manifest `action.json` is written,
- `output` mapping files are written.

When `POST.stream` is set, an `actionEvent` with `type: "outputDirectory"` is
emitted so the client can learn the directory early.

## Cache invalidation

`isInCache()` determines whether a cached result is still valid:

1. Read `<outputDirectory>/action.json` (the manifest).
2. Compute the **input MTime** via `getInputMTime()` — the maximum modification
   time over:
   - `action.deps` (dependency files),
   - `POST.cache` entries (extra cache inputs),
   - all `file` / `directory` / `fileArray` parameter values (resolved against
     root).
3. If `POST.forceCache` is set, the cache is used unconditionally (logged as
   `cache is forced`).
4. Otherwise, if `inputMTime > cachedMTime` the cache is stale → rerun.
5. The current `filteredPOST` is compared (via `assert.deepEqual`) against the
   manifest's recorded `filteredPOST`. Any mismatch (different parameters) →
   stale → rerun.

If a parameter file is missing, `getInputMTime` throws, which produces an error
("file does not exist ...").

## Replaying from cache

When the cache is valid, `replayActionFromCache()`:

- touches the output directory (updates its mtime) so the cache cleaner won't
  delete it,
- reads `action.log` and `action.err` back if `POST.stdout` is set,
- returns status `CACHED` with the stored stdout/stderr.

`timeStamp` and `duration` are restored from the manifest's `__extra`.

## Writing the manifest

After a successful command execution, the engine:

1. records `res.duration` and the start `MTime`,
2. writes `action.json` containing the full `filteredPOST` plus a reserved
   `__extra` object `{ duration, MTime }`,
3. updates the directory mtime.

On the next run, `isInCache` reads this manifest, strips `__extra`, and compares
the remaining fields against the current `filteredPOST`.

## Deduplication of concurrent identical runs

`executeAction()` computes a second SHA-1 over `JSON.stringify(filteredPOST)` and
indexes running actions by that hash in `ongoingActions2`. If an identical action
is already running, the new request simply awaits the same child process promise
("same as action [<id>]") instead of spawning a duplicate.

## Cache cleaner

`lib/index.js` schedules a daily cron job (at a random hour) that calls
`cacheCleaner.cleanCache(<root>/cache, '30d')`:

- walks the three-level hash layout (`<cache>/<x>/<y>/<z>`),
- `rm -rf`s any directory whose mtime is older than `maxAge`,
- logs a summary of how many directories were deleted.

Because successful runs touch the output directory, frequently used cache entries
stay fresh and are not removed.

## Forcing behavior from the client

| POST field | Effect |
|-----------|--------|
| `force_update` / `forceUpdate` | Skip the cache and rerun. |
| `forceCache` | Use the cache even if inputs are stale. |
| `cacheRoot` | Override the cache root path (default `cache`). |
| `cache` | Extra input files that participate in MTime invalidation. |
