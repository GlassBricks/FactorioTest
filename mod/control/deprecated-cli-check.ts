import { Settings } from "../constants"

const deprecatedAutoStart = settings.startup[Settings.DeprecatedAutoStart]?.value as boolean | undefined

if (deprecatedAutoStart) {
  const message = `
================================================================================
  INCOMPATIBLE CLI VERSION
================================================================================

  factorio-test mod version 3.0+ is not compatible with factorio-test-cli 2.x.

  Options:
    - Upgrade to v3.0 (breaking changes, see changelog):
        npm install factorio-test-cli@latest

    - Stay on 2.x by upgrading CLI to 2.0.1:
        npm install factorio-test-cli@2

================================================================================
`

  print("FACTORIO-TEST-MESSAGE-START")
  log(message)
  print("FACTORIO-TEST-MESSAGE-END")
  print("FACTORIO-TEST-RESULT:incompatible cli version")
  error("FACTORIO-TEST-EXIT")
}
