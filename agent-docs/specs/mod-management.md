# Mod Management — Spec

Today, mod management in the CLI is limited and quirky: only direct dependencies are installed,
always at their newest version, and the set of enabled mods is hard to control. Runs are not easily
reproducible across collaborators or CI. Improve it, primarily to enable running tests in CI.

## Background

- Mod portal: `GET https://mods.factorio.com/api/mods/<name>/full` (no auth) lists all releases
  (oldest first), each with `version`, `download_url`, `sha1`, `info_json.factorio_version`,
  `info_json.dependencies`.
- Downloads: `https://mods.factorio.com<download_url>?username=..&token=..`, with Factorio account
  `service-username` / `service-token` (`player-data.json`). Without credentials, the portal
  returns `302` to `/login`; with invalid ones, `403` (verified). Valid ones get a `302` to a file
  host. Mod portal API keys don't work.
- Dependency syntax (`info.json`): `[prefix] name [op version]`; prefixes none (required), `~`
  (required, no load order), `+` (recommended, since 2.1.7), `?`, `(?)` (optional), `!`
  (incompatible); ops `< <= = >= >`.
- Factorio loads a mod only if its `factorio_version` equals the game's major.minor, and refuses to
  start on unsatisfied dependencies. It never downloads or enables dependencies itself.
- `mod-list.json`: Factorio enables installed mods missing from it, and loads the highest installed
  version unless an entry has `version`. A pinned `version` that isn't installed **silently falls
  back** to the highest installed version (verified, 2.1.20). On exit, Factorio rewrites
  `mod-list.json`, dropping a pinned `version` if it equals the highest installed version.
- `factorio --version` prints `Version: 2.1.20 (build …)` first; wrappers may add stderr noise.
- `fmtk` (`factoriomod-debug`): `mods adjust name=x.y.z` pins versions in `mod-list.json`.
  `mods install` always installs the latest release (no version choice, no `factorio_version`
  filter, no sha1 check), and prompts for a password without a token.

## Goals

In priority order; the order settles tradeoffs between them.

- **G-1 Reproducible**: same mod versions across runs, machines, collaborators and CI; versions
  change only by deliberate update.
- **G-2 Works out of the box**: for most users, the first run works with no setup: dependencies
  (incl. transitive) are installed, credentials are found automatically.
- **G-3 Simple CI**: running tests in CI takes a few documented steps.
- **G-4 Easy to configure**: common adjustments (add mods, constrain versions, leave out a
  recommended dependency) are a one-line config change.
- **G-5 Full manual control possible**: users can provide any mod themselves (own builds, mods not
  on the portal, custom CI steps), and the CLI uses it as-is.
- **G-6 Offline after first run**: network only when something must be downloaded.
- **G-7 Early, actionable errors**: common dependency problems (missing, conflicting, wrong game
  version) are reported before launch, naming which mod requires what. Anything else falls back to
  Factorio's own load error.

### Non-goals

- **NG-1** Complete dependency resolution (backtracking/SAT). Resolution should work for the
  common case (most dependency trees are shallow) and be simple to implement and verify; users
  steer edge cases with explicit constraints.
- **NG-2** Factorio 2.0 / multiple game versions. Deferred.
- **NG-3** Installing Factorio locally. (Locating it is existing behavior; installing it in CI is a
  separate spec.)
- **NG-4** Interactive credential prompts, `.env` loading.
- **NG-5** Cleaning up old mod versions from the mods dir. The CLI never deletes them (like the
  game itself).
- **NG-6** First-class config matrix (several mod sets per project). Approximated with multiple
  config files.
- **NG-7** General-purpose mod manager for players.
- **NG-8** Re-resolving mods in watch mode.

### Scenarios

The user is a mod author running their mod's tests with the CLI.

Local:

- **US-1** (G-2) When I run my mod's tests for the first time, with no config, I want its
  dependencies (incl. transitive) and `factorio-test` installed, using the credentials from my game
  login.
- **US-2** (G-1) When I rerun later, on another machine, or a collaborator runs the tests, I want the
  same mod versions, even if newer ones were released.
- **US-3** (G-6) When I'm offline and have run the tests before, I want them to still run.
- **US-4** (G-4) When testing compatibility with other mods (incl. DLC), I want to add them,
  optionally at an exact version or range.
- **US-5** (G-4) When a dependency recommends (`+`) a mod I don't want, I want to leave it disabled.
- **US-6** (G-5) When I need a mod or version the portal doesn't have, or want full control, I want to
  provide it myself (local dir, committed to the repo, custom CI step) and have the CLI use it as-is.
- **US-7** (G-1) When dependencies release new versions, I want to update deliberately, all at once
  or one mod at a time.
- **US-8** (G-2) When my mod is already installed in the mods dir (`--mod-name`) rather than given
  by path, I want its dependencies handled the same way.
- **US-9** (G-4) When I upgrade the CLI with a config using the old `name=true|false` syntax, I want
  to be told how to migrate.

Errors:

- **US-10** (G-7) When requirements conflict or can't be met (incl. by the game version), I want to
  be told which mod requires what, before Factorio starts.
- **US-11** (G-2) When credentials are missing or rejected, I want to be told how to fix it.
  - Acceptance criteria: fixes listed only where they apply; brief diagnostics of what was checked
    (e.g. "found a Factorio install, but not logged in").

CI:

- **US-12** (G-3) When I set up CI, I want it to take a few documented steps.
- **US-13** (G-1) When CI runs, I want it to use the mod versions I tested locally, and the same
  ones on reruns of the same commit.
- **US-14** (G-3) When someone opens a PR from a fork (no secrets), I want CI to still run the tests
  where possible.
- **US-15** (G-3, G-6) When a CI cache or earlier step already provides the mods, I want them reused,
  not downloaded again.

## Functional Spec

### Definitions

- **Mods dir**: `<data-directory>/mods`. A gitignored cache, like `node_modules`.
- **Mod under test (MUT)**: given by `--mod-path` (symlinked into the mods dir) or `--mod-name`
  (already in the mods dir).
- **Listed mods**: entries of config `mods` / `--mods`.
- **User-managed mod**: a directory or symlink in the mods dir (incl. the MUT symlink).
- **Installed version**: a version present in the mods dir, as zip, directory or symlink.

### Commands

- **CMD-1** `factorio-test mods install`: resolve (RES), write the lock (LOCK-2; frozen: LOCK-4),
  download (DL), print OUT-1. Does not enable mods, start Factorio (beyond `--version`), or edit
  config. Positional args are an error: `To add a mod, list it in "mods" in <config file>.`
  > Inputs: config (`modPath` | `modName`, `mods`, `dataDirectory`, `factorioPath`), MUT
  > `info.json`, lock.
- **CMD-2** `factorio-test mods update [names...]`: like `mods install`, but RES-7 steps 1–2 are
  skipped for the named mods (all if none named).
  - A name not in the enabled set is an error: `"foo" is not used by this test run.`
  - Prints changes (`flib 0.16.2 → 0.17.0`), or `All mods up to date.`
  - Config constraints still apply; a mod held back by one says so.
- **CMD-3** `factorio-test run` does `mods install`, then enables the enabled set (ENABLE), then
  runs tests.
  > G-2 outranks a network-free `run`. When mods are already installed (e.g. by a prior CI
  > `mods install` step), `run` uses no network or credentials (DL-1). In the documented CI
  > workflow (CI-1), `run` gets no credentials, so a download there fails with CRED-4.

### Listing mods

- **MODS-1** Each listed mod entry uses the `info.json` dependency format: `[prefix] name [op version]`.
  Spaces around prefix and op are optional (`flib>=0.16`, `!quality`).
- **MODS-2** Allowed prefixes: none (enable, with constraint), `!` (must not be enabled). `?`, `(?)`,
  `~`, `+` are errors.
  > `!` is how a recommended dependency is left out (US-5), e.g. `--mods space-age '!quality'`.
- **MODS-3** `name=true` / `name=false` is an error with a migration hint (US-9):
  `"name=true|false" is no longer supported. List "name" to enable it; unlisted mods are disabled. Use "!name" to leave out a recommended dependency.`
- **MODS-4** DLC mods are listed like any other mod (`space-age`).
- **MODS-5** An invalid entry is an error naming it and its source (config file or `--mods`):
  `Error: Invalid entry "flib >= x" in mods (factorio-test.json): expected [!] name [op version].`

### Resolution

- **RES-1** Requirements: `base`, `factorio-test >= <MIN>`, the MUT, the MUT's `info.json`
  dependencies, the listed mods.
- **RES-2** The enabled set is the closure of the requirements over required (none, `~`) and
  recommended (`+`) dependencies, except mods listed with `!`.
- **RES-3** Constraints on a mod: version constraints and `!` from the listed mods, and from the
  dependencies (any prefix) of every chosen version. A constraint applies if its mod is enabled.
  > E.g. `? bar >= 2` does not enable `bar`, but if `bar` is enabled, it must be `>= 2`.
- **RES-4** Each mod's version is chosen once, when it is first reached (breadth-first from the
  requirements, in order). The chosen version satisfies the constraints known at that time and is
  compatible with the game version. When a version is chosen, its dependencies' constraints are
  added immediately, so later choices honor them.
  > No re-choosing, no backtracking (NG-1). Deterministic, but order-dependent. Listed mods
  > are requirements, so a listed constraint is always known before its mod is chosen; users steer
  > edge cases this way.
- **RES-5** Fixed mods have exactly one version: the MUT and user-managed mods (their `info.json`
  version), builtin mods (game version). They are never downloaded or replaced.
- **RES-6** After resolution, every constraint is checked against the enabled set. If no version
  satisfies a mod's constraints when it's chosen (RES-4), or a constraint is violated in the final
  check, that's an error before Factorio starts. The error names the mod, each constraint, and who
  imposed it, and suggests a fix:

  ```
  Error: No version of "bar" satisfies: >= 2.0 (from foo 1.3.0), < 2.0 (from config mods), for Factorio 2.1.
  ```

  If the mod was only added as a `+` dependency, the error also suggests listing `!bar`.

- **RES-8** A mod with no portal releases at all (usually a typo) is an error naming who required
  it: `Error: No mod named "flb" on the mod portal (required by config mods).`
- **RES-9** The MUT's `factorio_version` not matching the game is an error naming the executable
  used:

  ```
  Error: my-mod requires Factorio 2.0, but the Factorio found is 2.1.20 (/home/u/factorio/bin/x64/factorio).
  Use --factorio-path to choose a different installation.
  ```

  > A dependency without a release for the game's version uses the RES-6 format
  > (`for Factorio 2.1`).

- **RES-10** An incompatibility (`!`) is an error naming who required each side:
  `Error: "bar" (required by foo 1.3.0) is incompatible with "baz" (required by config mods).`
  If either side was only added as a `+` dependency, it also suggests listing `!name`.

- **RES-7** A managed mod's version is chosen by preference:
  1. its locked version (LOCK), downloaded if not installed
  2. the highest installed zip
  3. the highest portal version

  `mods update` (CMD-2) skips 1–2.

  > 2 before 3: a first run with mods already cached (US-15) needs no network (G-6).

### Builtin mods

- **BUILTIN-1** The CLI ships a snapshot of builtin mods and their dependencies:

  ```ts
  const BUILTIN_MODS = {
    base: [],
    recycler: ["base"],
    "elevated-rails": ["base"],
    quality: ["base", "recycler"],
    "space-age": ["base", "elevated-rails", "recycler", "+ quality"],
  }
  ```

  > The game's data dir can't be located reliably (wrapper scripts), so its `info.json` files are
  > not read.

- **BUILTIN-2** A builtin mod's only version is the game version (`factorio --version`). Never
  downloaded or locked. Constraints on it (`base >= 2.1.10`) are checked normally.

### Lock file

- **LOCK-1** `factorio-test.lock.json`, in the directory of the config file in use
  (`factorio-test.json` or `package.json`), else the current directory. Meant to be committed.

  ```jsonc
  { "lockVersion": 1, "mods": { "factorio-test": "3.1.1", "flib": "0.16.2" } }
  ```

- **LOCK-2** After resolution, the lock is written iff it changed (a missing file counts as empty,
  so nothing to lock writes no file). It contains every enabled mod
  except the MUT and builtins; entries for mods no longer enabled are removed.
- **LOCK-3** User-managed mods are locked at their `info.json` version, like any other mod. Where
  the mod isn't user-managed (e.g. CI), the locked version is used from the mods dir or downloaded.
  > Caveat (documented): CI tests the portal release of that version unless it provides the mod
  > itself. A local checkout with unreleased changes under the same version number differs.
  > A version not on the portal fails the download (DL-2).
- **LOCK-4** Frozen mode (`mods install`, `run`): on by default iff env `CI` is non-empty;
  `--frozen-lockfile` / `--no-frozen-lockfile` override. The lock is never written; if the planned
  lock differs from the file, it's an error before any download. `mods update` ignores frozen mode.
  > Implicit in CI so it can't be forgotten (G-1). `mods update` is explicit, e.g. a bot job
  > updating the lock.
- **LOCK-5** The frozen-mode mismatch error shows the difference:

  ```
  Error: factorio-test.lock.json is out of date:
    flib: 0.16.2 (lock) → 0.17.0 (resolved)
    + space-age-extras 1.0.0
    - old-lib
  Run the tests (or "factorio-test mods install") locally, then commit the lock file.
  ```

### Credentials

Only resolved when something must be downloaded.

- **CRED-1** Env `FACTORIO_USERNAME` + `FACTORIO_TOKEN` take priority. Empty ≡ unset. Exactly one
  set is an error.
  > GitHub expands unavailable secrets to `""` (fork PRs).
- **CRED-2** Otherwise, the first `player-data.json` containing `service-username` and
  `service-token`, from:
  1. `<realpath(executable)>/../../player-data.json` (zip / tar.xz install); executable = `--factorio-path` or auto-detected
  2. OS default write dir: Windows `%APPDATA%\Factorio\`, macOS
     `~/Library/Application Support/factorio/`, Linux `~/.factorio/`
  3. Linux Flatpak Steam: `~/.var/app/com.valvesoftware.Steam/.factorio/`
- **CRED-3** Tokens are never printed.

### Mods dir and enabling

- **DIR-1** User-managed mods are never deleted or overwritten.
- **DIR-2** Installed versions are never deleted; downloads are added next to them (NG-5).
- **ENABLE-1** Exactly the enabled set is enabled in `mod-list.json`; every other mod (installed or
  builtin) is disabled.
- **ENABLE-2** Each enabled non-builtin mod is pinned to its chosen version in `mod-list.json`.
- **ENABLE-3** Before Factorio starts, each pinned version is installed in the mods dir; otherwise
  it's an error.
  > Factorio silently loads another version if the pinned one is missing (Background).

### Downloading

- **DL-1** Network is used only when resolution needs portal metadata (RES-7.3) or a download.
- **DL-2** A locked version not on the portal is an error:
  `"flib" 0.17.0 (locked) is not on the mod portal. If you provide this mod yourself (e.g. a local build), put it in <mods dir>.`
- **DL-3** Resolution and the full download list are determined before any download starts.
  Credentials are resolved only if the list is non-empty.
- **DL-4** A `401` / `403`, or a redirect to the portal login page, is treated as rejected
  credentials (CRED-6).
  Downloads are verified against the portal's sha1. Transient failures (network, 429,
  5xx) are retried with backoff. Any download failure is an error; Factorio is not started.
- **DL-5** If the portal is unreachable when needed, the error names what needed it:

  ```
  Error: Could not reach the Factorio mod portal, needed to download:
    flib 0.16.2 (locked)
  Check your network connection, or put the mod in <mods dir> yourself.
  ```

### Credential errors

- **CRED-4** No credentials found:

  ```
  Error: These mods need to be downloaded from the Factorio mod portal:
    factorio-test 3.1.1, flib 0.16.2
  Downloading requires a Factorio account, but no credentials were found.
  Checked: environment variables FACTORIO_USERNAME / FACTORIO_TOKEN (not set),
    player-data.json in /home/u/factorio (not logged in), /home/u/.factorio (not found)

  To fix this, do one of the following:
    - Log in to your Factorio account in the game once. The CLI then finds the credentials
      automatically.
    - Set the environment variables FACTORIO_USERNAME and FACTORIO_TOKEN. Your token is shown on
      https://factorio.com/profile.
    - Download or install the mods yourself and put them in <mods dir>.
  ```

  - `Checked:` lists the directories searched for `player-data.json` (CRED-2), one status each.
  - The "Log in" item is shown only if a `player-data.json` was found without credentials;
    otherwise logging in wouldn't help.

  In CI (env `CI` non-empty), the fix list is instead:

  ```
  CI detected (CI=true). To fix this, do one of the following:
    - Store FACTORIO_USERNAME and FACTORIO_TOKEN as secrets in your CI and pass them to this step
      as environment variables. Your token is shown on https://factorio.com/profile.
    - Provide the mods in <mods dir> in an earlier step.
  Note: secrets may be unavailable in some runs (e.g. pull requests from forks).
  See <CI docs link>.
  ```

  > Only `CI` is checked (same signal as frozen mode, LOCK-4); provider-specific help (GitHub
  > repository secrets, fork PRs and caching) lives in the linked docs.

- **CRED-5** Exactly one of `FACTORIO_USERNAME` / `FACTORIO_TOKEN` set (CRED-1):
  `Error: FACTORIO_USERNAME is set, but FACTORIO_TOKEN is not. Set both, or neither.`

- **CRED-6** Credentials rejected by the portal. The message names the source, and the fix matches
  it:

  ```
  Error: The Factorio mod portal rejected the credentials for user "u"
  (from player-data.json in /home/u/.factorio).
  The token may be outdated. To fix this, log in to the game again, or set FACTORIO_USERNAME and
  FACTORIO_TOKEN (see https://factorio.com/profile).
  Note: mod portal API keys don't work for downloads; use the account token.
  ```

  From env vars: `(from environment variables FACTORIO_USERNAME / FACTORIO_TOKEN)`, and the fix is
  to update `FACTORIO_TOKEN` from https://factorio.com/profile.

### Output

- **OUT-1** Each run prints the enabled set in one line, with versions and source where notable:
  `Mods: flib 0.16.2, factorio-test 3.1.1 (downloaded), my-lib 0.3.0 (user-managed), space-age`

### CI

- **CI-1** Documented setup (README / docs, copy-paste workflow), three steps:
  1. a workflow: setup-factorio action (separate spec), `actions/cache` on the mods dir,
     `mods install` (with credentials as env), `run` (without)
  2. repo secrets `FACTORIO_USERNAME` / `FACTORIO_TOKEN`, passed as env
  3. commit the lock file
- **CI-2** The documented cache key is the lock file hash.
  > A new game major.minor needs new mod versions anyway, which changes the lock. Fork PRs can
  > restore the base branch's cache, so they run without secrets when the lock is unchanged (US-14).
- **CI-3** Frozen mode without a lock file, when there is something to lock:
  `Error: No factorio-test.lock.json found in <dir>. Run the tests locally once, then commit the lock file.`

## Verification

### Automated testing

Unit (vitest), at module boundaries, no network:

- **Mod spec parsing** (MODS-1..3, MODS-5): parameterized.
- **Resolver** (RES-1..10, RES-7 order as given by the source, frozen diff (LOCK-5), CI-3, error texts),
  against an in-memory fake candidate source. Main coverage.
- **Candidate source** (RES-5, RES-7, BUILTIN, LOCK-3, DIR-1/2): real implementation over a temp
  mods dir, a lock, and a fake portal. Covers mods dir scanning.
- **Credentials** (CRED-1..5): env and file contents passed in.
- **Portal client** (DL-2..5, CRED-6) against a local fake HTTP server: sha1 mismatch, retry on
  5xx/429, 403 and login redirect, unknown version, unreachable.

E2E (real headless Factorio, at most one case): the run loads with exactly the enabled set at the
pinned versions (no extra mods enabled). ENABLE-3 (missing pinned version) is unit-tested: resolution
only picks installed or downloaded versions, so it can't be provoked end to end.

> Factorio's own `mod-list.json` behavior is verified once (Background); it is not re-tested
> beyond this.

### Manual testing

Agent:

- Real portal download using local `player-data.json` credentials: validates the portal contract
  the fake server encodes.
- One CI run of the documented workflow on this repo: cache miss, then cache hit.

## Design

### Candidate source ↔ resolver

```ts
interface Candidate {
  name: string
  version: string
  factorioVersion: string
  dependencies: Dependency[] // parsed info.json deps
  origin: "builtin" | "mut" | "user-managed" | "locked" | "installed" | "portal"
  installed: boolean // false: needs download
}

interface CandidateSource {
  // ordered by RES-7 preference; fixed mods (RES-5) yield exactly one
  candidates(name: string): AsyncIterable<Candidate>
}

resolve(requirements: Dependency[], source: CandidateSource): Promise<Resolution>
```

- The resolver owns RES-1..4, RES-6: closure, constraints, `!`, `+`, errors. It takes the first
  candidate satisfying the known constraints.
- The source owns RES-5, RES-7 (incl. `mods update` skip), BUILTIN, lock, mods dir, portal, and
  filters by `factorio_version`. Lazy: the portal is fetched only when earlier candidates don't
  satisfy (DL-1, G-6).
  > Rejected: a sync, prefetched portal index: needs network every run, or a discovery pre-pass.
- Installed zips' dependencies are read from `info.json` inside the zip (`yauzl`); directories and
  symlinks read `info.json` directly.
  > Rejected: caching portal metadata (fails for zips the CLI didn't download); storing deps in the
  > lock (duplicates zip contents).

### Modules

Replaces `cli/mod-setup.ts` and `planModSetup` (`cli/run-plan.ts`). Names tentative.

```
cli/mods/
  dependency.ts    // parse info.json / listed specs (MODS), version compare
  resolve.ts       // resolver (RES)
  source.ts        // CandidateSource: builtin + MUT + mods dir + lock + portal
  portal.ts        // portal metadata + download (DL)
  credentials.ts   // CRED
  lock.ts          // read / write / diff (LOCK)
  install.ts       // resolve → lock → download → OUT-1; used by `mods install`, `run`
  mod-list.ts      // write mod-list.json (ENABLE-1..3)
cli/mods-command.ts   // `mods install` / `mods update`, next to cli/run.ts
cli/factorio-setup.ts // non-mod leftovers: config.ini, mod-settings.dat, autorun settings, watch target
```

### Config

`mods install` / `mods update` register only options tagged `forModSetup` in
`cli/config/options.ts` (`modPath`, `modName`, `mods`, `dataDirectory`, `factorioPath`, `verbose`,
`frozenLockfile`), and read the same config file. Run-only keys in the file are ignored there.

### Install flow

```
resolve → plan { enabled, downloads, newLock }
frozen? diff(newLock, lockFile) → error (LOCK-4, CI-3)
download all, sequentially (DL)
write lock if changed (LOCK-2)
print OUT-1
```

The lock is written only after downloads succeed, so a failed run leaves it unchanged.

### Errors

All errors are `CliError`s with user-facing messages. The resolver stops at the first error.

### mod-list.json

Written directly, not via `fmtk mods adjust`. `fmtk` stays only for `settings`
(`mod-settings.dat` is binary).

> `fmtk mods adjust` is only a JSON read/modify/write, and `--disableExtra` disables only
> entries already in `mod-list.json`; installed mods missing from it are then enabled by Factorio,
> violating ENABLE-1. Writing it ourselves lists every installed and builtin mod explicitly.

### Downloads

Download to `<mods dir>/<name>_<version>.zip.tmp`, verify sha1, then rename. An interrupted run
leaves no corrupt zip that would count as installed.

## Implementation Plan

Vertical slices: each leaves `run` working and existing integration tests green, and is verified
before the next. Details in plan mode.

1. **Correct enabled set, from installed mods (offline).**
   - Dependency parsing (MODS-1..5), resolver (RES-1..6, RES-9, RES-10), candidate source without
     portal (builtin, MUT, mods dir incl. zip `info.json`), `mod-list.json` writer (ENABLE-1..3),
     OUT-1. Replaces the enabling half of `planModSetup` and the DLC special-casing.
   - Transitional: the existing fmtk download step stays as a pre-pass for missing mods.
   - Verify: resolver unit tests (fake source), source tests (temp mods dir), one e2e (pre-placed
     zips, two versions of a mod, `space-age` + `!quality`).
2. **Reproducible via lock.**
   - LOCK-1..5, RES-7.1, frozen mode (`CI` default, flags), CI-3.
   - Verify: lock and frozen-diff unit tests; a newer installed zip doesn't change the locked
     choice.
3. **Portal downloads replace fmtk.**
   - Portal client (DL-1..5), portal candidates (RES-7.3, RES-8), credentials (CRED-1..6).
   - Remove the fmtk download pre-pass, `installFactorioTest` / `installMods`, and the rest of
     `cli/mod-setup.ts`.
   - Verify: fake HTTP server tests; manual real download (agent).
4. **`mods install` / `mods update`.**
   - `forModSetup` config tag, CMD-1..3, update skip of RES-7.1–2.
   - Verify: CLI-level tests (update output, frozen ignored, positional args to `install` rejected).
5. **CI.**
   - Docs (CI-1, CI-2) and example workflow, CRED-4's CI docs link.
   - Verify: manual CI run, cache miss then hit (needs a push: user approval).

## Notes

Deferred:

- Reusable CI workflow (`uses: GlassBricks/FactorioTest/.github/workflows/...`) bundling cache,
  setup and run.
- `mods list`: show the resolved set and sources.
- `mods install <name>` adding to config.
- Factorio 2.0 support (NG-2).
- Drift check of `BUILTIN_MODS` against the game's `data/*/info.json`.
- OUT: on Factorio load failure, print the mod-loading error lines from `factorio-current.log`.
