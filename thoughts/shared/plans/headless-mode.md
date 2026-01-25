# Headless Mode Implementation Plan

## Overview

Add headless mode as the new CLI default. Uses Factorio's `--benchmark` mode to run tests without graphics, enabling CI/CD environments and faster execution.

## Current State

**CLI (after schema refactor):**
- `cli/schema.ts` - Zod schemas for config validation
- `cli/config.ts` - Config loading and merging
- `cli/factorio-process.ts` - Factorio spawning and output parsing
- `cli/mod-setup.ts` - Mod configuration and settings
- `cli/run.ts` - Orchestration only
- Launches Factorio with `--load-scenario factorio-test/Test`
- Pipes stdout and parses `FACTORIO-TEST-RESULT:` messages

**Mod:**
- Tests triggered via `on_game_created_from_scenario` event in `auto-start.ts`
- GUI always registered in `load.ts`
- Settings passed via `factorio-test-config` JSON (runtime-global)

## Desired End State

- **Default mode:** Headless via `--benchmark` on a pre-generated save
- **`--graphics` flag:** Loads same save with `--load-game`, keeps Factorio running after tests
- **Consistent trigger:** Both modes use `on_load` + `on_tick` (no scenario)
- **No GUI in headless:** Progress GUI and output GUI skipped
- **Clean exit:** Mod calls `error()` to exit benchmark early; CLI treats this as success

### Verification:
- `npm run test:self` passes in both modes
- `npm run test:usage-test` passes in both modes
- Running without `--graphics` shows no window (or closes immediately on non-headless Factorio)
- Running with `--graphics` shows window and Factorio stays open after tests

## What We're NOT Doing

- scenario2map at runtime
- Supporting `--graphics` in config file (CLI-only flag)
- Keeping scenario-based approach (replaced by save-based)

## Implementation Approach

1. Add headless config flag to settings
2. Replace scenario trigger with `on_load` + `on_tick` handler
3. Update mod to skip GUI and exit early in headless mode
4. Update CLI to use `--benchmark`/`--load-game` with save file
5. Bundle headless save file

## Phase 1: Change AutoStart Setting to String

### Overview
Change `factorio-test-auto-start` from bool to string. Encodes both auto-start and mode:
- `"false"` (default) - don't auto-start
- `"headless"` - auto-start in headless mode
- `"graphics"` - auto-start in graphics mode

### Changes Required:

#### 1. Update Setting Definition
**File:** `mod/settings.ts`

Change from bool-setting to string-setting:
```typescript
{
  type: "string-setting",
  setting_type: "startup",
  name: Settings.AutoStart,
  default_value: "false",
  allowed_values: ["false", "headless", "graphics"],
  hidden: true,
  order: "b",
},
```

### Success Criteria:
- [x] `npm run build --workspace=mod` succeeds
- [x] `npm run lint --workspace=mod` passes

---

## Phase 2: Replace Scenario Trigger with on_load + on_tick

### Overview
Replace `on_game_created_from_scenario` handler with `on_load` + `on_tick`. The `on_load` registers a one-shot `on_tick` handler because `remote.call` cannot be used during `on_load`.

### Changes Required:

#### 1. Update auto-start.ts
**File:** `mod/control/auto-start.ts`

Replace scenario event with `on_load` that defers to `on_tick`:
```typescript
import { Remote, Settings } from "../constants"
import { LocalisedString } from "factorio:runtime"

script.on_load(() => {
  const autoStart = settings.startup[Settings.AutoStart]!.value as string
  if (autoStart === "false") return

  const headless = autoStart === "headless"

  script.on_event(defines.events.on_tick, () => {
    script.on_event(defines.events.on_tick, undefined)

    const modToTest = settings.global[Settings.ModToTest]!.value as string

    function autoStartError(message: LocalisedString) {
      if (!headless) game.print(message)
      log(message)
      print("FACTORIO-TEST-MESSAGE-START")
      log(message)
      print("FACTORIO-TEST-MESSAGE-END")
      print("FACTORIO-TEST-RESULT:could not auto start")
      if (headless) error("FACTORIO-TEST-EXIT")
    }

    if (modToTest == "") {
      return autoStartError("Cannot auto-start tests: no mod selected.")
    }

    if (!(modToTest in script.active_mods)) {
      return autoStartError(`Cannot auto-start tests: mod ${modToTest} is not active.`)
    }

    if (remote.interfaces[Remote.FactorioTest] == undefined) {
      return autoStartError("Cannot auto-start tests: the selected mod is not registered with Factorio Test.")
    }

    remote.call(Remote.FactorioTest, "runTests", modToTest)
  })
})
```

Note: The `on_tick` handler unregisters itself immediately on first tick before doing any work.

### Success Criteria:
- [x] `npm run build --workspace=mod` succeeds
- [x] `npm run lint --workspace=mod` passes

---

## Phase 3: Skip GUI in Headless Mode and Add Early Exit

### Overview
Conditionally skip GUI registration and call `error()` to exit early when in headless mode.

Note: Sound effects don't need special handling - Factorio's headless/benchmark mode already disables audio.

### Changes Required:

#### 1. Update doRunTests
**File:** `mod/factorio-test/load.ts`

Update `doRunTests()` to check auto-start mode:
```typescript
function doRunTests() {
  const state = getTestState()
  clearTestListeners()
  builtinTestEventListeners.forEach(addTestListener)
  if (game !== undefined) game.tick_paused = false

  const headless = settings.startup[Settings.AutoStart]?.value === "headless"
  if (!headless) {
    addTestListener(progressGuiListener)
    addMessageHandler(progressGuiLogger)
  }

  if (debugAdapterEnabled) {
    addMessageHandler(debugAdapterLogger)
  } else {
    addMessageHandler(logLogger)
  }
  // ... rest unchanged
}
```

Add import for `Settings`.

#### 2. Add Early Exit in Headless Mode
**File:** `mod/factorio-test/builtin-test-event-listeners.ts`

Extract result printing to helper function and update `setupListener`:
```typescript
import { Settings } from "../constants"

function emitResult(status: string) {
  print("FACTORIO-TEST-RESULT:" + status)
  if (settings.startup[Settings.AutoStart]?.value === "headless") {
    error("FACTORIO-TEST-EXIT")
  }
}

const setupListener: TestEventListener = (event, state) => {
  if (event.type === "testRunStarted") {
    game.speed = state.config.game_speed
    game.autosave_enabled = false
    state.config.before_test_run?.()
  } else if (event.type === "testRunFinished") {
    game.speed = 1
    const status = state.results.status
    if (state.config.sound_effects) {
      const passed = status === "passed" || status === "todo"
      game.play_sound({ path: passed ? "utility/game_won" : "utility/game_lost" })
    }

    state.config.after_test_run?.()
    cleanupTestState()

    emitResult(status)
  } else if (event.type === "loadError") {
    game.speed = 1
    game.play_sound({ path: "utility/console_message" })

    emitResult("loadError")
  }
}
```

### Success Criteria:
- [x] `npm run build --workspace=mod` succeeds
- [x] `npm run lint --workspace=mod` passes

---

## Phase 4: CLI Headless and Graphics Modes

### Overview
Update CLI to use `--benchmark` (headless) or `--load-game` (graphics) with the same save file. Integrates with the schema-based CLI structure.

### Changes Required:

#### 1. Add Save Path to Schema
**File:** `cli/schema.ts`

Add `save` to `cliConfigSchema`:
```typescript
export const cliConfigSchema = z.object({
  // ... existing fields ...
  save: z.string().optional(),
})
```

#### 2. Add CLI Options
**File:** `cli/run.ts`

Add options (note: `--graphics` is CLI-only, not in schema/config):
```typescript
.option("--graphics", "Run with graphics (interactive mode). By default, runs headless using benchmark mode.")
.option("--save <path>", "Path to save file (default: bundled headless-save.zip)")
```

#### 3. Add getHeadlessSavePath Function
**File:** `cli/factorio-process.ts`

```typescript
export function getHeadlessSavePath(overridePath?: string): string {
  if (overridePath) {
    return path.resolve(overridePath)
  }
  return path.join(__dirname, "headless-save.zip")
}
```

#### 4. Add Headless Runner Function
**File:** `cli/factorio-process.ts`

```typescript
export async function runFactorioTestsHeadless(
  factorioPath: string,
  dataDir: string,
  savePath: string,
  additionalArgs: string[],
  options: { verbose?: boolean; showOutput?: boolean },
): Promise<FactorioTestResult> {
  const args = [
    "--benchmark",
    savePath,
    "--benchmark-ticks",
    "1000000000",
    "--mod-directory",
    path.join(dataDir, "mods"),
    "-c",
    path.join(dataDir, "config.ini"),
    ...additionalArgs,
  ]

  console.log("Running tests (headless)...")
  const factorioProcess = spawn(factorioPath, args, {
    stdio: ["inherit", "pipe", "pipe"],
  })

  let resultMessage: string | undefined
  const handleLine = createLineHandler(options, (msg) => { resultMessage = msg })

  new BufferLineSplitter(factorioProcess.stdout).on("line", handleLine)
  new BufferLineSplitter(factorioProcess.stderr).on("line", handleLine)

  await new Promise<void>((resolve, reject) => {
    factorioProcess.on("exit", (code, signal) => {
      if (resultMessage !== undefined) {
        resolve()
      } else {
        reject(new Error(`Factorio exited with code ${code}, signal ${signal}, no result received`))
      }
    })
  })

  return { status: resultMessage as FactorioTestResult["status"], message: resultMessage }
}
```

#### 5. Add Graphics Runner Function
**File:** `cli/factorio-process.ts`

```typescript
export async function runFactorioTestsGraphics(
  factorioPath: string,
  dataDir: string,
  savePath: string,
  additionalArgs: string[],
  options: { verbose?: boolean; showOutput?: boolean },
): Promise<FactorioTestResult> {
  const args = [
    "--load-game",
    savePath,
    "--mod-directory",
    path.join(dataDir, "mods"),
    "-c",
    path.join(dataDir, "config.ini"),
    ...additionalArgs,
  ]

  console.log("Running tests (graphics)...")
  const factorioProcess = spawn(factorioPath, args, {
    stdio: ["inherit", "pipe", "inherit"],
  })

  let resultMessage: string | undefined
  const handleLine = createLineHandler(options, (msg) => { resultMessage = msg })

  new BufferLineSplitter(factorioProcess.stdout).on("line", handleLine)

  await new Promise<void>((resolve, reject) => {
    factorioProcess.on("exit", (code, signal) => {
      if (resultMessage !== undefined) {
        resolve()
      } else {
        reject(new Error(`Factorio exited with code ${code}, signal ${signal}`))
      }
    })
  })

  return { status: resultMessage as FactorioTestResult["status"], message: resultMessage }
}
```

#### 6. Extract Line Handler
**File:** `cli/factorio-process.ts`

```typescript
function createLineHandler(
  options: { verbose?: boolean; showOutput?: boolean },
  onResult: (msg: string) => void,
): (line: string) => void {
  let isMessage = false
  let isMessageFirstLine = true

  return (line: string) => {
    if (line.startsWith("FACTORIO-TEST-RESULT:")) {
      onResult(line.slice("FACTORIO-TEST-RESULT:".length))
    } else if (line === "FACTORIO-TEST-MESSAGE-START") {
      isMessage = true
      isMessageFirstLine = true
    } else if (line === "FACTORIO-TEST-MESSAGE-END") {
      isMessage = false
    } else if (options.verbose) {
      console.log(line)
    } else if (isMessage && options.showOutput) {
      if (isMessageFirstLine) {
        console.log(line.slice(line.indexOf(": ") + 2))
        isMessageFirstLine = false
      } else {
        console.log("    " + line)
      }
    }
  }
}
```

#### 7. Update mod-setup.ts
**File:** `cli/mod-setup.ts`

Update `setSettingsForAutorun` to accept mode:
```typescript
export async function setSettingsForAutorun(
  factorioPath: string,
  dataDir: string,
  modsDir: string,
  modToTest: string,
  mode: "headless" | "graphics",
  verbose?: boolean,
): Promise<void> {
  // ... existing mod-settings.dat creation ...

  if (verbose) console.log("Setting autorun settings")
  await runScript("fmtk settings set startup factorio-test-auto-start", mode, "--modsPath", modsDir)
  await runScript("fmtk settings set runtime-global factorio-test-mod-to-test", modToTest, "--modsPath", modsDir)
}

export async function resetAutorunSettings(modsDir: string, verbose?: boolean): Promise<void> {
  if (verbose) console.log("Disabling auto-start settings")
  await runScript("fmtk settings set startup factorio-test-auto-start", "false", "--modsPath", modsDir)
}
```

#### 8. Update run.ts Orchestration
**File:** `cli/run.ts`

```typescript
const mode = options.graphics ? "graphics" : "headless"
const savePath = getHeadlessSavePath(options.save ?? fileConfig.save)

await setSettingsForAutorun(factorioPath, dataDir, modsDir, modToTest, mode, options.verbose)

// ... test config setup ...

let result: FactorioTestResult
try {
  result = mode === "headless"
    ? await runFactorioTestsHeadless(factorioPath, dataDir, savePath, additionalArgs, { verbose: options.verbose, showOutput: options.showOutput })
    : await runFactorioTestsGraphics(factorioPath, dataDir, savePath, additionalArgs, { verbose: options.verbose, showOutput: options.showOutput })
} finally {
  await resetAutorunSettings(modsDir, options.verbose)
  // ... rest of cleanup ...
}
```

#### 9. Add Unit Tests
**File:** `cli/factorio-process.test.ts`

Add tests for:
- `getHeadlessSavePath()` - returns override path when provided, otherwise bundled path
- `createLineHandler()` - correctly parses FACTORIO-TEST-RESULT and FACTORIO-TEST-MESSAGE markers

### Success Criteria:
- [x] `npm run build --workspace=cli` succeeds
- [x] `npm run lint --workspace=cli` passes
- [x] `npm run test --workspace=cli` passes (unit tests including new tests)

---

## Phase 5: Bundle Headless Save

### Overview
Bundle pre-generated headless save file with CLI npm package. The save must exist at build/publish time.

### Changes Required:

#### 1. Add Save File
**File:** `cli/headless-save.zip`

Place the pre-generated save file in the cli directory. This file is committed to the repo.

#### 2. Update package.json
**File:** `cli/package.json`

Include `headless-save.zip` in npm package distribution:
```json
{
  "files": [
    "dist",
    "headless-save.zip"
  ]
}
```

The save will be installed alongside compiled JS at `node_modules/factorio-test-cli/headless-save.zip`, accessible via `path.join(__dirname, "headless-save.zip")` from the compiled output.

### Success Criteria:
- [x] `headless-save.zip` exists in `cli/` directory
- [x] `npm pack --workspace=cli` includes the save file
- [x] After `npm install`, save exists at expected path relative to `__dirname`
- [x] `npm run test:self` passes (headless mode)

#### Manual Verification:
- [ ] `npm run test:self -- --graphics` passes and keeps Factorio open
- [ ] `npm run test:self -- --save /path/to/custom.zip` uses custom save

---

## Phase 6: Cleanup

### Overview
Remove scenario-related code that's no longer needed.

### Changes Required:

#### 1. Delete Test Scenario
**Directory:** `mod/scenarios/Test/`

Remove the entire directory - no longer needed since we use save file.

#### 2. Update CLI Help Text
**File:** `cli/run.ts`

Remove scenario-related help text if any.

### Success Criteria:
- [x] `npm run build --workspace=mod` succeeds
- [x] `npm run test:self` still passes

---

## Testing Strategy

### Integration Tests (Phase 5)
- Run self-tests in headless mode (default)
- Run self-tests in graphics mode (`--graphics`)

### Manual Testing (Phase 5)
1. `npm run test:self` - uses headless mode by default
2. `npm run test:self -- --graphics` - opens Factorio, keeps running after tests
3. Verify headless mode works without display (`DISPLAY=` unset on Linux)

## References

- Factorio command line parameters: https://wiki.factorio.com/Command_line_parameters
  - `--benchmark FILE` - load save and run benchmark
  - `--load-game FILE` - start Factorio and load a game in singleplayer
