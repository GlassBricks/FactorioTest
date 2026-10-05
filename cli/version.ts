import { readFileSync } from "fs"

export const cliVersion: string = (
  JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8")) as { version: string }
).version
