# Running Tests in CI

The [CLI](CLI-Reference.md) can run tests in CI with the Factorio headless server, which can be downloaded without login.

## Quick Start: GitHub Actions

1. Add your Factorio username and token as [repository secrets](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions) named `FACTORIO_USERNAME` and `FACTORIO_TOKEN` (see [Mod Portal Credentials](#mod-portal-credentials)).
2. Run the tests locally once, and commit `factorio-test.lock.json`, if created (see [Lock File](#lock-file)).
3. Add `.github/workflows/test.yml`:

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

      - run: npm install --no-save factorio-test-cli

      - uses: actions/cache@v6
        with:
          path: factorio-test-data-dir/mods/*.zip
          key: factorio-mods-${{ hashFiles('factorio-test.lock.json') }}
      - name: Install mods
        run: npx factorio-test mods install --mod-path .
        env:
          FACTORIO_USERNAME: ${{ secrets.FACTORIO_USERNAME }}
          FACTORIO_TOKEN: ${{ secrets.FACTORIO_TOKEN }}

      - name: Run tests
        run: npx factorio-test run --mod-path .
```

Common adjustments:

- Mod not at the repository root: change `--mod-path`. With a [config file](CLI-Reference.md#config-file), the options can go there instead.
- `factorio-test-cli` already a dev dependency: replace the `npm install` line with `npm ci`.
- Mod targets an experimental Factorio release, or you want to pin a version: use `.experimental.headless`. To pin a version, replace the "Resolve Factorio version" step with a fixed version (e.g. `2.0.77`).

The rest of this page explains each part, for adapting the workflow or using another CI system.

## How It Works

The job runs two CLI commands:

```sh
# Downloads the locked mods; the only step that needs credentials
FACTORIO_USERNAME=... FACTORIO_TOKEN=... npx factorio-test mods install --mod-path .
# Runs the tests with the installed mods
npx factorio-test run --mod-path .
```

### Factorio Headless Server

The latest version number is available from `https://factorio.com/api/latest-releases` (`.stable.headless` or `.experimental.headless`). Download it from `https://factorio.com/get-download/<version>/headless/linux64`, extract it, and put `factorio/bin/x64` on `PATH` (or pass `--factorio-path`).

The headless server includes the Space Age DLC mods, so `"mods": ["space-age"]` works.

### Mod Portal Credentials

Downloading mods from the mod portal requires a Factorio account username and token, given as the `FACTORIO_USERNAME` and `FACTORIO_TOKEN` environment variables.

Find your token on https://factorio.com/profile, or as `service-username` and `service-token` in `player-data.json`, in your Factorio [user data directory](https://wiki.factorio.com/Application_directory#User_data_directory).

Mod portal API keys (from your factorio.com profile) do not work for downloads.

### Lock File

In CI (when the `CI` environment variable is set, as on most CI systems), the CLI uses exactly the mod versions in `factorio-test.lock.json`, and fails if it is missing or out of date. Run the tests (or `npx factorio-test mods install`) locally, then commit the lock file. Pass `--frozen-lockfile` or `--no-frozen-lockfile` to override.

The lock file records only your mod's dependencies (and mods from `mods` config), not the mod under test, builtin/DLC mods, or `factorio-test` (whose version is set by the CLI version). If there is nothing to lock, no lock file is created, and CI passes without one.

After changing `mods` in the config, or your mod's dependencies, run `install` again and commit the updated lock file. To move to newer mod versions, run `npx factorio-test mods update`.

### Caching

It's suggested to cache the Factorio install keyed on its version, and the downloaded mods (`<data directory>/mods/*.zip`, by default `factorio-test-data-dir/mods/*.zip`) keyed on the lock file.

When the cache has all expected mods, `mods install` downloads nothing and needs no credentials.

### Pull Requests From Forks

Secrets are not available to GitHub Actions workflows triggered by pull requests from forks.
If you cache the mods in GitHub Actions, forks can still restore the cache saved by your branch as long as they don't change the lockfile.
Otherwise, the "Install mods" step may fail.
