# Factorio test CLI

A CLI for running tests with Factorio Test from the command line.

Run `npx factorio-test --help` for usage information.

If using an npm package, you can install `factorio-test-cli` to your dev dependencies:

```bash
npm install --save-dev factorio-test-cli
```

## Configuration Architecture

### Config Categories

| Category | Casing | Location | Example Fields |
|----------|--------|----------|----------------|
| CLI-only | camelCase | `cli-config.ts` | `config`, `graphics`, `watch` |
| File+CLI | camelCase | `cli-config.ts` | `modPath`, `factorioPath`, `verbose`, `forbidOnly` |
| Test | snake_case | `types/config.d.ts` | `test_pattern`, `game_speed`, `bail` |

- **CLI-only**: Options only available via command line, not in config files
- **File+CLI**: Options that can be set in `factorio-test.json` or via command line (CLI overrides file)
- **Test**: Runner configuration passed to the Factorio mod; uses snake_case for Lua compatibility

### Type Hierarchy

```
types/config.d.ts
└── TestRunnerConfig        # CLI-passable fields (source of truth)
        │
        ├── Extended by: FactorioTest.Config (types/index.d.ts)
        │                 └── Adds mod-only fields: default_ticks_between_tests,
        │                     before_test_run, after_test_run, sound_effects
        │
        └── Validated by: testRunnerConfigSchema (cli/config/test-config.ts)
                          └── Zod schema for runtime validation
```

### Data Flow

```
CLI args ─────────────────┐
                          ▼
factorio-test.json ──► loadConfig() ──► mergeCliConfig() ──► RunOptions
                                              │
                                              ▼
                                        buildTestConfig() ──► TestRunnerConfig ──► Factorio mod
```

1. `loadConfig()` reads `factorio-test.json` (or `package.json["factorio-test"]`)
2. `mergeCliConfig()` merges file config with CLI options (CLI wins)
3. `buildTestConfig()` extracts test runner options, combining patterns with OR logic

### File Organization

```
types/
├── config.d.ts       # TestRunnerConfig interface (source of truth for CLI-passable test options)
└── index.d.ts        # FactorioTest.Config extends TestRunnerConfig with mod-only fields

cli/config/
├── index.ts          # Re-exports all public APIs
├── test-config.ts    # Zod schema validating TestRunnerConfig + CLI registration
├── cli-config.ts     # CliConfig + CliOnlyOptions schemas + CLI registration
└── loader.ts         # Config loading, path resolution, merging, RunOptions type
```
