import { ColorArray, LocalisedString, LuaProfiler } from "factorio:runtime"
import { debugAdapterEnabled } from "./_util"
import { TesteEventListener } from "./test-events"
import { Source } from "./tests"

export const enum MessageColor {
  White = 1,
  Green,
  Yellow,
  Red,
  Purple,
}

export const Colors: Record<MessageColor, ColorArray> = {
  [MessageColor.White]: [1, 1, 1],
  [MessageColor.Green]: [71, 221, 37],
  [MessageColor.Yellow]: [252, 237, 50],
  [MessageColor.Red]: [230, 60, 60],
  [MessageColor.Purple]: [177, 156, 220],
}
const ColorFormat: Record<MessageColor, string> = {} as any
for (const [code, color] of pairs(Colors)) {
  ColorFormat[code] = `[color=${color.join()}]`
}

interface MessagePart {
  text: string | LuaProfiler
  color?: MessageColor
}

const MAX_LINE_LENGTH = 110
const PREFIX_LEN = 5
const SUFFIX_LEN = 23

function formatTestPath(text: string): MessagePart {
  let curStart = 0
  let curLineLen = PREFIX_LEN
  const result: string[] = []
  while (text.length - curStart + curLineLen > MAX_LINE_LENGTH) {
    const length = MAX_LINE_LENGTH - curLineLen
    result.push(string.sub(text, curStart + 1, curStart + length))
    curStart += length
    curLineLen = 8 // 8 spaces in indent
  }
  if (text.length - curStart + curLineLen > MAX_LINE_LENGTH - SUFFIX_LEN) {
    const length = MAX_LINE_LENGTH - curLineLen - SUFFIX_LEN
    result.push(string.sub(text, curStart + 1, curStart + length))
    curStart += length
  }
  result.push(string.sub(text, curStart + 1))
  return { text: result.join("\n        ") }
}

function red(text: string): MessagePart {
  return {
    text,
    color: MessageColor.Red,
  }
}

function yellow(text: string): MessagePart {
  return {
    text,
    color: MessageColor.Yellow,
  }
}

function green(text: string): MessagePart {
  return {
    text,
    color: MessageColor.Green,
  }
}

function purple(text: string): MessagePart {
  return {
    text,
    color: MessageColor.Purple,
  }
}

interface RichAndPlainText {
  richText: LocalisedString
  plainText: LocalisedString
  firstColor?: MessageColor | undefined
}

function formatError(text: string): RichAndPlainText {
  // replace tabs with 4 spaces in rich text
  const withSpaces = string.gsub(text, "\t", "    ")[0]
  // indent all lines by 4 spaces
  const withIndent = string.gsub(withSpaces, "\n", "\n    ")[0]
  return {
    richText: "    " + withIndent,
    plainText: text,
    firstColor: MessageColor.Red,
  }
}

function m(strings: TemplateStringsArray, ...substitutions: (string | LuaProfiler | MessagePart)[]): RichAndPlainText {
  let plainResult: ["", ...(string | LuaProfiler)[]] = [""]
  let richResult: ["", ...(string | LuaProfiler)[]] = [""]
  let firstColor: MessageColor | undefined = undefined

  let isString = true

  for (const i of $range(1, strings.length * 2 - 1)) {
    const element = i % 2 === 0 ? strings[i / 2] : substitutions[(i - 1) / 2]
    if (element === undefined) continue

    let color: MessageColor | undefined
    let text: string | LuaProfiler
    if (typeof element === "object") {
      if ("object_name" in element) {
        text = element
      } else {
        text = element.text
        color = element.color
        firstColor ??= color
      }
    } else {
      text = element
    }

    if (color) richResult.push(ColorFormat[color])
    if (typeof text !== "string" && isString) {
      plainResult = ["", table.concat(plainResult as string[])]
      richResult = ["", table.concat(richResult as string[])]
      isString = false
    }
    plainResult.push(text)
    richResult.push(text)
    if (color) richResult.push("[/color]")
  }

  return {
    richText: richResult,
    plainText: plainResult,
    firstColor,
  }
}

export type MessageHandler = (message: RichAndPlainText, source: Source | undefined) => void

const messageHandlers: MessageHandler[] = []

export function addMessageHandler(handler: MessageHandler): void {
  messageHandlers.push(handler)
}

function output(message: RichAndPlainText, source?: Source): void {
  for (const logHandler of messageHandlers) {
    logHandler(message, source)
  }
}

const jsonEncode: typeof import("__debugadapter__/json").encode = !debugAdapterEnabled
  ? undefined
  : require("@NoResolution:__debugadapter__/json").encode
const daTranslate: typeof import("__debugadapter__/variables").translate = !debugAdapterEnabled
  ? undefined
  : __DebugAdapter
  ? require("@NoResolution:__debugadapter__/variables").translate
  : (() => {
      let id = 0
      return (message) => {
        const translationID = id++
        const [success, result] = pcall(localised_print, [
          "",
          "***DebugAdapterBlockPrint***\nDBGtranslate: ",
          translationID,
          "\n",
          message,
          "\n***EndDebugAdapterBlockPrint***",
        ])
        return success ? translationID : (result as string)
      }
    })()

const DebugAdapterCategories: Record<MessageColor, string> = {
  [MessageColor.White]: "stdout",
  [MessageColor.Green]: "stdout",
  [MessageColor.Yellow]: "console",
  [MessageColor.Red]: "stderr",
  [MessageColor.Purple]: "console",
}

function printDebugAdapterText(text: string, source: Source | undefined, category: string) {
  const lines = text.split("\n")
  for (const line of lines) {
    let sourceFile: string | undefined, sourceLine: number | undefined
    if (source) {
      sourceFile = source.file
      sourceLine = source.line
      source = undefined
    } else {
      const [, , file1, line1] = string.find(line, "(__[%w%-_]+__/.-%.%a+):(%d*)")
      sourceFile = file1 as string
      sourceLine = tonumber(line1)
    }
    if (sourceFile && !sourceFile.startsWith("@")) sourceFile = "@" + sourceFile
    const body = {
      category,
      output: line,
      line: sourceFile && (sourceLine ?? 1),
      source: {
        name: sourceFile,
        path: sourceFile,
      },
    }

    print("DBGprint: " + jsonEncode!(body))
  }
}

export const debugAdapterLogger: MessageHandler = (message, source) => {
  const color = message.firstColor ?? MessageColor.White
  const category = DebugAdapterCategories[color]
  const text = message.plainText
  const output = typeof text === "string" ? text : `{LocalisedString ${daTranslate(text)}}`
  printDebugAdapterText(output, source, category)
}

export const logLogger: MessageHandler = (message) => {
  print("FACTORIO-TEST-MESSAGE-START")
  log(message.plainText)
  print("FACTORIO-TEST-MESSAGE-END")
}

export const logListener: TesteEventListener = (event, state) => {
  switch (event.type) {
    case "testRunStarted": {
      output(m`Starting test run...`)
      break
    }
    case "testPassed": {
      if (state.config.log_passed_tests) {
        const { test } = event
        output(
          m`${green("PASS")} ${formatTestPath(test.path)} (${test.profiler!}${
            test.tags.has("after_mod_reload") || test.tags.has("after_script_reload") ? " after reload" : ""
          })`,
          test.source,
        )
      }
      break
    }
    case "testFailed": {
      const { test } = event
      output(m`${red("FAIL")} ${formatTestPath(test.path)}`, test.source)
      for (const error of test.errors) {
        output(formatError(error))
      }
      break
    }
    case "testTodo": {
      const { test } = event
      output(m`${purple("TODO")} ${formatTestPath(test.path)}`, test.source)
      break
    }
    case "testSkipped": {
      if (state.config.log_skipped_tests) {
        const { test } = event
        output(m`${yellow("SKIP")} ${formatTestPath(test.path)}`, test.source)
      }
      break
    }
    case "describeBlockFailed": {
      const { block } = event
      // output(m`${bold(block.path)} ${red("error")}`, block.source)
      output(m`${red("ERROR")} ${formatTestPath(block.path)}`, block.source)
      for (const error of block.errors) {
        output(formatError(error))
      }
      break
    }
    case "testRunFinished": {
      const results = state.results
      const status = results.status

      output(
        m`${{
          text: `Test run finished: ${status === "todo" ? "passed with todo tests" : status}`,
          color:
            status === "passed"
              ? MessageColor.Green
              : status === "failed"
              ? MessageColor.Red
              : status === "todo"
              ? MessageColor.Purple
              : MessageColor.White,
        }}`,
      )
      output(m`${state.profiler!}${state.reloaded ? " since last reload" : ""}`)
      break
    }
    case "loadError": {
      output(m`${red("ERROR")} There was an load error:`)
      output(formatError(state.rootBlock.errors[0]!))
      break
    }
  }
}
