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

Uses `fmtk` (from npm package `factorio-debugadapter`) for settings and mod dependency management, outside of launching factorio.

## Notes

- You can run factorio tests, since they are run in headless mode
- For vitest, use parameterized tests where applicable
- Integration tests launch Factorio and are expensive: reserve them for real seams (CLI → mod settings, mod →
  stdout protocol, process lifecycle). Test CLI logic with vitest at its boundary instead: pure planning in
  `cli/run-plan.ts`, process supervision via `superviseHeadlessRun()` with a fake process, output via the recorded
  transcript in `cli/test-fixtures/` (regenerate with `npm run record-transcript`), entry point via `main(argv)`.
