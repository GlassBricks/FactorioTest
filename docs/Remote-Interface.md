# Remote Interface

If a mod is registered with Factorio Test _and_ is selected to run, the `"factorio-test"` remote interface is available. Use it to control test runs from your own scripts.

Example:

```lua
if remote.interfaces["factorio-test"] then
    local mod_under_test = remote.call("factorio-test", "modName")
end
```

## Functions

The following functions are available. Other functions are considered internal and may change without notice.

### `modName()`

Returns the name of the mod being tested.

### `runTests()`

Starts running tests if not already running.

### `cancelTestRun()`

Cancels the current test run.

### `isRunning()`

Returns `true` if tests are currently running, `false` otherwise.

### `getResults()`

Returns a table with the following fields:

- `ran: number` - how many tests have run so far
- `passed: number` - how many tests passed
- `failed: number` - how many tests failed
- `skipped: number` - how many tests were skipped
- `todo: number` - how many todo tests were encountered
- `describeBlockErrors: number` - how many describe block errors occurred
- `status: string?` - one of the following values:
    - `nil` if tests have not yet finished running
    - `"passed"` if all tests passed and there are no todo tests
    - `"failed"` if any tests failed or any describe block had errors
    - `"todo"` if all tests passed but there are todo tests
    - `"cancelled"` if the run was cancelled

### `getConfig()`

Returns the current test configuration table.
