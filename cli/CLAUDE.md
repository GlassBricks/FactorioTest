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

## Notes

- For user-visible changes, update changelog (CHANGELOG.md), under "Unreleased".
