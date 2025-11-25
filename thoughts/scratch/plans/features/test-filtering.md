# Test Filtering Options

## Overview

Add CLI options to filter which tests run, making "test filter" the default argument for quick test selection.

## Current State

The test framework already supports filtering via config:
- `test_pattern` - Lua string.match pattern against test paths
- `tag_whitelist` - Tests must have ALL listed tags
- `tag_blacklist` - Tests are skipped if they have ANY listed tag

These are available in the `Config` interface but cannot be set from the CLI.

## Proposed CLI Changes

### New argument structure
```
factorio-test run --mod-path <mod-path> [lua pattern test match...]
  --tags <tags...>         Only run tests with these tags
  --skip-tags <tags...>    Skip tests with these tags
  --mod-name <name>        Run installed mod by name
  --factorio-args <args>   Factorio command-line arguments (replaces -- syntax)
```

Make `[filter]` the first positional argument so users can run:
```bash
npm test "some test name"
```

where npm test is configured as 
```
factorio-test run --mod-path ... --mod-name ... --factorio-args etc.
```

## Communication to Mod

Current settings are passed via `fmtk settings set`. New settings needed:
- `factorio-test-test-pattern` (string)
- `factorio-test-tag-whitelist` (comma-separated or JSON)
- `factorio-test-tag-blacklist` (comma-separated or JSON)

## Files to Modify

| File | Changes |
|------|---------|
| `cli/run.ts` | Add CLI options, pass to fmtk settings |
| `mod/settings.ts` | Add new runtime-global settings definitions |
| `mod/factorio-test/load.ts` | Read settings and pass to config |

## Existing Framework Support

The filtering logic is already implemented in `tests.ts`:
- `isSkippedTest()` checks pattern, tags, and mode
- `testMatchesTagList()` handles whitelist/blacklist logic

No changes needed to the test runner itself.
