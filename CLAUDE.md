# CLAUDE.md

## Project Overview

**FactorioTest** is a testing framework for Factorio mods that enables real in-game testing. It's a monorepo containing:

- **cli** - Command-line test runner (published as `factorio-test-cli`)
- **mod** - Factorio mod providing the testing framework runtime
- **types** - TypeScript definitions for mod developers (published as `factorio-test` npm package)

The project uses TypescriptToLua (TSTL) to compile TypeScript to Lua that runs in Factorio's runtime.

## Development Commands

### Build
```bash
# Build CLI
npm run build --workspace=cli

# Build mod (TypeScript → Lua)
npm run build --workspace=mod

# Watch mode for development
npm run watch-all --workspace=mod

# Clean build artifacts
npm run clean --workspace=cli
npm run clean --workspace=mod
```

### Testing
```bash
# Run all tests
npm run test --workspace=mod

# Run framework self-tests
npm run test:self --workspace=mod

# Run usage test mod
npm run test:usage-test --workspace=mod

# Full check (lint + test)
npm run check --workspace=mod
```

### Linting
```bash
npm run lint --workspace=cli
npm run lint --workspace=mod
```

### CLI Usage
```bash
# Run tests for a mod directory
npx factorio-test run ./path/to/mod

# Run with Factorio command-line options
npx factorio-test run ./path/to/mod -- --cache-sprite-atlas --disable-audio

# Run installed mod by name
npx factorio-test run --mod-name my-mod
```

## Architecture

### TypeScript to Lua Compilation

The project uses TypescriptToLua with multiple tsconfig files:
- `mod/tsconfig.json` - Runtime mod code
- `mod/factorio-test/tsconfig.json` - Framework bundled code  
- `mod/factorio-test/tsconfig-release.json` - Release build

Generated `.lua` files are gitignored except `.def.lua` files.

### CLI Test Runner (cli/run.ts)

The test runner orchestrates the testing process:

1. Auto-detects Factorio executable location
2. Creates symlinks for the test mod and dependencies in a temporary mods directory
3. Manages test data directory
4. Spawns Factorio process with appropriate arguments
5. Monitors stdout/stderr using `buffer-line-splitter.ts` to parse line-by-line output
6. Parses `FACTORIO-TEST-RESULT:` messages from mod output to determine test results
7. Exits with appropriate status code

Key implementation detail: Uses `fmtk` (factorio mod toolkit) for mod dependency management and symlink creation.

### Mod Framework Architecture

The testing framework in `/mod/factorio-test/` implements a sophisticated test execution engine:

**Core Components:**
- `load.ts` - Entry point, initializes test environment and loads test files
- `runner.ts` - State machine-based test executor using a task queue system
- `tests.ts` - Test suite/describe block data structures
- `setup-globals.ts` - Provides global test functions (test, describe, it, before_all, etc.)
- `state.ts` - Manages test run state across script/mod reloads
- `reload-resume.ts` - Handles resuming tests after mod/script reloads

**Test Execution Flow:**
1. Tests are defined during script load phase using BDD syntax
2. Runner processes test tree depth-first, executing lifecycle hooks
3. State machine handles async operations (ticks, reloads) via task queue
4. Results are tracked by event listeners and output via `output.ts`
5. Results are printed to stdout where CLI parses them

**Async Test Support:**
Tests can be async using several mechanisms:
- `async()` + `done()` callback pattern
- `on_tick()` for next-tick execution
- `after_ticks(n)` for delayed execution
- `.after_reload_script()` and `.after_reload_mods()` for reload testing

The state machine in `runner.ts` handles these via a task queue that processes work across multiple ticks.

**Reload/Resume Mechanism:**
Tests can trigger mod or script reloads mid-test. The framework saves test state to `global` before reload, then resumes from the saved state after reload completes. This allows testing migration code and mod compatibility.

### Test Framework Features

- BDD-style syntax: `describe()`, `test()`, `it()`
- Lifecycle hooks: `before_all`, `after_all`, `before_each`, `after_each`, `after_test`
- Test modifiers: `.skip`, `.only`, `.todo`
- Parameterized tests: `.each([...])`
- Tag-based filtering and pattern matching
- Built-in profiling
- In-game progress GUI (`test-gui.ts`, `progress-gui.ts`)
- Debug adapter integration for VSCode debugging

### Constants and Configuration

Shared constants are defined in `mod/constants.d.ts` as TypeScript definitions that are available at runtime. This includes markers like `_TEST_STAGE` and result prefixes like `FACTORIO-TEST-RESULT:`.

Default test configuration is in `mod/factorio-test/config.ts`.

## Key File Locations

- `cli/run.ts` - Main CLI test runner logic
- `mod/init.ts` - Entry point for mods using the framework
- `mod/factorio-test/load.ts` - Framework initialization
- `mod/factorio-test/runner.ts` - Test execution engine
- `mod/factorio-test/tests.ts` - Test data structures
- `types/index.d.ts` - Public TypeScript API
