# Base Actions Documentation

This document provides detailed information about all base actions included in the desk-base framework.

## Action Structure

Each action follows this structure in the JSON configuration:

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

## Available Base Actions

### cpuLoad
- **Description**: Get CPU load information
- **Parameters**: None
- **Type**: JavaScript module
- **Usage**: 
```javascript
{
  "action": "cpuLoad"
}
```

### ping
- **Description**: Ping a host
- **Parameters**: 
  - `text`: `-c 100 www.google.com` (fixed text parameter)
- **Type**: Command execution
- **Usage**: 
```javascript
{
  "action": "ping"
}
```

### compress_to_zip
- **Description**: Compress files into a zip archive
- **Parameters**: 
  - `output_zip`: Output zip file path (fileString, required)
  - `input_file_list`: Input files to compress (fileString, required)
- **Type**: Command execution
- **Usage**: 
```javascript
{
  "action": "compress_to_zip",
  "output_zip": "/path/to/output.zip",
  "input_file_list": "/path/to/file1.txt /path/to/file2.txt"
}
```

### pwd
- **Description**: Print working directory
- **Parameters**: 
  - `text`: Space character
- **Type**: Command execution
- **Usage**: 
```javascript
{
  "action": "pwd"
}
```

### set_permissions
- **Description**: Set file permissions
- **Parameters**: 
  - `directory`: Directory path (file, required)
- **Type**: Command execution
- **Usage**: 
```javascript
{
  "action": "set_permissions",
  "directory": "/path/to/directory"
}
```

### sleep
- **Description**: Pause execution for specified time
- **Parameters**: 
  - `time_in_seconds`: Time to sleep in seconds (float, required, default: 2)
- **Type**: Command execution
- **Usage**: 
```javascript
{
  "action": "sleep",
  "time_in_seconds": 5
}
```

### delete_file
- **Description**: Delete a file
- **Parameters**: 
  - `file_name`: File to delete (file, required)
- **Type**: Command execution
- **Usage**: 
```javascript
{
  "action": "delete_file",
  "file_name": "/path/to/file.txt"
}
```

### add_subdirectory
- **Description**: Create a subdirectory
- **Parameters**: 
  - `subdirectory_name`: Name of subdirectory to create (escapedString, required)
- **Type**: Command execution
- **Usage**: 
```javascript
{
  "action": "add_subdirectory",
  "subdirectory_name": "new_subdir"
}
```

### delete_directory
- **Description**: Delete a directory recursively
- **Parameters**: 
  - `directory`: Directory to delete (file, required)
- **Type**: Command execution
- **Usage**: 
```javascript
{
  "action": "delete_directory",
  "directory": "/path/to/directory"
}
```

### move
- **Description**: Move a file or directory
- **Parameters**: 
  - `source`: Source path (file, required)
  - `destination`: Destination path (fileString, required)
- **Type**: Command execution
- **Usage**: 
```javascript
{
  "action": "move",
  "source": "/path/to/source",
  "destination": "/path/to/destination"
}
```

### copy
- **Description**: Copy a file or directory
- **Parameters**: 
  - `source`: Source path (fileString, required)
  - `destination`: Destination path (fileString, required)
  - `recursive`: Copy recursively (flag, optional)
- **Type**: Command execution
- **Usage**: 
```javascript
{
  "action": "copy",
  "source": "/path/to/source",
  "destination": "/path/to/destination",
  "recursive": true
}
```

### mkdirp
- **Description**: Create directory recursively
- **Parameters**: 
  - `directory`: Directory to create (directory, required)
- **Type**: JavaScript module
- **Usage**: 
```javascript
{
  "action": "mkdirp",
  "directory": "/path/to/new/directory"
}
```

### create_directory
- **Description**: Create a directory
- **Parameters**: 
  - `directory`: Directory to create (fileString, required)
- **Type**: Command execution
- **Usage**: 
```javascript
{
  "action": "create_directory",
  "directory": "/path/to/new/directory"
}
```

### write_binary
- **Description**: Write binary data to file
- **Parameters**: 
  - `file_name`: Target file name (string, required)
  - `base64data`: Base64 encoded data (string, required)
- **Type**: JavaScript module
- **Usage**: 
```javascript
{
  "action": "write_binary",
  "file_name": "/path/to/file.bin",
  "base64data": "base64-encoded-data"
}
```

### tail
- **Description**: Show last part of a file
- **Parameters**: 
  - `follow`: Follow file output (flag)
  - `file`: File to tail (file)
- **Type**: Command execution
- **Usage**: 
```javascript
{
  "action": "tail",
  "file": "/path/to/logfile.txt",
  "follow": true
}
```

### ls
- **Description**: List directory contents
- **Parameters**: 
  - `directory`: Directory to list (directory, required)
- **Type**: JavaScript module
- **Usage**: 
```javascript
{
  "action": "ls",
  "directory": "/path/to/directory"
}
```

### getRootDir
- **Description**: Get the root directory
- **Parameters**: None
- **Type**: JavaScript module
- **Usage**: 
```javascript
{
  "action": "getRootDir"
}
```

### getRelativePath
- **Description**: Get relative path from root
- **Parameters**: 
  - `path`: Path to convert (string, required)
- **Type**: JavaScript module
- **Usage**: 
```javascript
{
  "action": "getRelativePath",
  "path": "/absolute/path/to/file"
}
```

### exists
- **Description**: Check if path exists
- **Parameters**: 
  - `path`: Path to check (file, required)
- **Type**: JavaScript module
- **Usage**: 
```javascript
{
  "action": "exists",
  "path": "/path/to/check"
}
```

### write_string
- **Description**: Write string data to file
- **Parameters**: 
  - `file_name`: Target file name (string, required)
  - `data`: String data to write (string, required)
- **Type**: JavaScript module
- **Usage**: 
```javascript
{
  "action": "write_string",
  "file_name": "/path/to/file.txt",
  "data": "Hello, world!"
}
```

### unzip_file
- **Description**: Extract files from a zip archive
- **Parameters**: 
  - `input_file`: Zip file to extract (file, required)
  - `destination`: Extraction destination (fileString, required)
- **Type**: Command execution
- **Usage**: 
```javascript
{
  "action": "unzip_file",
  "input_file": "/path/to/archive.zip",
  "destination": "/path/to/extract/to"
}
```

## Parameter Types Reference

| Type | Description | Example |
|------|-------------|---------|
| `string` | Simple string parameter | `"value"` |
| `int` | Integer value | `42` |
| `float` | Floating-point number | `3.14` |
| `file` | File path parameter | `/path/to/file.txt` |
| `directory` | Directory path parameter | `/path/to/directory` |
| `fileArray` | Array of file paths | `["/file1.txt", "/file2.txt"]` |
| `intArray` | Array of integers | `[1, 2, 3]` |
| `floatArray` | Array of floating-point numbers | `[1.1, 2.2, 3.3]` |
| `stringArray` | Array of strings | `["item1", "item2"]` |
| `base64data` | Base64 encoded binary data | `"SGVsbG8="` |
| `flag` | Boolean flag parameter | `true` or `false` |

## Action Properties

### voidAction
Set to `true` for actions that don't produce output or don't need to be cached.

### noCache
Set to `true` for actions that should never be cached.

### permissions
Controls access level:
- `0`: No permissions (restricted)
- `1`: Full permissions (default)

### dependencies
List of files or actions that this action depends on.

### executable vs command
- `executable`: Use when you want to specify an executable file
- `command`: Use when you want to specify a command name (from PATH)

### js
Specifies a JavaScript module to execute instead of a command. The module should implement an `executeAsync` function.