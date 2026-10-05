import type { Command } from "@commander-js/extra-typings"
import chalk from "chalk"
import { Command as RuntimeCommand } from "commander"
import { readFileSync } from "fs"
import { CliError } from "./cli-error.js"
import { registerModsCommand } from "./mods-command.js"
import { registerRunCommand } from "./run.js"

const { version } = JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8")) as {
  version: string
}

export async function main(argv: string[]): Promise<number> {
  let exitCode = 0
  const program = (new RuntimeCommand() as unknown as Command)
    .name("factorio-test")
    .version(version)
    .description("cli for factorio testing")
    .helpCommand(true)
    .showHelpAfterError()
    .showSuggestionAfterError()
  registerRunCommand(program, (code) => (exitCode = code))
  registerModsCommand(program)

  try {
    await program.parseAsync(argv)
  } catch (error) {
    if (!(error instanceof CliError)) throw error
    console.error(chalk.red("Error:"), error.message)
    return 1
  }
  return exitCode
}
