# GUI Improvements v1

## Phase 1: Initial Improvements

Simple changes that work with existing infrastructure.

### Simplify Test Count Display

Replace the 5-column table with a single summary line.

Current: Table with separate cells for failed/errors/skipped/todo/passed counts.

New: Single label like `5 passed, 2 failed, 1 skipped` showing only non-zero categories.

Files: `mod/factorio-test/test-gui.ts`

### Enable Close Button During Tests

Currently the close button is disabled during test runs (users must use Cancel).

Change: Enable close button always. Closing during a run should cancel and close.

Files: `mod/factorio-test/test-gui.ts`, `mod/control/test-gui.ts`

## Phase 2: Future Improvements

Require additional infrastructure or design decisions.

### Collapsible Output Groups

Group output messages by describe block with expand/collapse.

Requires:
- Track which describe block each message belongs to
- Hierarchical UI components (Factorio GUI limitations may apply)
- State management for expand/collapse

### Search/Filter Output

Filter output messages by text search.

Requires:
- Store all messages in a searchable structure
- Re-render output based on filter
- Performance considerations for large test runs

### Re-run Failed Tests Only

Add a button to re-run only tests that failed.

Requires:
- Track failed test paths persistently
- Test runner support for path-based filtering
- Consider: how does this interact with `beforeAll`/`afterAll` hooks?

### Show Focused/Only Tests Warning

Display a warning when tests are filtered by `.only` or focused.

Requires:
- Expose focused test state from runner
- Decide on UI placement and styling

### Interactive Test Filter

Select which tests to run from the GUI.

Requires:
- Test discovery before running
- Hierarchical test tree display
- Selection state management
- Integration with runner filtering
