# Code issues found while proofreading docs

## 1. Multiple positional filters never match

`cli/config/test-config.ts:128`:

```ts
result.test_pattern = patterns.map((p) => `(${p})`).join("|")
```

Matched in `mod/factorio-test/tests.ts:220` via `string.match(test.path, test_pattern)`. Lua patterns have no
alternation; `|` is a literal, so `factorio-test run -p mod foo bar` → `(foo)|(bar)` matches only paths containing
literal `foo|bar`. `--help` advertises "OR logic".

Also: positional filters silently replace `--test-pattern` (`cli/schema.test.ts:86`).

`cli/schema.test.ts:82` and `cli/config.test.ts:137` assert the broken output.

Fix direction: pass filters as a list (e.g. `test_patterns: string[]`) and match any in the mod.

## 2. `factorio-test.def.lua` is stale

- `TestBuilder.after_script_reload` / `after_mod_reload` → actual: `after_reload_script` / `after_reload_mods`
  (`mod/factorio-test/setup-globals.ts`, `types/index.d.ts`)
- `FactorioTestConfig` missing `load_luassert`, `reorder_failed_first`, `bail`

## 3. `cancelled` result count never incremented

`TestRunSummary.cancelled` (`types/events.d.ts:22`) is initialized to 0 in `createRunReport()`
(`mod/factorio-test/results.ts`), but `resultCollector` never increments it; `testRunCancelled` only sets `status`.
Either count cancelled tests or drop the field.

## 4. `outputFile` in config file not resolved relative to config file

`resolveConfigPaths()` (`cli/config/loader.ts:72`) resolves `modPath`, `factorioPath`, `dataDirectory`, `save`
relative to the config file's directory, but not `outputFile`, which resolves against cwd.

## 5. Root `Readme.md` example requires luassert

Example uses `assert.is_true(...)`, which only exists with `load_luassert = true` (opt-in, default `false`).
