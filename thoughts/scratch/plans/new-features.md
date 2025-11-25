# Desired new features for next major version:

CLI/headless mode:

- Add headless mode! (later. Abuse benchmarking on a save? To investigate: if a benchmark on a save can include a player, and include mods/settings)
  - Github CI hook?
- Automatic mod downloading using fmtk. Use discovered tokens for credentials when possible. Investigate fmtk implementation (see online repo)
- Add test filtering options to cli. Make "test filter" the default arg, so you can just run `npm test some test name`. Change factorio args from ...nargs to a named option
- Make "focused" (.only) test not run by default in cli mode; but run by default in interactive mode. Add new option to allow "focused" tests. Avoids accidentally not running all tests if used as a check.
- Config file, to collect multiple args.
- Capture log output per-test. Show to stdout when tests fail.
- Fancier cli output: show progress bar?
- Output tests results to file.
  - Reorder tests to run previously failing tests first.

Interactive mode:

- Make in-game GUI less awkward
- Add early test cancellation.

Test API:

- Better test name formatting for .each; to be more than just string.format options. E.g. "test.each([{foo: "bar"}])("Do stuff with $foo}", ...)
- Arbitrary .each nesting (instead of only one level): if a .each contains .each in it, the outer .each is ineffective
- Public mod utilities to setup a "clean slate" for tests (later)
- Remove luassert bundling
