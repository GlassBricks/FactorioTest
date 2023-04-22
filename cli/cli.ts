import { program } from "@commander-js/extra-typings"
import "./run-test.js"

program
  .name("factorio-test")
  .description("cli for factorio testing")
  .addHelpCommand()
  .showHelpAfterError()
  .showSuggestionAfterError()
  .parse()
