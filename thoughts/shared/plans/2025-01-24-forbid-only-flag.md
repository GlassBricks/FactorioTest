# --forbid-only Flag Implementation Plan

## Overview

Add `--forbid-only` / `--no-forbid-only` CLI flag to fail test runs when `.only` tests are present. This prevents accidentally committing focused tests. Tests still run normally; only the exit code changes.

## Current State Analysis

- `state.hasFocusedTests` boolean tracks `.only` presence (`mod/factorio-test/state.ts`)
- CLI receives `FACTORIO-TEST-RESULT:<status>` via stdout (`mod/factorio-test/builtin-test-event-listeners.ts`)
- No mechanism exists to communicate focused test presence to CLI
- CLI uses Zod schema in `cli/schema.ts` as single source of truth for options
- Integration tests live in `scripts/` with generic names

## Desired End State

- `--forbid-only` flag defaults to `true`
- When focused tests exist and `--forbid-only` is true, CLI exits with code 1 after running tests
- Clear message indicates the reason for failure
- Configurable via CLI flag and config file
- Integration tests organized in `integration-tests/` directory

## What We're NOT Doing

- Not changing test execution behavior (tests still run)
- Not adding new test result statuses
- Not breaking existing result parsing

## Implementation Approach

Extend the result message format to include a `:focused` suffix when `.only` tests exist. The CLI parses this suffix and conditionally fails based on the `--forbid-only` flag.

## Phase 1: Reorganize Integration Tests

### Overview
Move integration tests from `scripts/` to `integration-tests/` and consolidate test fixture mods.

### Changes Required:

#### 1. Create directory structure
```
integration-tests/
├── run-tests.ts           # Main test runner (moved from scripts/test-config-options.ts)
├── test-usage-mod.ts      # Moved from scripts/test-usage-test-mod.ts
└── fixtures/
    ├── usage-test-mod/    # Moved from ./usage-test-mod
    └── only-test-mod/     # New minimal mod with .only test
```

#### 2. Move usage-test-mod to fixtures
Move `./usage-test-mod/` → `integration-tests/fixtures/usage-test-mod/`

Update `integration-tests/run-tests.ts` to reference the new path:
```typescript
const defaultModPath = "./integration-tests/fixtures/usage-test-mod"
```

Update `integration-tests/test-usage-mod.ts` similarly.

#### 3. Create only-test-mod fixture
**File**: `integration-tests/fixtures/only-test-mod/info.json`
```json
{
  "name": "only-test-mod",
  "version": "1.0.0",
  "title": "Only Test Mod",
  "author": "test",
  "factorio_version": "2.0",
  "dependencies": ["factorio-test"]
}
```

**File**: `integration-tests/fixtures/only-test-mod/control.ts`
```typescript
if ("factorio-test" in script.active_mods) {
  require("__factorio-test__/init")([], {
    after_test_run() {
      print("FACTORIO-TEST-MESSAGE-START")
      log("only-test-mod: completed")
      print("FACTORIO-TEST-MESSAGE-END")
    },
  })
}

test.only("focused test", () => {
  assert(true)
})

test("unfocused test", () => {
  assert(true)
})
```

**File**: `integration-tests/fixtures/only-test-mod/tsconfig.json`
```json
{
  "extends": "../../../mod/tsconfig-base.json",
  "compilerOptions": {
    "rootDir": ".",
    "outDir": "."
  },
  "tstl": {
    "luaTarget": "JIT",
    "noImplicitSelf": true,
    "luaBundle": "lualib_bundle.lua",
    "luaBundleEntry": "control.ts"
  },
  "include": ["./*.ts"]
}
```

#### 4. Move and rename test files
- `scripts/test-config-options.ts` → `integration-tests/run-tests.ts`
- `scripts/test-usage-test-mod.ts` → `integration-tests/test-usage-mod.ts`
- Keep `scripts/new-worktree.sh` in place (not a test)

#### 5. Update tsconfig paths in usage-test-mod
**File**: `integration-tests/fixtures/usage-test-mod/tsconfig.json`

Update extends path to account for new location:
```json
{
  "extends": "../../../mod/tsconfig-base.json",
  ...
}
```

#### 6. Update package.json test scripts
Update mod workspace's package.json to reference new paths.

### Success Criteria:

#### Automated Verification:
- [x] `npm run test --workspace=mod` still works (runs integration tests from new location)

---

## Phase 2: Mod - Communicate Focused Test Status

### Overview
Modify the result message to include focused test information.

### Changes Required:

#### 1. Update result message in builtin-test-event-listeners.ts
**File**: `mod/factorio-test/builtin-test-event-listeners.ts`

In the `testRunFinished` handler, change:
```typescript
print("FACTORIO-TEST-RESULT:" + status)
```
To:
```typescript
const focusedSuffix = state.hasFocusedTests ? ":focused" : ""
print("FACTORIO-TEST-RESULT:" + status + focusedSuffix)
```

### Success Criteria:

#### Automated Verification:
- [x] Mod builds: `npm run build --workspace=mod`
- [x] Mod lints: `npm run lint --workspace=mod`

---

## Phase 3: CLI - Add Flag and Parse Extended Result

### Overview
Add the `--forbid-only` flag to the schema and parse the extended result format.

### Changes Required:

#### 1. Add to CLI config schema
**File**: `cli/schema.ts`

Add `forbid_only` to `cliConfigSchema`:
```typescript
export const cliConfigSchema = z.object({
  // ... existing fields ...
  forbid_only: z.boolean().optional(),
})
```

Add CLI option metadata:
```typescript
const cliOnlyOptions: Record<string, CliOptionMeta> = {
  forbid_only: {
    flags: "--forbid-only",
    description: "Fail if .only tests are present (default: true)",
    negatable: true,
  },
}
```

Update `registerCliOptions` (or create if needed) to register the `--forbid-only` and `--no-forbid-only` options.

#### 2. Update FactorioTestResult type
**File**: `cli/factorio-process.ts`

Update the result interface:
```typescript
export interface FactorioTestResult {
  status: "passed" | "failed" | "todo" | "error"
  hasFocusedTests: boolean
  message?: string
}
```

#### 3. Parse extended result format
**File**: `cli/factorio-process.ts`

In the result parsing logic, update to extract the `:focused` suffix:
```typescript
if (line.startsWith("FACTORIO-TEST-RESULT:")) {
  const resultPart = line.slice("FACTORIO-TEST-RESULT:".length)
  if (resultPart.endsWith(":focused")) {
    hasFocusedTests = true
    resultMessage = resultPart.slice(0, -":focused".length)
  } else {
    resultMessage = resultPart
  }
  factorioProcess.kill()
}
```

Return `hasFocusedTests` in the result object.

#### 4. Add forbid-only failure logic
**File**: `cli/run.ts`

After receiving the test result, check for focused tests:
```typescript
const result = await runFactorioTests(...)

if (result.status) {
  const color = result.status === "passed" ? chalk.greenBright
    : result.status === "todo" ? chalk.yellowBright
    : chalk.redBright
  console.log("Test run result:", color(result.status))

  if (result.hasFocusedTests && (options.forbid_only ?? true)) {
    console.log(chalk.redBright("Error: .only tests are present but --forbid-only is enabled"))
    process.exit(1)
  }

  process.exit(result.status === "passed" ? 0 : 1)
}
```

Merge config file option with default:
```typescript
options.forbid_only ??= fileConfig.forbid_only ?? true
```

### Success Criteria:

#### Automated Verification:
- [x] CLI builds: `npm run build --workspace=cli`
- [x] CLI lints: `npm run lint --workspace=cli`

---

## Phase 4: Unit Tests for --forbid-only

### Overview
Add unit tests for the new schema fields and parsing logic.

### Changes Required:

#### 1. Add schema tests
**File**: `cli/schema.test.ts`

Add tests for `forbid_only`:
```typescript
describe("cliConfigSchema", () => {
  it("accepts forbid_only boolean", () => {
    const config = { forbid_only: false }
    expect(cliConfigSchema.parse(config)).toEqual(config)
  })

  it("defaults forbid_only to undefined (handled at runtime)", () => {
    expect(cliConfigSchema.parse({}).forbid_only).toBeUndefined()
  })
})
```

#### 2. Add result parsing tests
**File**: `cli/factorio-process.test.ts` (new or existing)

```typescript
describe("parseResultMessage", () => {
  it("parses passed without focused", () => {
    const result = parseResultMessage("passed")
    expect(result).toEqual({ status: "passed", hasFocusedTests: false })
  })

  it("parses passed with focused suffix", () => {
    const result = parseResultMessage("passed:focused")
    expect(result).toEqual({ status: "passed", hasFocusedTests: true })
  })

  it("parses failed with focused suffix", () => {
    const result = parseResultMessage("failed:focused")
    expect(result).toEqual({ status: "failed", hasFocusedTests: true })
  })
})
```

### Success Criteria:

#### Automated Verification:
- [x] Unit tests pass: `npm run test --workspace=cli`

---

## Phase 5: Integration Tests for --forbid-only

### Overview
Add integration test cases for the new flag.

### Changes Required:

#### 1. Add test cases to run-tests.ts
**File**: `integration-tests/run-tests.ts`

Add to `testCases` array:
```typescript
{
  name: ".only test with --forbid-only (default) fails",
  modPath: "./integration-tests/fixtures/only-test-mod",
  expectedOutput: ["only-test-mod: completed", "Error: .only tests are present"],
  expectExitCode: 1,
},
{
  name: ".only test with --no-forbid-only passes",
  modPath: "./integration-tests/fixtures/only-test-mod",
  args: ["--no-forbid-only"],
  expectedOutput: ["only-test-mod: completed", "Test run result: passed"],
  expectExitCode: 0,
},
{
  name: "Config file forbid_only: false allows .only tests",
  modPath: "./integration-tests/fixtures/only-test-mod",
  configFile: { forbid_only: false },
  expectedOutput: ["only-test-mod: completed", "Test run result: passed"],
  expectExitCode: 0,
},
{
  name: "No .only tests passes with --forbid-only (usage-test-mod)",
  modPath: "./integration-tests/fixtures/usage-test-mod",
  expectedOutput: ["Test run result:"],
  unexpectedOutput: ["Error: .only tests are present"],
},
```

#### 2. Update TestCase interface
**File**: `integration-tests/run-tests.ts`

Add required `modPath` field to `TestCase` interface:
```typescript
interface TestCase {
  name: string
  modPath: string
  args?: string[]
  configFile?: Record<string, unknown>
  customConfigFile?: { path: string; content: Record<string, unknown> }
  expectedOutput?: string[]
  unexpectedOutput?: string[]
  expectedError?: string
  expectExitCode?: number
}
```

#### 3. Update existing test cases
Add `modPath: "./integration-tests/fixtures/usage-test-mod"` to all existing test cases that previously used the implicit default.

#### 4. Build only-test-mod before running tests
Add build step for the fixture mod in the test script or package.json.

### Success Criteria:

#### Automated Verification:
- [x] Integration tests pass: `npm run test --workspace=mod`
- [x] All forbid-only scenarios covered by automated tests

---

## Phase 6: Final Verification

### Success Criteria:

#### Automated Verification:
- [x] Full build: `npm run build --workspace=mod && npm run build --workspace=cli`
- [x] Full lint: `npm run lint --workspace=mod && npm run lint --workspace=cli`
- [x] CLI unit tests pass: `npm run test --workspace=cli`
- [x] Self-tests pass: `npm run test:self --workspace=mod`
- [x] Integration tests pass: `npm run test:integration`

## References

- CLI schema: `cli/schema.ts`
- CLI run orchestration: `cli/run.ts`
- Factorio process handling: `cli/factorio-process.ts`
- Result output: `mod/factorio-test/builtin-test-event-listeners.ts`
- State tracking: `mod/factorio-test/state.ts`
- Existing integration tests: `scripts/test-config-options.ts`
- Existing test fixture: `usage-test-mod/`
