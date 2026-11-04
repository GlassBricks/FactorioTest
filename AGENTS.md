## Project Overview

This is a testing framework for Factorio mods. Monorepo, containing:

- **cli** - Test runner, TypeScript/Node, published as npm `factorio-test-cli`
- **mod** - Factorio mod. Provides a minimal GUI to interface with the mod under test. Uses TypescriptToLua.
- **mod/factorio-test/** - The provided test API. Bundled, imported by the mod-under-test (not the factorio-test mod itself).
- **mod/factorio-test/shared/** - Modules imported by _both_ the bundle and the mod-under-test.
- **types** - Common TypeScript definitions (for TypescriptToLua), published as npm `factorio-test`
- **integration-tests/** - E2E tests

## Commands

See package.json files.

## TypeScriptToLua

Compiles Typescript code to Lua, for Factorio runtime. Only used in `mod/`.

- The `typed-factorio` package provides types corresponding to the Factorio lua API.
- Multiple tsconfigs: `mod/tsconfig.json` (mod runtime), `mod/factorio-test/tsconfig.json` (bundled library)
- Generated `.lua` is gitignored, except `.def.lua` (checked in for type sharing)

## CLI and Mod Communication

From Factorio to CLI: CLI spawns Factorio, and parses messages from the mod from stdout (lua `print` calls). Messages are marked with `FACTORIO-TEST-*:`.

From CLI to mod: one payload (`types/config.d.ts`), delivered either via a mod setting `FACTORIO_TEST:<json>` in graphics mode, or `--test-arg` in factorio CLI read as `script.test_arg` in headless mode.

## Notes

- You can run factorio tests, since they are run in headless mode
- For vitest, use parameterized tests where applicable
- Integration/e2e tests launch Factorio and are expensive, reserve them for when real Factorio is needed.
