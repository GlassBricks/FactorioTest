# CLI

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
3. `buildTestConfig()` extracts test runner options

## Notes

- For user-visible changes, update changelog (CHANGELOG.md), under "Unreleased".
