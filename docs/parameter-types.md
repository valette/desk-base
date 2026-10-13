# Parameter Types

Every action's `parameters` array is processed in order to build the command
line (or the parameter object passed to a JS module). This page documents every
parameter type and the per-parameter options the engine understands.

## How a parameter is resolved

For each parameter entry, `parseParameter` does the following:

1. **Fixed text** — if the entry has a `text` field, it is returned as-is and
   the entry is treated as static command-line text (no `name`, no type). Useful
   for injecting literal flags like `"-rj "` or `"-R"`.
2. **Value lookup** — otherwise the value comes from:
   - `POST[name]`, or
   - `POST[alias]` / the first matching `POST[aliasN]` in `aliases` (backward
     compatible), or
   - `defaultValue` if set.
3. **Required check** — if still `undefined` and `required` is true, an error is
   thrown (`parameter <name> is required!`). If not required, the parameter is
   skipped.
4. **Type check** — a `type` field is mandatory for non-text parameters.
5. **Array handling** — if the type ends in `Array`, the value must be an array;
   if a `length` is declared it must match exactly.
6. **Validation & formatting** — per the type (see below).
7. **Command-line assembly** — the formatted value is wrapped as
   `"<prefix>" + value + "<suffix>"` and appended to the command line. Missing
   `prefix`/`suffix` default to empty strings.

The original (un-formatted) parameter values are also collected:
- `POSTFiles[name]` holds the resolved absolute path(s) for path-like types
  (passed to JS modules).
- `filteredPOST[name]` holds the formatted value used for cache keying.

### Per-parameter options

| Option | Type | Description |
|--------|------|-------------|
| `name` | string | Parameter name (used as the POST key and response/JS-param key). |
| `type` | string | One of the types below. Required for non-text parameters. |
| `text` | string | Fixed text appended verbatim; when present the entry needs no `name`/`type`. |
| `required` | boolean | If true, the parameter must be provided. |
| `defaultValue` | string | Used when no value is provided. |
| `prefix` | string | Text prepended to the formatted value in the command line (e.g. `"--option "`). |
| `suffix` | string | Text appended after the formatted value (e.g. `" postfix"`). |
| `min` / `max` | number | Numeric bounds validated for `int`/`float`/`number` types. |
| `separator` | string | Join separator for array types (default `" "`). |
| `length` | number | Exact required length for array types. |
| `aliases` / `alias` | string/array | Alternative POST keys used to look up the value. |
| `permissions` | — | (Action-level) not a parameter option. |

## Type reference

### Scalar types

| Type | Validates | Command-line output |
|------|-----------|---------------------|
| `string` | Any value (`.toString()`). | Value with spaces escaped (`\ `). |
| `escapedString` | Any value. | Value with spaces, parentheses and commas escaped. Also recorded in `POSTFiles`. |
| `int` | Must be a valid integer. | Original value. |
| `float` / `number` | Must be a valid number. | Original value. |
| `file` | Path resolved against root. | Absolute path with spaces/parens/commas escaped; recorded in `POSTFiles`. |
| `fileString` | Path resolved against root. | Absolute path escaped; recorded in `POSTFiles`. |
| `directory` | Path resolved against root. | Absolute path escaped; recorded in `POSTFiles`. |
| `base64data` | Any value. | Value with spaces escaped. |
| `flag` | Must be `true/yes/1/false/no/0` (case-insensitive). | Empty string — the flag only contributes via its `prefix` (e.g. `-r`, `-f -n +1`). |

### Array types

| Type | Validates | Command-line output |
|------|-----------|---------------------|
| `fileArray` | Every element must be truthy. | Absolute paths (spaces escaped) joined by `separator`. Recorded in `POSTFiles`. |
| `intArray` | Every element must be an integer. | Values joined by `separator`. |
| `floatArray` / `numberArray` | Every element must be a number. | Values joined by `separator`. |
| `stringArray` | Any array. | Values joined by `separator`. |

## Escaping rules

Path-like and string types escape shell-special characters so that values with
spaces, parentheses, or commas survive command-line construction:

- `file`, `fileString`, `directory`, `escapedString`: replace ` ` → `\ `, `(` →
  `\(`, `)` → `\)`, `,` → `\,`.
- `string` and `base64data`: replace ` ` → `\ ` only.
- `fileArray`: each path's spaces are escaped, then joined.

These escaped strings are what actually appears in the command line; the
original, unescaped values are available to JS modules through `POSTFiles` and
`filteredPOST`.

## Numeric bounds (`min` / `max`)

For `int`, `float`, and `number` types, `min`/`max` are parsed with
`parseFloat` and compared against the value; out-of-range values throw an error.

## Flag parameters

`flag` parameters never append their value to the command line — they are meant
to inject switches through `prefix` (and `suffix`). The value is only validated
as a boolean-like string. Typical usage:

```json
{
  "name": "recursive",
  "type": "flag",
  "prefix": "-r"
}
```

Running `{ "action": "copy", "recursive": true }` produces `cp -r ...`.

## Example: full parameter usage

```json
{
  "name": "intArrayValue",
  "type": "intArray",
  "required": true,
  "separator": ",",
  "length": 3,
  "prefix": "this is an int array: [",
  "suffix": "]"
}
```

See `lib/includes/testing/testing.json` (`testAllParameters`) for a working
example that exercises every type at once.
