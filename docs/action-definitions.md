# Action Definitions

An **action** is a named, executable unit that DESK exposes to clients. Each
action is declared in a JSON configuration file. When a client "runs" an action,
DESK resolves the declared parameters into a shell command line (or calls a
JavaScript module), executes it, and returns a structured response.

Action definition files are loaded from:

- `lib/includes/` — built-in actions (priority `-1`).
- `<root>/extensions/` — user actions (priority `0`).
- Any file passed to `actions.include( file, priority )`.

See [architecture.md](architecture.md) for how includes, priorities and
permissions are resolved.

## Schema

A minimal action definition file looks like:

```json
{
  "dataDirs": { "myData": "myData" },
  "includes": ["other/actions.json"],
  "init": ["client_script.js"],
  "permissions": 1,
  "actions": {
    "my_action": {
      "parameters": [],
      "command": "echo"
    }
  }
}
```

### File-level fields

| Field | Type | Description |
|-------|------|-------------|
| `actions` | object | Map of action name → action definition. |
| `dataDirs` | object | Declared data directories (see architecture doc). |
| `includes` | array | Other JSON files to load (resolved relative to this file, or absolute). |
| `init` | array | `.js` client files to load during client startup. |
| `permissions` | number | Permissions ceiling contributed by this file (`0` or `1`); the running level is the minimum across all files. |

### Action-level fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `command` | string | — | Command name resolved from `PATH` (e.g. `"zip"`, `"sleep"`). Mutually exclusive with `executable`. |
| `executable` | string | — | Path to an executable. If relative, it is resolved relative to the JSON file's directory. |
| `engine` | string | `""` | Optional prefix before the command, e.g. an interpreter or wrapper. |
| `js` | string | — | Name of a JavaScript module (relative to the JSON file) implementing the action instead of a command. |
| `module` | object | — | (Advanced) an in-memory module object with an `executeAsync` method; injected by the host rather than loaded from disk. |
| `parameters` | array | `[]` | Ordered list of parameters that build the command line. See [parameter-types.md](parameter-types.md). |
| `voidAction` | boolean | `false` | `true` if the action produces no output and must not be cached. |
| `noCache` | boolean | `false` | `true` if the action must never be cached. |
| `permissions` | number | `1` | Required permission level (`0` or `1`). Filtered out if higher than the running level. |
| `dependencies` | array | — | Files/actions this action depends on. Entries with `/` become cache-invalidation inputs. |
| `output` | object | — | Maps response field names to output file names written into the output directory. |
| `alias` | string | — | An alternative name under which the action is also registered. |
| `lib` | string | — | Automatically set to the JSON file's basename (e.g. `base`); used to route base actions to the separate queue. |
| `priority` | number | — | Lower value wins when the same action is declared in several files. |
| `env` | object | — | Extra environment variables merged into the child process environment. |

### Backwards compatibility

- `attributes` (an object) is merged into the action and removed; treat it as
  deprecated.
- `command` and `executable` are equivalent in purpose: `executable` is used for
  a specific path, `command` for a name from `PATH`. The engine builds
  `nice <engine> <executable|command> ...`.

## Execution modes

An action runs one of two ways:

### 1. Command execution (`command` / `executable`)

The engine builds a single command line and runs it as a child process:

```
nice <engine> <executable|command> <prefix>value<suffix> ...
```

- The command runs with `cwd` set to the action's output directory.
- `maxBuffer` is `1e10` (effectively unlimited).
- Environment = `process.env` merged with `action.env`.
- stdout/stderr are captured and (when requested) streamed and written to
  `action.log` / `action.err` in the output directory.

### 2. JavaScript module (`js` or `module`)

The engine loads the module and calls:

```js
await action.module.executeAsync( params )
```

where `params` contains the filtered POST values (by parameter name) plus
`POSTFiles` (resolved absolute file paths) and `output_directory` (the resolved
output directory). The method may return a value, a Promise, or use a Node-style
`(err, res)` callback — all three are handled. Its return value becomes the
action's stdout.

## Output directory & `output`

Every non-void action gets an **output directory** where results (and the cache
manifest) are written. See [caching.md](caching.md) for how it is chosen.

The `output` field lets you expose files written by the action as response
fields. For each entry `"key": "file.ext"`, a field `output<Key>` (capitalized)
is added to the response containing the full path
`<outputDirectory>/file.ext`. For example `"output": { "mesh": "mesh.off" }`
produces a `outputMesh` response field.

## Response shape

A successful (or failed) action produces a response object. Common fields:

| Field | Type | Description |
|-------|------|-------------|
| `handle` | string | The client-provided (or random) handle identifying this execution. |
| `status` | string | Human-readable status, e.g. `OK (1.5s)`, `CACHED`, `ERROR`, `KILLED`. |
| `commandLine` | string | The built command line (truncated to 500 chars). |
| `error` | object | Present on failure: `{ message, ... }`. |
| `outputDirectory` | string | The resolved output directory. |
| `timeStamp` | number | When the action produced its result. |
| `duration` | number | Execution duration in ms. |
| `stdout` / `stderr` | string | Included only when `POST.stdout` was true. |
| `output<Key>` | string | Present for each `output` mapping. |
| `killed` | boolean | `true` when the action was killed. |

---

# Base action inventory

The following built-in actions are declared in `lib/includes/base.json` and
`lib/includes/testing/testing.json`. Parameter types refer to
[parameter-types.md](parameter-types.md).

## `cpuLoad`
- **Mode**: JS module
- **Parameters**: none
- **Description**: Returns normalized CPU load averages (loadavg divided by core count) as JSON.
- **permissions**: `0`

```json
{ "action": "cpuLoad" }
```

## `ping`
- **Mode**: command
- **Parameters**: fixed text `-c 100 www.google.com`
- **Description**: Pings a host. `voidAction`.
- **permissions**: `1`

```json
{ "action": "ping" }
```

## `compress_to_zip`
- **Mode**: command (`zip`)
- **Parameters**:
  - `output_zip` — `fileString`, required
  - fixed text `-rj `
  - `input_file_list` — `fileString`, required
- **Description**: Compresses files into a zip archive. `voidAction`.

```json
{
  "action": "compress_to_zip",
  "output_zip": "/path/to/output.zip",
  "input_file_list": "/path/to/file1.txt /path/to/file2.txt"
}
```

## `pwd`
- **Mode**: command (`pwd`)
- **Parameters**: fixed text ` ` (a space)
- **Description**: Prints the working directory.

```json
{ "action": "pwd" }
```

## `set_permissions`
- **Mode**: command (`chmod g+rw`)
- **Parameters**:
  - `directory` — `file`, required
  - fixed text `-R`
- **Description**: Sets group read/write permissions recursively. `voidAction`.

```json
{ "action": "set_permissions", "directory": "/path/to/directory" }
```

## `sleep`
- **Mode**: command (`sleep`)
- **Parameters**:
  - `time_in_seconds` — `float`, required, default `2`
- **Description**: Pauses execution. `voidAction`.

```json
{ "action": "sleep", "time_in_seconds": 5 }
```

## `delete_file`
- **Mode**: command (`rm`)
- **Parameters**:
  - `file_name` — `file`, required
- **Description**: Deletes a file. `voidAction`.

```json
{ "action": "delete_file", "file_name": "/path/to/file.txt" }
```

## `add_subdirectory`
- **Mode**: command (`mkdir`)
- **Parameters**:
  - `subdirectory_name` — `escapedString`, required
- **Description**: Creates a subdirectory. `voidAction`, `noCache`.

```json
{ "action": "add_subdirectory", "subdirectory_name": "new_subdir" }
```

## `delete_directory`
- **Mode**: command (`rm -rf`)
- **Parameters**:
  - `directory` — `file`, required
- **Description**: Deletes a directory recursively. `voidAction`.

```json
{ "action": "delete_directory", "directory": "/path/to/directory" }
```

## `move`
- **Mode**: command (`mv`)
- **Parameters**:
  - `source` — `file`, required
  - `destination` — `fileString`, required
- **Description**: Moves a file or directory. `voidAction`.

```json
{ "action": "move", "source": "/a", "destination": "/b" }
```

## `copy`
- **Mode**: command (`cp`)
- **Parameters**:
  - `source` — `fileString`, required
  - `destination` — `fileString`, required
  - `recursive` — `flag`, prefix `-r`
- **Description**: Copies a file or directory. `voidAction`.

```json
{ "action": "copy", "source": "/a", "destination": "/b", "recursive": true }
```

## `mkdirp`
- **Mode**: JS module
- **Parameters**:
  - `directory` — `directory`, required
- **Description**: Creates a directory (and parents) recursively. `voidAction`.

```json
{ "action": "mkdirp", "directory": "/path/to/new/directory" }
```

## `create_directory`
- **Mode**: command (`mkdir`)
- **Parameters**:
  - `directory` — `fileString`, required
- **Description**: Creates a directory. `voidAction`.

```json
{ "action": "create_directory", "directory": "/path/to/new/directory" }
```

## `write_binary`
- **Mode**: JS module
- **Parameters**:
  - `file_name` — `string`, required
  - `base64data` — `string`, required
- **Description**: Writes base64-encoded binary data to a file inside the output directory. `voidAction`.

```json
{ "action": "write_binary", "file_name": "out.bin", "base64data": "AQID" }
```

## `tail`
- **Mode**: command (`tail`)
- **Parameters**:
  - `follow` — `flag`, prefix `-f -n +1`
  - `file` — `file`
- **Description**: Shows the last part of a file, optionally following. `voidAction`.

```json
{ "action": "tail", "file": "/path/to/log.txt", "follow": true }
```

## `ls`
- **Mode**: JS module
- **Parameters**:
  - `directory` — `directory`, required
- **Description**: Lists directory contents as JSON (name, size, isDirectory, mtime). `voidAction`.
- **permissions**: `0`

```json
{ "action": "ls", "directory": "/path/to/directory" }
```

## `getRootDir`
- **Mode**: JS module
- **Parameters**: none
- **Description**: Returns the root directory. `voidAction`.

```json
{ "action": "getRootDir" }
```

## `getRelativePath`
- **Mode**: JS module
- **Parameters**:
  - `path` — `string`, required
- **Description**: Converts an absolute path to a path relative to the root (or a data dir), e.g. `data/foo.txt`. Throws for paths outside the data dirs. `voidAction`.

```json
{ "action": "getRelativePath", "path": "/absolute/path/to/file" }
```

## `exists`
- **Mode**: JS module
- **Parameters**:
  - `path` — `file`, required
- **Description**: Returns `true`/`false` as JSON. `voidAction`.
- **permissions**: `0`

```json
{ "action": "exists", "path": "/path/to/check" }
```

## `write_string`
- **Mode**: JS module
- **Parameters**:
  - `file_name` — `string`, required
  - `data` — `string`, required
- **Description**: Writes a string to a file inside the output directory. `voidAction`.

```json
{ "action": "write_string", "file_name": "out.txt", "data": "Hello" }
```

## `unzip_file`
- **Mode**: command (`unzip`)
- **Parameters**:
  - `input_file` — `file`, required
  - `destination` — `fileString`, required, prefix `-d `
- **Description**: Extracts a zip archive. `voidAction`.

```json
{
  "action": "unzip_file",
  "input_file": "/path/to/archive.zip",
  "destination": "/path/to/extract/to"
}
```

## `testAllParameters` (from `testing/testing.json`)

A test-only action that accepts every parameter type and echoes them back,
useful to verify the engine's parameter handling (see
[development](../README.md#development)). Parameters: `intValue` (`int`),
`floatValue` (`float`), `stringValue` (`string`), `fileValue` (`file`),
`directoryValue` (`directory`), `fileArrayValue` (`fileArray`),
`intArrayValue` (`intArray`, separator `,`, length 3),
`floatArrayValue` (`floatArray`), `stringArrayValue` (`stringArray`),
`base64dataValue` (`base64data`), plus a fixed text part.
