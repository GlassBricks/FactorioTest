## Project Overview

This is a testing framework for Factorio mods. Monorepo, containing:

- **cli** - Test runner (plain TypeScript/Node, published as `factorio-test-cli`)
- **mod** - Factorio mod, with in-game test GUI (using TypeScriptToLua). Provides a minimal GUI to interface with the mod under test.
- **mod/factorio-test/** - The lua mod API. The bundle is injected into the mod-under-test (not the factorio-test mod itself)
- **mod/factorio-test/shared/** - Modules imported by _both_ the bundle and the outer mod.
- **types** - Common TypeScript definitions (`factorio-test` npm)
- **integration-tests** - E2E tests

## Commands

```
npm run build --workspace=cli|mod
npm run test --workspace=cli|mod
npm run test:integration # configured at root, not a workspace
npm run lint --workspace=cli|mod
npm run lint # lint integration-tests (at root)
npm run prettier:fix # run lint and prettier fix after .ts/.json changes
```

## Architecture Notes

### TypeScriptToLua

Compiles Typescript code to Lua, for Factorio runtime. Only used in `mod/`.

- The `typed-factorio` package provides types corresponding to the Factorio lua API.
- Multiple tsconfigs: `mod/tsconfig.json` (mod runtime for GUI), `mod/factorio-test/tsconfig.json` (bundled framework)
- Generated `.lua` is gitignored, except `.def.lua` (checked in for type sharing)

### CLI ↔ Mod Communication

The CLI spawns Factorio, and parses messages from the mod from stdout (lua `print` calls), messages are marked with `FACTORIO-TEST-*:`.

CLI → mod: one payload, `FACTORIO_TEST:<json>` (`TestRunPayload` in `types/config.d.ts`: mod, test config, last failed tests).

- Headless: Factorio's test mode, `--test-save`/`--test-scenario` + `--test-arg <payload>`. The mod reads `script.test_arg` and ends the run with `script.finish_test(passed)`.
- Graphics: no test mode, so the payload goes in the `factorio-test-auto-start-config` startup setting. Ignored when `script.test_arg` is set.

Uses the `fmtk` bin (from npm package `factoriomod-debug`) for mod settings management (`mod-settings.dat`).

## Notes

- You can run factorio tests, since they are run in headless mode
- For vitest, use parameterized tests where applicable
- Integration/e2e tests launch Factorio and are expensive, reserve them for when real Factorio is needed.

## Factorio versions

- Factorio 2.1.24+ only (needs Factorio's test mode), factorio-test mod 3.2.x. The CLI pins the mod version (`FACTORIO_TEST_VERSION`) and rejects older Factorio (`checkFactorioVersionSupported()`).
- `backport-2.0` is no longer maintained.
- CLI unit tests cover both versions with fakes; integration tests run on the branch's Factorio version only.
