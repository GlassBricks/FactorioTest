#!/usr/bin/env node
import chalk from "chalk"
import { program } from "commander"
import { readFileSync } from "fs"
import { CliError } from "./cli-error.js"
import "./run.js"

const { version } = JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8")) as {
  version: string
}

try {
  await program
    .name("factorio-test")
    .version(version)
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
