# Running Tests in GitHub Actions

The [CLI](CLI-Reference.md) can run tests in CI with the Factorio headless server, which can be downloaded without login.

## Example Workflow

Add `.github/workflows/test.yml` to your mod repository:

```yaml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 22

      - name: Resolve Factorio version
        id: factorio
        run: echo "version=$(curl -fsSL https://factorio.com/api/latest-releases | jq -r .stable.headless)" >> "$GITHUB_OUTPUT"
      - uses: actions/cache@v6
        id: factorio-cache
        with:
          path: ~/factorio
          key: factorio-headless-${{ steps.factorio.outputs.version }}
      - name: Download Factorio headless
        if: steps.factorio-cache.outputs.cache-hit != 'true'
        run: curl -fsSL "https://factorio.com/get-download/${{ steps.factorio.outputs.version }}/headless/linux64" | tar -xJ -C ~
      - run: echo ~/factorio/bin/x64 >> "$GITHUB_PATH"

      - name: Set mod portal credentials
        env:
          FACTORIO_USERNAME: ${{ secrets.FACTORIO_USERNAME }}
          FACTORIO_TOKEN: ${{ secrets.FACTORIO_TOKEN }}
        run: |
          mkdir -p ~/.factorio
          jq -n --arg u "$FACTORIO_USERNAME" --arg t "$FACTORIO_TOKEN" \
            '{"service-username": $u, "service-token": $t}' > ~/.factorio/player-data.json

      - name: Run tests
        run: |
          npm install --no-save factorio-test-cli
          npx factorio-test run --mod-path . --data-directory "$RUNNER_TEMP/factorio-test-data"
```

Adjust `--mod-path` if your mod is not at the repository root.
If your repository already has `factorio-test-cli` as a dev dependency, replace the `npm install` line with `npm ci`.

## Factorio Version

The example uses the latest stable release.
Use `.experimental.headless` instead if your mod's `factorio_version` targets an experimental release, or replace the "Resolve Factorio version" step with a fixed version (e.g. `2.0.77`) to pin it.

The headless server includes the Space Age DLC mods, so `--mods space-age` works.

## Mod Portal Credentials

The CLI downloads the `factorio-test` mod, and your mod's dependencies, from the mod portal.
Mod portal downloads require a Factorio account username and token.

1. Find `service-username` and `service-token` in `player-data.json`, in your Factorio [user data directory](https://wiki.factorio.com/Application_directory#User_data_directory).
2. Add them as [repository secrets](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions) named `FACTORIO_USERNAME` and `FACTORIO_TOKEN`.

Mod portal API keys (from your factorio.com profile) do not work for downloads.

Secrets are not available to workflows triggered by pull requests from forks, so mod downloads fail there.
