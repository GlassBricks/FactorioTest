# Config File Support

## Overview

Support a config file to collect CLI arguments, reducing command-line complexity for projects with many options.

## Format

JSON is recommended:
- Built-in Node.js support (no dependencies)
- Matches Factorio ecosystem (info.json, mod-list.json)
- TypeScript integration for schema validation

## File Locations (Priority Order)

1. `--config <file>` - Explicit path
2. `factorio-test.json` - Project root
3. `package.json` "factorio-test" key - NPM convention

## Config Structure

Two sections: CLI options and test framework options.

```json
{
  "modPath": "./my-mod",
  "dataDirectory": "./test-data",
  "mods": ["base", "quality"],
  "verbose": false,
  "showOutput": true,
  
  "test": {
    "defaultTimeout": 3600,
    "gameSpeed": 500,
    "logPassedTests": true,
    "tagBlacklist": ["slow"]
  }
}
```

## Merge Priority

```
Commander defaults
  ↓
Config file values
  ↓
CLI arguments (highest priority)
```

CLI arguments always override config file values.

## Files to Modify

| File | Changes |
|------|---------|
| `cli/run.ts` | Add config loading, merge with CLI options |
| `cli/cli.ts` | Add `--config <path>` option |

## Implementation Notes

- Use `fs.existsSync()` and `JSON.parse()` (already available)
- Validate required fields and types
- Warn on unknown keys
- Transform camelCase config keys to match Commander option names
