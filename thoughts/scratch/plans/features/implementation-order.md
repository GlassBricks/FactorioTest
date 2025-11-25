# Feature Implementation Order

## Dependency Graph

```
config-file ───────┬─→ test-filtering ──────┐
                   └─→ focused-tests-behavior│
                                             │
per-test-log-capture ─→ cli-progress-bar     │
                                             │
                       test-results-file ←───┘
                       (rerun failed tests)

Independent (no dependencies):
  automatic-mod-downloading
  each-test-name-formatting
  early-test-cancellation
  in-game-gui-improvements
  remove-luassert-bundling (breaking)
```

## Parallel Tracks

| Phase | Track 1: CLI Infra     | Track 2: CLI Output  | Track 3: Independent                               |
| ----- | ---------------------- | -------------------- | -------------------------------------------------- |
| 1     | config-file            | per-test-log-capture | automatic-mod-downloading                          |
| 2     | test-filtering         | cli-progress-bar     | each-test-name-formatting, early-test-cancellation |
| 3     | focused-tests-behavior | test-results-file    | in-game-gui-improvements                           |
| 4     | —                      | —                    | remove-luassert-bundling                           |

## Notes

- **config-file** first: enables cleaner CLI option integration for later features
- **per-test-log-capture** before **cli-progress-bar**: avoids reworking output parsing
- **test-results-file** last in Track 2: "rerun failed" benefits from test-filtering
- Track 3 items can be worked on whenever bandwidth allows
- **remove-luassert-bundling**: breaking change, defer to major version (v3.0)
