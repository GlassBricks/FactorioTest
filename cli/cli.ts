#!/usr/bin/env node
import { program } from "commander"
import chalk from "chalk"
import { CliError } from "./cli-error.js"
import "./run.js"

try {
  await program
    .name("factorio-test")
    .description("cli for factorio testing")
    .helpCommand(true)
    .showHelpAfterError()
    .showSuggestionAfterError()
    .parseAsync()
} catch (error) {
  if (error instanceof CliError) {
    console.error(chalk.red("Error:"), error.message)
    process.exit(1)
  }
  throw error
}
