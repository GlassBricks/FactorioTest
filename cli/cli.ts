#!/usr/bin/env node
import { program } from "commander"
import "./run.js"

await program
  .name("factorio-test")
  .description("cli for factorio testing")
  .helpCommand(true)
  .showHelpAfterError()
  .showSuggestionAfterError()
  .parseAsync()
