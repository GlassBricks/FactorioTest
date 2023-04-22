import { program } from "commander"
import "./run.js"

program
  .name("factorio-test")
  .description("cli for factorio testing")
  .addHelpCommand()
  .showHelpAfterError()
  .showSuggestionAfterError()
  .parse()
