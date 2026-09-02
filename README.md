# desk-base

[![npm version](https://badge.fury.io/js/desk-base.svg)](https://badge.fury.io/js/desk-base)
[![License](https://img.shields.io/badge/License-CECILL--B-blue.svg)](LICENSE)

## Overview

`desk-base` is a Node.js framework for managing remote desktop applications, particularly focused on medical imaging. It provides the foundational components for both server and client implementations in a remote desktop environment.

This library implements a robust RPC (Remote Procedure Call) system that enables execution of computational tasks remotely while managing resources, caching, and configuration.

## Key Features

- **Remote Execution Framework**: Execute actions (JavaScript modules or external executables) remotely via IPC
- **Action Management**: Extensible system for defining and executing actions through JSON definitions
- **Caching System**: Automatic caching of results with dependency checking and cache invalidation
- **Configuration Management**: Dynamic loading of action definitions with permissions control
- **Multi-threading Support**: Utilizes CPU count for parallel action execution
- **Security Controls**: Permissions system and path validation

## Architecture

The framework consists of several core components:

1. **RPC System** (`lib/index.js`) - Implements the core RPC functionality using node-ipc
2. **Action Execution** (`lib/cl-rpc.js`) - Centralized action execution with caching
3. **Configuration Manager** (`lib/config.js`) - Handles loading and managing action definitions
4. **Cache Cleaner** (`lib/cacheCleaner.js`) - Automated cleanup of old cache directories

## Installation

```bash
npm install desk-base
```

## Usage

```javascript
const DeskBase = require('desk-base');

// The desk-base library doesn't have a start() method.
// It's meant to be used as a module that exports action execution functions.
// The actual server is started by the parent application.
```

## Action Definitions

Actions are defined through JSON configuration files. These files describe executable commands or JavaScript modules along with their parameters. Actions are loaded from:

- `lib/includes/base.json` - Base system actions
- `lib/includes/testing/testing.json` - Test actions
- User-defined files in the extensions directory

For detailed information about all base actions and their parameters, please refer to the [ACTIONS.md](ACTIONS.md) file.

### Example Action Configuration

For a practical example of action definitions in use, see the [ACVD.json](https://github.com/valette/ACVD/blob/master/ACVD.json) file from the ACVD project, which demonstrates how to define complex mesh processing actions.

### Action Definition Structure

Each action definition has the following fields:

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

### Parameter Types

| Type | Description |
|------|-------------|
| `string` | Simple string parameter |
| `int` | Integer value |
| `float` | Floating-point number |
| `file` | File path parameter |
| `directory` | Directory path parameter |
| `fileArray` | Array of file paths |
| `intArray` | Array of integers |
| `floatArray` | Array of floating-point numbers |
| `stringArray` | Array of strings |
| `base64data` | Base64 encoded binary data |
| `flag` | Boolean flag parameter |

