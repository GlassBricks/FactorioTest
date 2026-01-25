# Headless Save Generation Command

CLI command to regenerate `cli/headless-save.zip`.

## Why Needed

The headless save requires a player entity. Factorio's `--create` flag generates saves without players. A scenario must be loaded (which creates a player on join), then saved.

## Approach

1. Create temp scenario with `control.lua` that auto-saves on first tick
2. Run Factorio with `--load-scenario`
3. Wait for `FACTORIO-TEST-SAVE-COMPLETE` signal
4. Copy save from data directory to `cli/headless-save.zip`
5. Clean up temp scenario

## Temp Scenario control.lua

```lua
script.on_nth_tick(1, function()
  game.auto_save("headless-save")
  print("FACTORIO-TEST-SAVE-COMPLETE")
end)
```

## Notes

- Requires graphics (scenario load creates player on join)
- Uses isolated data directory (no Factorio account credentials in save)
- Command: `npx factorio-test generate-headless-save`
