# Automatic Mod Downloading

## Overview

Enable the CLI to automatically download mod dependencies from the Factorio mod portal using fmtk, reducing manual setup for test runners.

## Current State

fmtk is already used in three places:

- `fmtk mods install` - Downloads the `factorio-test` framework mod
- `fmtk mods adjust` - Enables/disables specific mods
- `fmtk settings set` - Configures mod settings

The `factorio-test` mod is auto-downloaded if missing, but dependencies of the mod-under-test are not handled.

## Proposed Behavior

When running tests:

1. Parse the mod-under-test's `info.json` for its `dependencies` field
2. For each dependency not present in the mods directory, invoke `fmtk mods install`
3. Recursively resolve transitive dependencies
4. Proceed with existing `fmtk mods adjust` step

## Credentials

fmtk handles authentication automatically:

- Reads tokens from Factorio's user data directory
              expect(entity1.direction).toEqual(luaEntity.direction)
  - TODO: point fmtk to user data directory from default install, even when using custom install
- Prompts for login if credentials are missing
- No changes needed in factorio-test CLI for credential handling

## Files to Modify

| File         | Changes                                             |
| ------------ | --------------------------------------------------- |
| `cli/run.ts` | Add dependency resolution before `fmtk mods adjust` |

## New Functions

```
downloadModDependencies(modsDir: string, modName: string)
  - Parse mod's info.json
  - Check each dependency with checkModExists()
  - Call fmtk mods install for missing dependencies
  - Recurse for transitive dependencies
```

## Dependency Format

Factorio `info.json` dependencies follow this format:

```json
{
  "dependencies": ["base >= 2.0", "another-mod >= 1.0", "? optional-mod >= 1.0"]
}
```

Optional dependencies (prefixed with `?`) could be skipped or handled via a CLI flag.

## Considerations

- **Version constraints**: fmtk handles version resolution; the CLI just needs to trigger installation
- **Optional dependencies**: Decide whether to install by default or require explicit opt-in
- **Circular dependencies**: fmtk should handle this, but may need error handling
- **Network failures**: Add retry logic or clear error messages
