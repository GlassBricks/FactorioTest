# Step Mode — Functional Spec

Rules with IDs (`TICK-1`) are normative, IDs are for cross-reference and test mapping.
Text in block quotes (`>`) are informative.

## Purpose

Let a developer watch a test run at human speed in a window: pause before each test and at
step boundaries inside a test, showing what is about to happen, with controls to continue, skip
the current test, or stop pausing.

Motivating use: diagnosis. A world-building fixture reproducing a bug becomes useful for more than
pass/fail when you can watch it happen.

`.step()` is also a general way to sequence a test: each step starts on a new tick with its own
async context, replacing nested `after_ticks` callbacks. Step mode is one consumer of these
boundaries.

## Background

- Factorio Lua has no `coroutine`, so a test body cannot suspend mid-function. Step points are
  therefore boundaries _between test parts_, declared up front, not an inline `step()` call.
- The runner is driven only by `on_tick`, after the mod-under-test's own `on_tick` handler (tapped
  event: original handler, then runner).
- `on_tick` does not fire while `game.tick_paused`; only user input (GUI click → remote call) can
  act during a pause.
- So a pause must return from the current `on_tick` for the game to render; the rest of that tick
  still simulates.

## Definitions

- **Part**: a function passed to `test()`, `.step()`, or `after_reload_*`.
- **Step part**: a part added via `.step()`, captioned or not.
- **Step label**: the step part's caption if given, else `step <n>`, where `n` is its 1-based index
  among the test's step parts (the test body and `after_reload_*` parts are not counted).
- **Runner tick**: one `TestRunner.tick()` call in which the runner acts (i.e. not paused).
  `load.ts` calls `tick()` once per `on_tick`.
- **Step action**: Step, Run to end, or Skip test.
- **Paused**: from entering a pause until the next step action or Cancel.
- **Between parts**: from a part completing until the next step part starts (the boundary tick, plus
  any pause).
- **User-skipped test**: a test abandoned via Skip test (SKIP-\*).

## API

### Test declaration

```ts
test("connects an underground pipe", () => placeUnderground())
  .step("place the covering tile", () => placeTile())
  .step(() => assertConnected()) // label: "step 2"
```

- **API-1** `TestBuilder` overloads, each appending a step part:

  ```ts
  step(func: F): TestBuilder<F>
  step(caption: string, func: F): TestBuilder<F>
  ```

- **API-2** Chainable; mixes with `after_reload_script` / `after_reload_mods`.
- **API-3** Works with `test.each(...)`: `func` receives the row args like other parts.
- **API-4** `step()` accepts `(function)` or `(string, function)`; any other arguments throw:
  `step() takes an optional caption and a function: test(...).step("caption", func) or test(...).step(func)`.
  > Catches Lua `:step(...)` misuse: `:step(f)` and `:step("c", f)` both pass the builder table
  > first.
- **API-5** API docs for `step()` state: "each step starts on a new tick, with its own `async()`
  context."

### Config

- **CFG-1** Config surfaces:

  | Surface               | Name                            |
  | --------------------- | ------------------------------- |
  | `FactorioTest.Config` | `step: boolean` (default false) |
  | `TestRunnerConfig`    | `step?: boolean`                |
  | CLI flag              | `--step`                        |
  | CLI config file       | `test.step`                     |

- **CFG-2** A mod may declare `step` in its own config. Precedence as for other config fields
  (CLI-provided settings override mod-declared).
- **CFG-3** CLI help example:
  `factorio-test run -p ./my-mod -g --step   Walk the run step by step, in a window`.

## Behavior

### Part async context

- **ASYNC-1** Each part has its own async state: `async()`, `done()`, `on_tick()`, and
  `after_ticks()` called while a part runs belong to that part.
- **ASYNC-2** The next part starts only once the current part completes (sync, `done()`, or all
  its implicit tick handlers finished). Timeouts are per part: `default_timeout`, or the part's own
  `async(n)`.
- **ASYNC-3** `on_tick` / `after_ticks` handlers do not carry over: once a part completes, its
  handlers no longer run.
  > E.g. an `on_tick` monitor registered in the test body stops when the first step starts.
  > Register it in each part that needs it.
- **ASYNC-4** `done()` acts on the part running when it is called. A callback registered outside
  the framework (e.g. `script.on_event`) in one part that calls `done()` later completes whichever
  part is then running.
  > Holds by construction: each part gets a fresh `PartRun` (`newPartRun`), and `async` / `done` /
  > `on_tick` resolve `currentTestRun.part` at call time. Already true for `after_reload_*` parts.
- **ASYNC-5** Between parts, `async()`, `done()`, `on_tick()`, and `after_ticks()` throw
  `<name>() cannot be called between test parts`.
  > E.g. an event handler registered in the test body calls `done()` while paused before a step.
  > Without this, `done()` would hit the completed part, and `on_tick` / `after_ticks` would
  > register on it and silently never run.

### Step mode off (default)

- **OFF-1** The run never pauses.
- **OFF-2** Results and reporting are unchanged, except failures name the step (FAIL-1) and the
  progress GUI shows the current step (OUT-1).

### Pausing (step mode on)

- **PAUSE-1** The run pauses before each test that will run; caption = test path.
- **PAUSE-2** The run pauses before each step part, captioned or not; caption = step label.
  > A caption only labels the boundary; it never changes runtime behavior.
- **PAUSE-3** The run does not pause:
  - before skipped tests (`test.skip`, filtered, todo, etc.)
  - before `after_reload_*` parts
  - before a step part when the test already has errors (ERR-1)
- **PAUSE-4** When entering a pause (timing: TICK-2), the game is paused (`game.tick_paused`).
  > So the screen shows the world state at the step boundary.
- **PAUSE-5** While step mode is on, the run uses `game.speed = 1` instead of `config.game_speed`.
  When step mode is turned off mid-run (CTL-4), `game.speed` reverts to `config.game_speed`.
- **PAUSE-6** Each run starts with step mode as configured; Run to end (CTL-4) affects only the
  current run.

### Controls (in-game test GUI)

- **CTL-1** Step controls: a pause icon before the status text, and buttons **Skip test**, **Run to
  end** (`utility/tick_once` icon), **Step** (primary/confirm style), right-aligned at the bottom
  of the top frame, below a full-width separator line. Shown from the first pause until Run to end,
  Cancel, or the run ends. While paused: icon shown, buttons enabled. On resume: icon blank (its slot
  is kept, so the text doesn't shift). Buttons are disabled only once a step outlasts the tick it
  started on: a step that pauses again within its tick never toggles them (toggling drops the
  button's hover state). What comes next is named by the status text (OUT-1). The existing **Cancel** remains available.
- **CTL-2** A step action or Cancel while paused unpauses the game immediately; the action takes
  effect on the next runner tick.

| ID    | Action     | Effect                                                                                  |
| ----- | ---------- | --------------------------------------------------------------------------------------- |
| CTL-3 | Step       | Run the next thing (test start or part).                                                |
| CTL-4 | Run to end | Disable step mode for the remainder of this run (incl. PAUSE-5 speed revert); continue. |
| CTL-5 | Skip test  | Abandon the current test (SKIP-\*).                                                     |
| CTL-6 | Cancel     | Cancel the run with normal cancel semantics.                                            |

- **CTL-7** A step action arriving while not paused (stale click) is ignored.
- **CTL-8** Run to end lasts for the whole run, including across `after_reload_*` reloads.
- **CTL-9** A step action arriving when no run is in progress unpauses the game and hides the step
  controls.
  > E.g. a save made while paused, then loaded: the GUI (in `storage`) still shows the step controls, but
  > there is no runner to act on, and `on_tick` doesn't fire until unpaused.

### Skip test

- **SKIP-1** If paused before a test starts: the test does not run, is reported **skipped**, and
  the run moves to the next sibling.
- **SKIP-2** If paused between parts: remaining parts do not run; `after_test` and `after_each`
  hooks still run; errors they raise are not recorded; the test is reported **skipped**.
  > Skip on a test that already has errors is expected impossible: PAUSE-3 prevents pausing once
  > a test has errors.
- **SKIP-3** A user-skipped test counts as skipped (`results.skipped`), not toward `ran`. No new
  result type in results / CLI.
- **SKIP-4** A user-skipped test is always logged as `SKIP <test.path>`, regardless of
  `log_skipped_tests`.
- **SKIP-5** The progress GUI stops counting a user-skipped test as active: its total drops by one,
  so the progress bar still reaches full.

### Errors

- **ERR-1** Once a test has errors, its remaining parts (step or `after_reload_*`) are skipped in
  the same runner tick, with no step boundary or pause; `after_test` and `after_each` hooks still
  run, then the test is reported failed.
  > Unchanged from today (`advanceParts`); stated because TICK-1 would otherwise imply a tick per
  > skipped step part.

### Hooks

- **HOOK-1** `after_test` hooks registered in any part run at test end, including when registered
  in a part before a step part.
  > Holds today (`afterTestFuncs` lives on `TestRun`, not `PartRun`); only reachable once
  > non-reload parts exist.

### Tick behavior

- **TICK-1** With step mode off, a step part starts on the first runner tick after the previous
  part completes.
  > Step mode on can't avoid the boundary (see Background), so step mode off _creates_ a one
  > tick difference between steps, so the behavior is the same in both modes.
- **TICK-2** With step mode on, a pause occurs on the runner tick immediately before the one on
  which the test or part would have started with step mode off. After a step action, it starts on
  the next runner tick.
  - For a step part: the tick the previous part completes.
  - For a test with `ticks_between_tests(n)`, `n >= 1`: the tick `n - 1` runner ticks after the
    previous test finished (for the first test: after the run began). With the default `n = 1`,
    that is the same tick.
  - Exception: with `ticks_between_tests(0)` there is no tick before the test; the pause occurs on
    the tick the test would have started, and the test starts one runner tick later (DIFF-1).
    > Net effect: excluding paused time, runner timing matches step mode off.
- **TICK-3** While paused, if `on_tick` fires (user unpaused or ticked the world via map editor,
  console, etc.), the run does not advance: no test code runs, `after_ticks` / timeouts /
  `ticks_between_tests` don't count down, and the game is not re-paused. The world, including the
  mod's own `on_tick`, runs freely.
- **TICK-4** Unchanged: `before_each` hooks and the first part run in the same tick;
  `after_reload_*` boundaries keep their reload timing.
- **TICK-5** Async timeouts and `after_ticks` count from when the part starts running, not from
  when it was queued, so a pause never consumes a part's timeout.
  > Holds by construction with the runner-owned part tick counter (Runner notes): a part's
  > counter only exists once the part starts, and only runner ticks advance it.

Timeline:

```
step off: part N @T → rest of T simulates → T+1: mod on_tick → part N+1
step on:  part N @T → pause → rest of T simulates → frozen … Step
          → next on_tick: mod on_tick → part N+1
```

### Permitted differences between step mode on and off

- **DIFF-1** Excluding paused time, behavior is the same with step mode on and off, except:
  - Events or world mutations caused by the user while paused, including manual ticking. Parts
    may run at a later `game.tick`; user input events (GUI, input) may arrive between ticks.
  - With `ticks_between_tests(0)`: one extra tick before each test (TICK-2).

  Tests must not assert other differences.

### Headless / CLI

- **HL-1** CLI: if `step` is true (flag or config file) without `--graphics`, error, exit 1:
  `Step mode requires --graphics: there is no in-game GUI to continue from otherwise.`
- **HL-2** Mod running headless with `step` true (e.g. mod-declared): logs
  `factorio-test: step requires graphics mode (there is no GUI to continue from); ignoring it`,
  and the run proceeds normally with step mode off.

## Output

`<step label>` below is the step label (Definitions).

- **OUT-1** While a step part runs (step mode on or off), and while paused before it, the progress
  GUI status text is `<test.path> > <step label>`. Reset as today when the next test is entered or
  the test finishes. So while paused, the status text names what runs next.
- **OUT-2** With `--verbose`, the CLI prints `Step: <test.path> > <step label>` (dim) when a step
  part starts, like `Starting: <test.path>` for tests.
- **OUT-3** The CLI progress line (TTY) shows `Running: <test.path> > <step label>` while a step
  part runs.
  > OUT-2 / OUT-3 are only observable in headless runs, i.e. with step mode off: the mod sends
  > events to the CLI only when headless (`createTestListeners` in `load.ts`), and step mode
  > requires graphics (HL-\*).
- **OUT-4** The mod log has no line for step start.
  > Like test start: mod log lines are outcomes only.
- **FAIL-1** Errors attributed to a step part are prefixed: `In step "<caption>": <error>` if
  captioned, else `In step <n>: <error>`. Attributed: errors from the part's function, from its
  `on_tick` / `after_ticks` handlers, and its timeout. Not attributed: errors from `before_each`,
  `after_test`, and `after_each` hooks. It reaches CLI, GUI, and log through the existing
  `testFailed` errors; works headless.

## Non-goals

- Inline mid-function `step()`.
- Pausing between `after_reload_*` parts.
- Driving the runner outside `on_tick` (e.g. running the next part directly from the step-bar
  click).
  > It would avoid the extra tick, but can't remove the remaining partial-tick difference, and
  > adds a second drive path with test code running inside another mod's remote call.
- Any headless stepping.
- Keyboard shortcuts for step controls.
- An in-game toggle for step mode (e.g. in the mod-select GUI); enable it via config (CFG-\*).

## Expected implementation notes

### Environment boundary

The test boundary is `TestContext` + `TestRunner`: define tests through the context's API, call
`tick()` / step actions by hand, observe `TestEvent`s. `TestRunner` decides _what_ happens and
_when_ (in runner ticks), and reports it only as `TestEvent`s. It reads no game state for timing
and writes no game, GUI, or output state for step mode. Every side effect is a small adapter at the
boundary: easy to verify by reading, checked by hand (Manual testing), and not unit-tested.

| Adapter                                                    | Responsibility                                                                                                                                                                                                                                          |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gameEnvironmentListener` (`builtin-test-event-listeners`) | `stepPaused` → `tick_paused = true`; `stepResumed` → `tick_paused = false`; speed 1 if `config.step`, restored on `runRest`                                                                                                                             |
| progress GUI (`test-gui.ts`)                               | step controls on `stepPaused` / `stepResumed`, also hidden in `showRunEnded`; status text on `stepStarted` and `stepPaused`; total and counts on `testSkippedByUser`                                                                                    |
| log listener (`createLogListener`)                         | `testSkippedByUser` → `SKIP` line, unconditionally                                                                                                                                                                                                      |
| `cliEventEmitter`                                          | forwards `stepStarted`                                                                                                                                                                                                                                  |
| `load.ts` `on_tick` glue                                   | keep `tick_paused = false` and disable step buttons (`showStepRunning`) after each runner tick unless `runner.isStepPaused()`; routes GUI/remote actions to runner; with no `currentRunner`, a step action unpauses and hides the step controls (CTL-9) |

> Meta tests run inside a real headless run. With no runner-side game reads or writes, an inner
> runner can't freeze the outer run, and step tests drive it synchronously in one meta test tick.

### Events

New `TestEvent`s:

| Event               | Payload                                     | Emitted when                                                                        | Consumer                                                                                            |
| ------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `stepPaused`        | `{ test: Test; step: string \| undefined }` | Run pauses. `step` = step label; undefined = before test start.                     | progress GUI; `gameEnvironmentListener`                                                             |
| `stepResumed`       | `{ action: StepAction \| "cancel" }`        | Any exit from a pause: Step, Run to end, Skip test, Cancel.                         | progress GUI; `gameEnvironmentListener`                                                             |
| `stepStarted`       | `{ test: Test; step: string }`              | A step part begins running (step mode on or off); not when queued or paused-before. | progress GUI: status text; `cliEventEmitter`                                                        |
| `testSkippedByUser` | `{ test: Test }`                            | Skip test takes effect; instead of `testSkipped`.                                   | `recordEvent` (runner): `skipped++` (not `ran`); log listener; progress GUI: `totalTests--`, counts |

- `stepResumed` is emitted synchronously from the action call (CTL-2: unpause immediately), not on
  the next tick.
- `stepPaused` / `stepResumed` / `testSkippedByUser` are mod-side only: no headless stepping, so
  the CLI never needs them.
- `stepStarted` is forwarded to the CLI as `TestRunnerEvent`
  `{ type: "stepStarted"; test: TestInfo; step: string }` (`types/events.d.ts`), handled like
  `testStarted`: `OutputFormatter.formatEvent` (verbose line), `ProgressRenderer.handleEvent`
  (current test label; cleared by `handleTestFinished` as today). `TestRunCollector` ignores it.
- Step controls: `stepPaused` → shown, pause icon, buttons enabled; `stepResumed` → hidden for
  `runRest` / `cancel`, else icon blank; `showStepRunning()` (`load.ts` glue) → buttons disabled;
  `showRunEnded` → hidden: a save made while paused can be loaded, then unpaused into a load error
  with the controls still shown (CTL-9). Button `enabled` is written only when it changes.
- Status text reset by existing `testEntered` / test-finished handling.

### Runner

- Prerequisite refactor (own commit, no behavior change): the runner counts part ticks itself
  instead of reading `game.tick`. Replace `tickStarted: game.tick` (`newPartRun`),
  `game.tick - part.tickStarted` (`pollAsyncPart`), and the same in `afterTicks`
  (`setup-globals.ts`) with a per-part counter advanced once per `pollAsyncPart`. Equivalent
  because `load.ts` calls `tick()` once per `on_tick`; existing `on_tick`-driven meta tests keep
  passing unchanged.
- `TestPart` gains `step?: { caption?: string; index: number }` (set only on step parts). One
  helper `stepLabel(part)` produces the step label for events; FAIL-1 formats from the same
  fields (quoted caption vs bare `step <n>`), applied to every error pushed while the step part is
  the current part (`runPart`, `pollAsyncPart` handlers and timeout).
- ASYNC-1..4 need no runner change beyond the step boundary itself: parts already get a fresh
  `PartRun`. ASYNC-5: `TestRun.part` is `undefined` between parts; `getCurrentPart`
  (`setup-globals.ts`) throws the ASYNC-5 message when it is.
- ERR-1: `advanceParts` keeps draining remaining parts in the same tick when the test has errors;
  the step boundary applies only when it has none.
- Step actions are `TestRunner` methods next to `requestCancel()`, e.g.
  `stepAction(action: StepAction)` with `StepAction = "continue" | "runRest" | "skipTest"`. The
  GUI / remote interface call them on `currentRunner` (`load.ts`); meta tests call them directly.
- Step state lives on the `TestRunner`. A run can span several runners: each reload creates a new
  one (`tryContinueTests` → `doRunTests` → `resumeAfterReload`). So:
  - paused: runner-only (no pause across a reload: pauses never precede `after_reload_*` parts)
  - effective on/off (`stepping`): set from `config.step` in `startTestRun` (the per-run reset,
    PAUSE-6); carried across reloads in `ResumeData` the same way as `isRerun`: `prepareReload`
    saves it, `resumeAfterReload` restores it (CTL-8). `game.speed` is game state, so it survives
    reloads without help.
- Cancel while paused: `requestCancel()` also clears the pause and emits `stepResumed`; `tick()`
  already handles `cancelRequested` first. Not paused (incl. `bail` from `leaveTest`): no step
  event.
- Skip test while between parts: `leaveTest` path with `runAfterEachHooks(testRun, false)`, then
  `testSkippedByUser` instead of `testPassed` / `testFailed` (SKIP-2).
- HL-1 lives in `validateRunConfig` (`cli/run-plan.ts`), next to the `--no-auto-start` check;
  it reads the merged `testConfig.step` (add `testConfig` to its `Pick<ResolvedConfig, …>`), so
  flag and config file are both covered.
- HL-2 is a pure function `(config, headless) → { config, warning? }`, applied in `loadTests`
  (`load.ts`) to the `resolveConfig` result before `beginDefinition(config)`: config is immutable
  after that. Not in `TestRunner`: meta tests run headless and use `useMockConfig({ step: true })`.

### Locale

```
step-continue=Step
step-skip-test=Skip test
step-run-rest=Run to end [img=utility/tick_once]
running-step=__1__ > __2__
```

## Tests

Automated tests cover the runner at its boundary (`TestContext` + `TestRunner`), plus CLI logic.
Adapters are covered by Manual testing.

### Runner (meta tests)

Driven synchronously: define via `api`, `newRunner(...)`, call `tick()` in a loop and step
actions between ticks. A helper records each event with the index of the `tick()` call that
emitted it (or "sync" for events emitted by a step action), and logs test code (hooks, parts) the
same way. No `on_tick`, no `game.tick`.

Timeline fixture: `before_each`; test A with a sync first part (registers `after_test`), a sync
captioned step part, an uncaptioned async step part (`async(2)` + `after_ticks(2, done)`); test B
with one part.

1. Step mode off: exact event/action log with tick indices. Step parts start on the runner tick
   after the previous part completes; `stepStarted` when a step part runs; `before_each` and the
   first part on the same tick; `after_test` from the first part runs at test end. (TICK-1, TICK-4,
   HOOK-1, OUT-1)
2. Step mode on, parameterized over `ticks_between_tests` ∈ {1, 0} × paused ticks ∈ {0, 5}: at
   each `stepPaused`, call `tick()` `n` times, then Step. Assert:
   - `stepPaused` before each test (`step` undefined) and each step part (`step` = caption, then
     `step 2`), from the `tick()` that enters the pause; `stepResumed { action: "continue" }` sync
     from the action
   - paused `tick()` calls emit nothing and run no test code
   - with paused ticks and step events removed, the log equals case 1 (`ticks_between_tests(1)`), or
     case 1 with one extra tick before each test (`ticks_between_tests(0)`)
   - the async step part does not time out despite paused ticks > its timeout

   (PAUSE-1, PAUSE-2, TICK-2, TICK-3, TICK-5, CTL-1, CTL-2, CTL-3, DIFF-1)

3. Step actions, parameterized `[pause point, action] → expected events after the action`; each
   asserts `stepResumed { action }` is emitted sync from the action call (CTL-2):
   - before test, Skip test: test never starts, `testSkippedByUser`, `results.skipped` +1 and
     `ran` unchanged, next test pauses (SKIP-1, SKIP-3)
   - before step part, Skip test, with an `after_each` that throws: remaining parts don't run;
     `after_test` and `after_each` run; `testSkippedByUser`, no error recorded (SKIP-2, SKIP-3)
   - Run to end: no further `stepPaused`; a rerun on the same state pauses again (CTL-4,
     PAUSE-6)
   - Cancel (`requestCancel()`): `stepResumed { action: "cancel" }`, run cancelled (CTL-6)
   - any step action, or `requestCancel()`, while not paused: no step event; step actions have no
     effect (CTL-7)
4. No pause, errors, and step error prefix. Fixture: a skipped test; a test whose captioned step
   part errors, followed by another step part; a test whose uncaptioned step part errors from an
   `after_ticks` callback; a test whose uncaptioned step part times out. Assert:
   - `stepPaused` only before each runnable test starts and before its first step part (PAUSE-3)
   - after the error, the following step part doesn't run; `after_test` / `after_each` run and
     `testFailed` is emitted on the same `tick()` as the error (ERR-1)
   - failure errors are `In step "<caption>": ...`, `In step 1: ...`, and
     `In step 1: Test timed out ...` (FAIL-1)
5. Definition, no run: `test.each(...)(...).step("a", f).after_reload_mods(g).step(h)` → parts in
   declaration order; step labels `a`, `step 2`; calling a step part's `func` directly receives
   the row args (API-2, API-3, step label)
6. `step(f)` and `step("c", f)` accepted; non-string caption, non-function, and `(table, f)`
   (Lua `:step` misuse) throw the API-4 message (API-4)
7. HL-2 function: headless + `step` → `step` false, warning returned; graphics → unchanged, no
   warning (HL-2)
8. Async scoping, step mode off. Body: `async()`, `on_tick` that logs, `after_ticks(3, done)`;
   then an uncaptioned step part with `async(1)` + `after_ticks(1, done)`. Assert: the body's
   `on_tick` logs on body ticks only, never after the step starts; the step part passes although
   the test has run longer than 1 tick (ASYNC-1, ASYNC-2, ASYNC-3)
9. Between parts, parameterized over `async` / `done` / `on_tick` / `after_ticks` × step mode
   {off, on (paused)}: the body captures a closure calling the function; calling it after the
   body completes, before the step part starts (between `tick()` calls), throws the ASYNC-5
   message (ASYNC-5)
10. `prepareReload` → `resumeAfterReload` round trip through the mock `RunStore`
    (`mockPersisted`) carries `stepping` (both values) (CTL-8)
    > Called directly: `beginReload` really reloads, so `ResumeData` is the reload seam meta tests
    > can reach.

### Reload (`reload.test.ts`)

- `test(...).step(...).after_reload_mods(...).step(...)`: parts run in declaration order, recorded
  in `storage` (module locals reset on reload). Covers resuming into a step part after reload.
  (API-2)

### CLI unit

- `main.test.ts` "reports %s as an error": `--step` without `--graphics`; config-file `test.step`
  without `--graphics` (HL-1, CFG-1)
  > Schema, flag, and file config for `step` come from the `testConfigFields` table; these two
  > cases prove the flag and file both reach `validateRunConfig`. No separate schema / mapping
  > tests.
- `run-plan.test.ts` `validateRunConfig`: accepts `step` with `graphics` (HL-1)
- `test-output.test.ts` `ProgressRenderer`: `Running: <path> > <step label>` after `stepStarted`;
  cleared when the test finishes (OUT-3)
- `transcript.test.ts` replay: verbose prints `Step: <path> > <step label>`; default and quiet do
  not (OUT-2)
  > Covers `formatEvent` and the stdout parser for `stepStarted`; no separate `formatEvent` test.

### Integration (`run-results.test.ts`, existing "Usage test mod runs correctly")

- usage fixture has a captioned and an uncaptioned `.step()` part, proving step parts run in real
  Factorio and `stepStarted` crosses the stdout protocol (API-1, OFF-1, OFF-2)
  > Update expected counts in `usage-test-mod/control.ts`, the summary line and `tests` length in
  > `run-results.test.ts`, then `npm run record-transcript` and update `summaryLine` / results
  > counts in `transcript.test.ts`.

## Manual testing

Only the adapters (Environment boundary) and button wiring; runner behavior is automated. Run:

```
npm run run-fixture -- usage-test-mod --step
```

| #   | Do                                                     | Expect                                                                                                                                                                                                    | Covers                                        |
| --- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 1   | Start; Step until the `.step()` part                   | Each pause: world frozen, game speed 1, pause icon, buttons enabled, status text `<path>` / `<path> > <caption>` (the upcoming item). While the part runs: same status text, icon blank, buttons disabled | `gameEnvironmentListener`, GUI; Step button   |
| 2   | While paused, `/c game.tick_paused = false`; then Step | World runs, the test does not advance, pause icon and buttons stay, game is not re-paused; Step resumes                                                                                                   | `load.ts` unpause glue                        |
| 3   | At a pause, Skip test; Run to end                      | `SKIP <path>` logged; counted skipped; progress bar full at the end                                                                                                                                       | Skip button, log + GUI on `testSkippedByUser` |
| 4   | At a pause, Run to end                                 | Step controls gone, no more pauses, speed back to `game_speed`                                                                                                                                            | Run to end button, speed restore              |
| 5   | Rerun tests; Cancel at the first pause                 | Run cancelled, step controls gone, game unpaused                                                                                                                                                          | Cancel while paused                           |
| 6   | Rerun; at a pause, save; load the save; Step           | Game unpauses, step controls gone; run ends in load error ("Save was unexpectedly reloaded")                                                                                                              | CTL-9 glue, `showRunEnded` hides controls     |

Confirm by reading:

- `createLogListener` has no case for step events (OUT-4), and logs `testSkippedByUser`
  regardless of `log_skipped_tests` (SKIP-4).
- `loadTests` (`load.ts`) applies the HL-2 function with `isHeadlessMode()` before
  `beginDefinition` (HL-2).
- `load.ts` still unpauses after each runner tick when not step-paused, so a test hook that pauses
  (e.g. entering the map editor) doesn't stall a run.
