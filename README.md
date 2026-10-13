# DESK - Desktop Exposing Server Kit

[![npm version](https://badge.fury.io/js/desk-base.svg)](https://badge.fury.io/js/desk-base)
[![License](https://img.shields.io/badge/License-CECILL--B-blue.svg)](LICENSE)

DESK is a remote desktop environment, originally developed for visualization and
processing of medical images. It currently works under Linux or macOS, but
patches for other platforms are welcome.

This repository contains **desk-base**, the shared Node.js **library** that
powers DESK. It is **not a standalone server**: it provides the action execution
engine used by the desk server/clients. The frontend UI source code is available
at [valette/desk-ui](https://github.com/valette/desk-ui).

> Looking for a runnable application? Use the desktop builds:
> [desk-electron](https://github.com/valette/desk-electron) (Electron) or
> [desk-nw](https://github.com/valette/desk-nw) (NW.js).

## Table of contents

- [Features](#features)
- [How it works](#how-it-works)
- [Action Definitions](#action-definitions)
- [Documentation](#documentation)
- [Requirements](#requirements)
- [Installation](#installation)
- [Usage](#usage)
- [Development](#development)
- [Goals](#goals)
- [License](#license)

## Features

- **Action Framework**: Register command-line tools or JavaScript modules as
  reusable, parameterized **actions** via JSON configuration.
- **Automatic caching**: Action outputs are cached by command-line hash and
  invalidated when their inputs change.
- **Concurrency control**: Actions run under CPU-bounded queues; identical
  concurrent runs are deduplicated.
- **Streaming**: Stream stdout/stderr and output directories to clients.
- **File management**: Upload/download files, manage directories, base64 writes.
- **Custom RPC**: Extend with your own actions in `~/desk/extensions/`.
- **Live reload**: Action definitions are watched and hot-reloaded.

## How it works

DESK is a server framework. Custom code execution is defined through **action
definitions** — JSON files that describe executable commands or JavaScript
modules along with their typed parameters. Each action becomes a remote procedure
call that the UI (or any client) can invoke.

The core flow: a POST object describing an action is queued, its typed
parameters are resolved into a shell command line (or a JS module call), the
action executes in its output directory, and the result is cached.

See [docs/architecture.md](docs/architecture.md) for a deep dive into the
request lifecycle, queues, event model, and directory layout.

## Action Definitions

Actions are defined through JSON configuration files and are loaded from:

- `lib/includes/base.json` — built-in system actions
- `lib/includes/testing/testing.json` — test actions
- user files in the `~/desk/extensions/` directory (watched, hot-reloaded)

For a practical example, see the
[ACVD.json](https://github.com/valette/ACVD/blob/master/ACVD.json) file from the
ACVD project, which demonstrates complex mesh-processing actions.

### Minimal example

```json
{
  "actions": {
    "greet": {
      "parameters": [
        { "name": "name", "type": "string", "required": true, "prefix": "Hello, " }
      ],
      "command": "echo"
    }
  }
}
```

### Action structure

Each action supports the following fields:

```json
{
  "parameters": [
    {
      "name": "parameter_name",
      "type": "parameter_type",
      "required": true,
      "defaultValue": "default_value",
      "prefix": "--option ",
      "suffix": " postfix",
      "min": 0,
      "max": 100
    }
  ],
  "command": "command_to_execute",
  "executable": "/path/to/executable",
  "js": "module_name",
  "voidAction": true,
  "noCache": true,
  "dependencies": ["dependency1", "dependency2"],
  "permissions": 1
}
```

### Parameter types

| Type | Description |
|------|-------------|
| `string` | Simple string parameter |
| `escapedString` | String with shell special characters escaped |
| `int` | Integer value |
| `float` / `number` | Floating-point number |
| `file` | File path parameter (resolved, escaped) |
| `fileString` | File path string (resolved, escaped) |
| `directory` | Directory path parameter |
| `fileArray` | Array of file paths |
| `intArray` | Array of integers |
| `floatArray` / `numberArray` | Array of floating-point numbers |
| `stringArray` | Array of strings |
| `base64data` | Base64 encoded binary data |
| `flag` | Boolean flag parameter (injects via `prefix`) |

Full details — including per-parameter options (`prefix`, `suffix`, `separator`,
`length`, `min`/`max`, `aliases`, `defaultValue`, `text`) and shell-escaping
rules — are in [docs/parameter-types.md](docs/parameter-types.md).

## Documentation

Extensive documentation lives in the [`docs/`](docs/) directory:

- [Architecture](docs/architecture.md) — modules, request lifecycle, queues, events, IPC, directory layout.
- [Action Definitions](docs/action-definitions.md) — full JSON schema + inventory of built-in actions.
- [Parameter Types](docs/parameter-types.md) — every type, options, and escaping rules.
- [Caching](docs/caching.md) — output directories, invalidation, replay, cache cleaner.
- [API Reference](docs/api.md) — the exported module API, events, and environment variables.

## Requirements

To install DESK on your computer:

- Git
- Node.js (version **8.1.0 or higher**, see `engines` in `package.json`)

For 3D data visualization (meshes, volumes):

- VTK with headers
- CMake

## Installation

```bash
git clone https://github.com/valette/desk-base.git
cd desk-base
npm install
```

To install binary addons for 3D data visualization (requires VTK and CMake):

```bash
npm run buildAddons
```

## Usage

`desk-base` is a library and does not start a server by itself. Use it in a
parent application:

```js
const desk = require('desk-base');

const result = await desk.execute({
  action: 'pwd',
  stdout: true
});
```

When loaded, `lib/index.js` also starts a daily cache cleaner and a node-ipc
socket server (both skipped if `DESK_SINGLE` is set) so actions can be invoked
across processes.

For a full server with a web UI, use
[desk-electron](https://github.com/valette/desk-electron) or
[desk-nw](https://github.com/valette/desk-nw). A live demo is available at
[https://desk.creatis.insa-lyon.fr/demo/](https://desk.creatis.insa-lyon.fr/demo/).

## Development

There is no automated test suite. The `testing` include ships a
`testAllParameters` action that exercises every parameter type; it can be
invoked from a live DESK server to validate the engine
([lib/includes/testing/testing.js](lib/includes/testing/testing.js)).

Building the debug UI version (in a desk-server checkout):

```bash
cd node_modules/desk-ui
git clone https://github.com/qooxdoo/qooxdoo
npm install
npm run build
```

The debug version will be available at: [http://localhost:8080/ui/source](http://localhost:8080/ui/source)

## Goals

The primary goal is to enable efficient visualization tools such as THREE.js and
qooxdoo on top of existing server-side command-line programs. Each server-side
program is registered as an *action* using a JSON configuration file. DESK can
also generate static content suitable for web deployment; an example served by a
classic Apache server is visible
[here](http://www.creatis.insa-lyon.fr/~valette/200).

More information: [http://www.creatis.insa-lyon.fr/~valette/desk.html](http://www.creatis.insa-lyon.fr/~valette/desk.html)

## License

CeCILL-B (BSD-compatible). For academic use, please cite:

> H. Jacinto, R. Kéchichan, M. Desvignes, R. Prost, and S. Valette, "A Web
> Interface for 3D Visualization and Interactive Segmentation of Medical
> Images", 17th International Conference on 3D Web Technology (Web 3D 2012),
> Los Angeles, USA, pp. 51-58, 2012

## Acknowledgements

This software benefits from several open-source contributions:

- [VTK](http://www.vtk.org/)
- [Node.js](http://www.nodejs.org/)
- [THREE.js](http://www.threejs.org/)
- [qooxdoo](http://www.qooxdoo.org/)
- [OpenCTM](http://openctm.sourceforge.net/)
- [ACVD](http://github.com/valette/ACVD.git)
