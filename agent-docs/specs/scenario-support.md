# Scenario Support — Spec

The CLI and mod only test mods: the code under test is found by `script.mod_name`, enabled in
`mod-list.json`, and run in a bundled save. Scenario authors (e.g. Biter Battles, issue #1: CI for a
standalone "soft mod" scenario) can't use it. Support testing a scenario's own script, and starting
a mod's tests in a world created from a scenario.

## Background

Verified on Factorio 2.1.20 unless noted; 2.0 assumed the same.

- Scenario folder: `control.lua` (optional), `description.json`, `locale/`, optional
  `blueprint.zip` (map; otherwise generated), `image.png`. Locations: `<write-data>/scenarios/<name>`,
  `<mod>/scenarios/<name>`, `data/base/scenarios/<name>`.
- Referenced as `[MOD/]NAME`; without `MOD/`, from `<write-data>/scenarios/`.
- A scenario's `info.json` is never read: `dependencies`, `factorio_version`, even invalid JSON are
  ignored. Only `description.json` is parsed. A scenario never enables mods; a mod's scenario loads
  even if that mod is disabled (its `control.lua` doesn't run then).
- Level script: `script.mod_name == "level"`; `script.level` is `{level_name, mod_name?, ...}`.
  The level's main chunk and `on_init` run before mods'. Its own modules load by relative `require`
  (`require("lib")`); explicit `__level__/` paths fail. It can `require("__<mod>__/...")`, register
  remote interfaces, and read `settings`.
- A save embeds the level's Lua files; loading a save uses the embedded copy. In singleplayer,
  `game.reload_mods()` / `game.reload_script()` re-read the level script from its scenario on disk
  (not on a `--start-server-load-scenario` server).
- Launch flags:
  - `--scenario2map [MOD/]NAME`: writes `<write-data>/saves/[MOD/]NAME.zip` after running the
    level's and mods' `on_init`, then exits. The save works with `--benchmark` and `--load-game`.
  - `--load-scenario` (graphics only; untested), `--start-server-load-scenario` (server: needs
    server settings, runs until killed). No singleplayer headless scenario launch.
  - No runtime API to switch to another scenario.

## Goals

- **G-1** Test a scenario's own script, standalone or shipped in a mod, with the same test API and
  CLI workflow (headless, graphics, watch, CI) as mods.
- **G-2** Unambiguous options: each option picks either _what is tested_ or _the starting world_,
  and conflicting combinations are errors.
- **G-3** Run a mod's tests in a world created from a scenario.
  > This is an adjacent, but technically separate feature.
- **G-4** Works on Factorio 2.0 and 2.1.

### Non-goals

- **NG-1** Scenario under test plus `--save` (e.g. a mid-game save made from it).
- **NG-2** Map-gen options for scenario saves (pass `--factorio-args` at your own risk).
- **NG-3** A reusable GitHub Action.
- **NG-4** Testing a scenario without editing its `control.lua` (e.g. a CLI-generated wrapper
  scenario).

### Scenarios

- **US-1** (G-1) As a standalone scenario author, I can test the scenario code the same way as mods.
- **US-2** (G-1) As a mod author shipping a scenario, I can test that scenario's code, independently from the mod.
- **US-3** (G-1) In watch mode, edits to my scenario rerun the tests.
- **US-4** (G-1) As a scenario author, I can run my scenario's tests with CI.
- **US-5** (G-3) As a mod author, I can run my _mod_'s tests in a specific scenario, from my mod, another mod, or the base-game's.
- **US-6** (G-2) When I combine options that don't make sense together, I'm told which ones
  conflict.

## Functional Spec

### Definitions

- **Target**: what is tested: a mod (MUT, as in [mod-management](mod-management.md)) or a
  scenario (SUT).
- **World**: the game state tests start in.
- **Scenario ref**: `[MOD/]NAME`, as Factorio takes it.

### Target options

- **TGT-1** Exactly one "target to test" can be specified:

  | Option                  | Target                                               |
  | ----------------------- | ---------------------------------------------------- |
  | `--mod-path <dir>`      | mod, linked into the mods dir (existing)             |
  | `--mod-name <name>`     | mod, already in the mods dir (existing)              |
  | `--scenario-path <dir>` | scenario, linked as `<data-dir>/scenarios/<dirname>` |
  | `--scenario <ref>`      | scenario, by ref                                     |

  Config keys: `scenarioPath` (path, resolved relative to the config file), `scenario`.

- **TGT-2** Exception: `--mod-path` with `--scenario <MOD>/<NAME>`, where `--mod-path`'s
  `info.json` name is `MOD`. The target is the scenario; the mod is only provided (enabled, symlinked, and its
  dependencies resolved as for a MUT).
  - Name mismatch, if both specified:
    `Error: --scenario my-mod/s1 is from mod "my-mod", but --mod-path is mod "other-mod".`
- **TGT-3** Any other combination is an error, e.g. `--mod-name` with `--scenario`,
  `--scenario-path` with `--mod-path`, `--scenario` with `--scenario-path`.
  `Error: Specify one of --mod-path, --mod-name, --scenario-path or --scenario (exception: --mod-path with --scenario <that mod>/<name>).`
  None given: `Error: One of --mod-path, --mod-name, --scenario-path or --scenario must be specified.`
- **TGT-4** `--scenario <MOD>/<NAME>` without a matching `--mod-path` requires `MOD` in the enabled
  set (e.g. via `--mods`):
  `Error: --scenario my-mod/s1 needs mod "my-mod". Add --mod-path, or list it in --mods.`
  > Factorio would load the scenario with its mod disabled (Background), failing later on
  > `require("__my-mod__/...")`.
- **TGT-5** `--scenario-path`: the link name is the folder's name. As for mods, an existing
  non-symlink at that path is an error, and the link is replaced if it points elsewhere.
- **TGT-6** A scenario `--scenario <NAME>` (no mod) that doesn't exist in `<data-dir>/scenarios/` is
  an error before launch. `--scenario <MOD>/<NAME>`'s existence is left to Factorio.

### World options

- **WORLD-1** With a mod target, at most one of:
  - (default) the bundled lab save
  - `--save <path>` (existing)
  - `--start-scenario <ref>` (new; config `startScenario`): a new game from that scenario.
    A `MOD/` prefix requires `MOD` in the enabled set (as TGT-4).
- **WORLD-2** With a scenario target, the world is a new game from that scenario. `--save` or
  `--start-scenario` is an error:
  `Error: --save can't be used when testing a scenario: tests start in a new game from the scenario.`
- **WORLD-3** Help texts state the distinction:
  - `--scenario`: "Scenario to test, as [mod/]name. Tests run in a new game from it."
  - `--start-scenario`: "May be used when testing a mod, not a scenario. Starts a new game from
    this scenario ([mod/]name) instead of the default save. To test a scenario, not a mod, use --scenario."

### Launching

- **LAUNCH-1** A scenario world (WORLD-1 `--start-scenario`, WORLD-2) is created on every launch
  with `--scenario2map <ref>`, then loaded as a save (headless `--benchmark`, graphics
  `--load-game`). Headless watch relaunches redo both.
- **LAUNCH-2** `--scenario2map` failing (non-zero exit) fails the run before tests, printing its
  output:
  `Error: Creating a game from scenario "biter_battles" failed (exit code 1):` + output.

### Watch

- **WATCH-1** At most one path is watched:

  | Target options                         | Watched                                       |
  | -------------------------------------- | --------------------------------------------- |
  | `--mod-path` (incl. with `--scenario`) | the `--mod-path` dir                          |
  | `--mod-name`                           | unchanged (mods dir entry, dir or zip)        |
  | `--scenario-path`                      | that dir                                      |
  | `--scenario <NAME>`                    | `<data-dir>/scenarios/<NAME>`, if a directory |
  | `--scenario <MOD>/<NAME>` via `--mods` | `<data-dir>/mods/<MOD>`, if a directory       |

  Otherwise `--watch` is an error.

### Mod / test API

- **API-1** A scenario registers tests the same way as a mod, at the end of its `control.lua`:

  ```lua
  if script.active_mods["factorio-test"] then
    require("__factorio-test__/init")({ "tests.my-test" }, { --[[ config ]] })
  end
  ```

  Test files are required relative to the scenario folder.

  > Must run before any `require` replacement; not called out in user docs.

- **API-2** The in-game mod selection GUI lists a registered scenario as
  `Scenario: <script.level.level_name>`.

### Mods

- **MODS-1** With a scenario target, the enabled set is resolved from `--mods`, plus the TGT-2 mod
  and its dependencies, as in [mod-management](mod-management.md).
- **MODS-2** `mods install` / `mods update`: `--mod-path` / `--mod-name` are optional
  (mod-management CMD-1). The scenario options (`--scenario-path`, `--scenario`, `--start-scenario`)
  are run-only.

### CLI help

- **HELP-1** `run --help`: the four target options are listed together, first, each description
  starting with `[one required]`. `--mod-path` adds "Also provides the mod for
  --scenario <mod>/<name>." `--start-scenario` is listed next to `--save`.
- **HELP-2** `run --help` examples gain:

  ```
  factorio-test run --scenario-path ./my-scenario              Test a scenario
  factorio-test run -p ./my-mod --start-scenario base/freeplay Run mod tests in a new freeplay game
  ```

- **HELP-3** `mods install` / `mods update --help`: `--mod-path` / `--mod-name` without
  `[one required]`.
  > Descriptions are shared via `optionDefs` (`cli/config/options.ts`), so this needs a
  > per-command description. Commander 12 has no option help groups.

### Docs

- **DOC-1** `docs/Running-Tests.md`: "Registering Tests" notes the `control.lua` snippet also works in both
  a mod or scenario. In `Running from the CLI`, example is noted for testing a mod; brief pointer for if testing a scenario -> see CLI docs. `Running In-Game` says "mod or scenario" instead of just "mod".
- **DOC-2** `docs/CLI-Reference.md`: new options, grouped together; noted that one of the 4 options should be specified as what's being tested. `docs/CI.md`: one line, for a scenario use `--scenario-path` instead of `--mod-path`.

## Verification

### Automated testing

CLI unit (vitest):

- Option combinations (TGT-1..4, WORLD-1..2, WATCH-1 errors): `run-plan.test.ts` tables.
- Help text (HELP-1, HELP-3): `main.test.ts`, the target options' order and prefixes.
- Config keys (`scenarioPath` path resolution, `startScenario`): `config.test.ts` tables.
- Launch args (LAUNCH-1): extracted pure builder, table-tested per target × world × mode.
- Linking (TGT-5): shared mod/scenario link helper, incl. existing non-symlink error.
- `mods install` with no MUT (MODS-2, mod-management CMD-1).

Integration (real headless Factorio; plain-Lua fixtures):

- Standalone scenario fixture, `--scenario-path`: passing and failing tests, `test-results.json`.
- Mod-shipped scenario fixture, `--mod-path` + `--scenario <mod>/<name>`.
- `usage-test-mod` with `--start-scenario base/freeplay`: asserts the world (e.g.
  `script.level.level_name == "freeplay"`).
- Scenario whose `on_init` errors: LAUNCH-2.
- Headless watch on a scenario fixture: a file change reruns.
- `runCli` no longer always adds `--mod-path`.

No new in-game unit tests: DES-5/DES-6 (level id, auto-start) are covered end to end. CI: 2.1 on `main`; 2.0 via
`backport-2.0`'s CI (fixtures' `factorio_version` adjusted there).

### Manual testing

Agent:

- Spike first (load-bearing): `--scenario2map` a scenario fixture, then `--benchmark` it with
  factorio-test enabled; the level's tests auto-start and finish (DES-2).
- Graphics: GUI lists the scenario (API-2); watch rerun (`reload_mods()`) picks up a scenario edit.

User:

- Biter Battles on 2.0 with a trivial test, headless.

## Design

- **DES-1** Run plan: replace `validateModSource` with a resolved target/world:

  ```ts
  type TestTarget =
    | { kind: "mod"; modPath?: string; modName?: string }
    | { kind: "scenario"; ref: string; scenarioPath?: string; providingModPath?: string }
  type World = { kind: "bundled" } | { kind: "save"; path: string } | { kind: "scenario"; ref: string }
  resolveRunPlan(config): { target: TestTarget; world: World } // throws TGT/WORLD errors
  ```

  The id passed to the mod (auto-start config, mod-to-test) is the mod name, or `"level"`.

- **DES-2** `--scenario2map` runs with factorio-test **disabled** in `mod-list.json` (rest of the
  enabled set as is), then factorio-test is enabled for the test launch.
  > The generated save then contains the level/MUT state without factorio-test, like a `--save` of
  > the MUT today: the level's guarded `init` is skipped in the scenario2map process, and runs on
  > load of the save; auto-start arms via `on_load`. Avoids auto-start, test-file loading and the
  > bundle's state setup happening inside the scenario2map process.
  > Alternative: keep it enabled with auto-start settings cleared; rejected as more state to get
  > right.
- **DES-3** Launch args: one pure function returning the process invocations
  (`[scenario2map args?, test launch args]`) from plan, mode, paths; `factorio-process.ts` runs them.
- **DES-4** Watch target: generalize `resolveModWatchTarget` (`cli/factorio-setup.ts`) to the
  plan (WATCH-1).
- **DES-5** Mod side: `auto-start.ts` special-cases `"level"` (DES-6): it checks the level's
  registration instead of `script.active_mods`; `mod-select-gui.ts` adds the level entry when
  `remote.interfaces["factorio-test-tests-available-for-level"]` exists (API-2).
  `init.ts` / bundle need no change if `script.mod_name` comparisons hold (to verify).

- **DES-6** A scenario target is identified as `"level"` (its `script.mod_name`) wherever a mod name
  is used: auto-start config, `factorio-test-mod-to-test`, remote interface
  `factorio-test-tests-available-for-level`.

## Implementation Plan

1. Spike DES-2 by hand (Manual testing, first item).
2. CLI: run plan (DES-1), scenario link, `--scenario2map` launch (DES-2, DES-3), mod side (DES-5, DES-6);
   standalone fixture integration test.
3. Mod-shipped scenario (TGT-2, TGT-4), `--start-scenario` (WORLD-1).
4. Watch (WATCH-1), GUI (API-2).
5. `mods install` without MUT (MODS-2).
6. Help (HELP-1..3), docs (DOC-1, DOC-2), changelog.
7. Backport to `backport-2.0`.

## Notes

Deferred: NG-1 (scenario target + save, via `reload_script()` after load: unverified), NG-2.
