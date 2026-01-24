# fmtk Credentials for Custom Data Directory

## Problem

When using a custom `--data-directory`, fmtk can't find credentials because it looks for `player-data.json` relative to the mods directory (`modsPath/../player-data.json`).

## How fmtk Handles Credentials

`ModManager` constructor accepts an optional `playerdataPath`:

```typescript
constructor(
    private readonly modsPath: string,
    private readonly playerdataPath?: string,
)
```

Credential resolution in `getDownloadCredentials`:
1. Use `playerdataPath` if provided, otherwise default to `modsPath/../player-data.json`
2. Read `service-username` and `service-token` from the JSON file
3. If token exists, use it directly
4. Otherwise, prompt for username/password and call `https://auth.factorio.com/api-login`

The CLI exposes this via `--playerData <path>` option on `fmtk mods install`.

## Standard player-data.json Locations

| Platform | Path |
|----------|------|
| Linux | `~/.factorio/player-data.json` |
| Windows | `%APPDATA%\Factorio\player-data.json` |
| macOS | `~/Library/Application Support/factorio/player-data.json` |

## Solution

Pass the real player-data.json path when calling fmtk:

```typescript
async function installFactorioTest(modsDir: string) {
    const realPlayerData = getFactorioPlayerDataPath()
    await runScript("fmtk mods install", "--modsPath", modsDir, "--playerData", realPlayerData, testModName)
}

function getFactorioPlayerDataPath(): string {
    if (os.platform() === "win32") {
        return path.join(process.env.APPDATA!, "Factorio", "player-data.json")
    } else if (os.platform() === "darwin") {
        return path.join(os.homedir(), "Library", "Application Support", "factorio", "player-data.json")
    }
    return path.join(os.homedir(), ".factorio", "player-data.json")
}
```
