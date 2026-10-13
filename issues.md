# Code analysis report — issues, bugs and improvements

Analysis of `desk-base` (action execution engine). All 50 tests pass. Severity:
`[HIGH]` = security / data loss, `[MED]` = functional bug, `[LOW]` = polish.

## Bugs

### 1. Shell command injection `[HIGH]`
- **Files:** `lib/cl-rpc.js:388-391` (`parseParameter`), `lib/cl-rpc.js:604` (`exec`)
- **Detail:** `string` and `base64data` parameters escape only spaces. `file`,
  `fileString`, `directory` and `escapedString` also escape parens/commas, but
  **none** escape `;`, `&&`, `|`, backticks, `$()`, or quotes. The built command
  line is executed through `child_process.exec` (a real shell). A value such as
  `x; rm -rf /` or `$(cat /etc/passwd)` runs arbitrary commands on the host.
  `string` is the worst case because parens are not escaped, so `$(...)` works
  directly. Critical if the API is reachable by any untrusted client.
- **Fix direction:** use `spawn` with an args array, or add a centralized
  escaping helper covering all metacharacters for every string/path type.

### 2. `errror` typo leaves `response.error` undefined `[MED]` — FIXED
- **File:** `lib/cl-rpc.js:206`
- **Detail:** In the error `switch` the `default` branch assigns to a typo'd
  variable `errror` instead of `error`. For any thrown value that is neither an
  object nor a string, `error` stays `undefined` and `response.error = undefined`.
- **Fix:** commit `ca871ce` — corrected to `error = err`.

### 3. Flag parameter can never be "off" `[MED]`
- **Files:** `lib/cl-rpc.js:393-411` (`parseParameter`), `lib/cl-rpc.js:263` (`parseParameters`)
- **Detail:** For type `flag`, the values `"true"/"yes"/"1"` and
  `"false"/"no"/"0"` all return `''`. `parseParameters` always appends
  `prefix + value + suffix`, so a `false` flag still emits its prefix. Example:
  `echo_flag` with `recursive: false` still produces ` -r `. There is no way to
  omit the prefix.
- **Fix direction:** when the flag resolves to a falsey value, skip the prefix.

### 4. `throw null` crashes the error handler `[LOW]` — FIXED
- **File:** `lib/cl-rpc.js:196-199`
- **Detail:** `typeof null === 'object'`, so `Object.assign({}, err)` succeeds but
  `err.toString()` then throws `TypeError` on `null`, masking the real error.
- **Fix:** commit `210bd43` — guard the object branch so a `null` value yields a
  `'unknown error'` message instead of crashing.

### 5. Write-stream leak on failed commands `[LOW]` — FIXED
- **File:** `lib/cl-rpc.js:641-655`
- **Detail:** `logStream`/`logStream2` are only `end()`-ed when `!res.err`. When a
  command fails the streams are left open, leaking file descriptors in a
  long-lived server.
- **Fix:** commit `0aa92e9` — log streams are now closed regardless of success or
  failure; only the cache manifest write is gated on `!res.err`.

## Issues / inconsistencies

### 6. Module-based actions are never deduplicated `[MED]`
- **File:** `lib/cl-rpc.js:576-594`
- **Detail:** `ongoingActions2[hash]` is only written in the `exec` branch, so two
  identical `module` actions run fully in parallel instead of sharing a promise.

### 7. Dedup race `[LOW]`
- **File:** `lib/cl-rpc.js:582-609`
- **Detail:** Two identical actions starting simultaneously can both miss the
  `runningAction` check before either writes `ongoingActions2[hash]`; the second
  write overwrites the first and both execute.

### 8. Deprecated `new Buffer()` `[LOW]` — FIXED
- **File:** `lib/includes/write_binary.js:7`
- **Detail:** `new Buffer(data, 'base64')` is deprecated/removed in modern Node;
  use `Buffer.from(data, 'base64')`.
- **Fix:** commit `2d76820` — replaced with `Buffer.from(data, 'base64')`.

### 9. Fragile circular `require('../index.js')` `[LOW]`
- **Files:** `lib/includes/getRelativePath.js:4`, `lib/includes/getRootDir.js:4`
- **Detail:** Re-requiring the entry point forces loading of the IPC server and
  cron unless `DESK_SINGLE` is set. It works via the module cache today but is
  brittle and order-dependent.

### 10. `cacheCleaner` shells out with an unescaped path `[LOW]`
- **File:** `lib/cacheCleaner.js:47`
- **Detail:** `exec('rm -rf ' + path.join(...))` invokes a shell to delete cache
  dirs. Safe for today's hex hash directories but unsafe if cache dirs ever
  contain spaces/metacharacters. `fs.remove` would avoid the shell entirely.

### 11. `base64data` type is identical to `string` `[LOW]`
- **File:** `lib/cl-rpc.js:388`
- **Detail:** Both cases only escape spaces; nothing decodes or validates base64
  despite the distinct type name. Either document it as an alias or implement
  actual base64 handling.

### 12. Error message missing space `[LOW]` — FIXED
- **File:** `lib/cl-rpc.js:308`
- **Detail:** `"parameter" + name` should be `"parameter " + name`.
- **Fix:** commit `9cc71b9` — added the missing space.

## Possible improvements

- Prefer `child_process.spawn` with an args array over `exec` to eliminate the
  injection class entirely rather than layering more escaping.
- Centralize escaping in a single helper covering `'` `"` `\` `$` backtick `;`
  `&` `|` `<` `>` `*` `?`, used by every string/path type.
- Clear `ongoingActions2` entries on kill/failure and dedup module actions for
  consistent concurrency semantics.
- Validate array `length` and flag values at config/registry load time (fail
  fast) instead of per request.
- Make `response.error` handling robust (guard non-object/string cases, handle
  `null`).
- Add defense in depth against path traversal by validating user-supplied path
  segments before `fullPath` use in `getInputMTime` / `handleOutputDirectory`.
