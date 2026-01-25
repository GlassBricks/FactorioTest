# CLAUDE.md

## Project Overview

Testing framework for Factorio mods. Monorepo:
- **cli** - Test runner (plain TypeScript/Node, published as `factorio-test-cli`)
- **mod** - Factorio mod with test GUI (TypeScriptToLua)
- **mod/factorio-test/** - Framework bundle injected into mod-under-test (not the factorio-test mod itself)
- **types** - TypeScript definitions (`factorio-test` npm)
- **integration-tests** - E2E tests

## Commands

npm run build --workspace=cli|mod
npm run test --workspace=cli|mod
npm run test:integration  # configured at root, not a workspace
npm run lint --workspace=cli|mod
npm run lint  # lint integration-tests (at root)
npm run prettier:fix  # run lint and prettier fix after .ts/.json changes

## Architecture Notes

### TypeScriptToLua
- Only used in mod/
- Compiles code to Lua for Factorio runtime
- Multiple tsconfigs: `mod/tsconfig.json` (mod runtime for GUI), `mod/factorio-test/tsconfig.json` (bundled framework)
- Generated `.lua` gitignored except `.def.lua` (checked in for type sharing)

### CLI ↔ Mod Communication
- CLI spawns Factorio, parses `FACTORIO-TEST-RESULT:` messages from stdout
- Uses `fmtk` for settings and mod dependency management

### Test Runner Internals
- `runner.ts` uses state machine with task queue for async/tick/reload handling
- Reload tests save state to Factorio's `global`, resume after reload
- Shared constants in `mod/constants.d.ts`

## Notes
- You can run factorio tests, they are run in headless mode
- Run format, lint, and tests after .ts file changes
- If applicable include plan files in commits
- For vitest, use parameterized tests where applicable
- Add integration tests for new CLI features when applicable
