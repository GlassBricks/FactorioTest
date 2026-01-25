import {
  ButtonGuiElement,
  FrameGuiElement,
  LabelGuiElement,
  LuaGuiElement,
  LuaPlayer,
  LuaStyle,
  ProgressBarGuiElement,
  ScrollPaneGuiElement,
  SpriteButtonGuiElement,
  TableGuiElement,
} from "factorio:runtime"
import { Locale, Misc, Prototypes } from "../constants"
import { getPlayer } from "./_util"
import { Colors, MessageColor, MessageHandler } from "./output"
import { TestRunResults } from "./results"
import { TestState } from "./state"
import { TestEventListener } from "./test-events"
import { countActiveTests } from "./tests"
import ProgressGui = Locale.ProgressGui
import ConfigGui = Locale.ConfigGui

interface TestGui {
  player: LuaPlayer
  mainFrame: FrameGuiElement
  closeButton: SpriteButtonGuiElement
  statusText: LabelGuiElement
  progressBar: ProgressBarGuiElement
  progressLabel: LabelGuiElement
  testCounts: TableGuiElement
  output: ScrollPaneGuiElement
  actionButton: ButtonGuiElement

  totalTests: number
}

declare const storage: {
  __testGui: TestGui
}

function StatusText(parent: LuaGuiElement) {
  const statusText = parent.add({ type: "label" })
  statusText.style.font = "default-large"
  return statusText
}

function ProgressBar(parent: LuaGuiElement): {
  progressBar: ProgressBarGuiElement
  progressLabel: LabelGuiElement
} {
  const progressFlow = parent.add<"flow">({
    type: "flow",
    direction: "horizontal",
  })
  progressFlow.style.horizontally_stretchable = true
  progressFlow.style.vertical_align = "center"

  const progressBar = progressFlow.add({
    type: "progressbar",
  })
  progressBar.style.horizontally_stretchable = true

  const progressLabel = progressFlow.add({
    type: "label",
  })
  const plStyle = progressLabel.style
  plStyle.width = 80
  plStyle.horizontal_align = "center"

  return {
    progressBar,
    progressLabel,
  }
}

function TestCount(parent: LuaGuiElement) {
  const table = parent.add<"table">({
    type: "table",
    column_count: 5,
    style: "bordered_table",
  })

  function addLabel() {
    const result = table.add({ type: "label" })
    const style: LuaStyle = result.style
    style.horizontally_stretchable = true
    style.horizontal_align = "center"
    style.font = "default-bold"
    style.width = 80
    return result
  }
  const colors = [MessageColor.Red, MessageColor.Red, MessageColor.Yellow, MessageColor.Purple, MessageColor.Green]
  for (const color of colors) {
    const label = addLabel()
    label.style.font_color = Colors[color]
  }
  return table
}

function TestOutput(parent: LuaGuiElement): ScrollPaneGuiElement {
  const frame = parent.add({
    type: "frame",
    style: "inside_shallow_frame",
    direction: "vertical",
  })

  const pane = frame.add({
    type: "scroll-pane",
    style: "scroll_pane_in_shallow_frame",
  })
  pane.style.height = 600
  pane.style.horizontally_stretchable = true
  return pane
}

function bottomButtonsBar(parent: LuaGuiElement) {
  const flow = parent.add({
    type: "flow",
    direction: "horizontal",
  })
  const spacer = flow.add({
    type: "empty-widget",
  })
  spacer.style.horizontally_stretchable = true

  const actionButton = flow.add({
    type: "button",
    caption: [ProgressGui.Cancel],
    tags: {
      modName: "factorio-test",
      on_gui_click: Misc.CancelTestRun,
    },
  })
  return {
    actionButton,
  }
}

function closeTestProgressGui(): void {
  const player = getPlayer()

  const screen = player.gui.screen
  screen[Misc.TestGui]?.destroy()
  storage.__testGui = undefined!
}

function createTestProgressGui(state: TestState): TestGui {
  const player = getPlayer()

  const screen = player.gui.screen
  screen[Misc.TestGui]?.destroy()

  const mainFrame = screen.add<"frame">({
    type: "frame",
    name: Misc.TestGui,
    direction: "vertical",
  })
  mainFrame.auto_center = true
  mainFrame.style.width = 1000

  const titleBar = mainFrame.add({
    type: "flow",
    direction: "horizontal",
  })
  titleBar.drag_target = mainFrame

  const style = titleBar.style
  style.horizontal_spacing = 8
  style.height = 28
  titleBar.add({
    type: "label",
    caption: [ProgressGui.Title, script.mod_name],
    style: "frame_title",
    ignored_by_interaction: true,
  })
  // drag handle
  {
    const element = titleBar.add({
      type: "empty-widget",
      ignored_by_interaction: true,
      style: "draggable_space",
    })
    const style = element.style
    style.horizontally_stretchable = true
    style.height = 24
  }

  const closeButton = titleBar.add({
    type: "sprite-button",
    style: "frame_action_button",
    sprite: "utility/close",
    hovered_sprite: "utility/close_black",
    clicked_sprite: "utility/close_black",
    tooltip: ["gui.close"],
    mouse_button_filter: ["left"],
    tags: {
      modName: "factorio-test",
      on_gui_click: Misc.CloseTestGui,
    },
    enabled: false,
  })

  const contentFlow = mainFrame.add({
    type: "flow",
    direction: "vertical",
  })
  contentFlow.style.vertical_spacing = 15
  const topFrame = contentFlow.add({
    type: "frame",
    style: "inside_shallow_frame_with_padding",
    direction: "vertical",
  })
  const gui: TestGui = {
    player,
    mainFrame,
    totalTests: countActiveTests(state.rootBlock, state),
    closeButton,
    statusText: StatusText(topFrame),
    ...ProgressBar(topFrame),
    testCounts: TestCount(topFrame),
    output: TestOutput(contentFlow),
    ...bottomButtonsBar(contentFlow),
  }

  updateTestCounts(gui, state.results)
  return gui
}

function getTestProgressGui() {
  const gui = storage.__testGui
  if (!gui?.mainFrame.valid) {
    storage.__testGui = undefined!
    return undefined
  }
  return gui
}

function updateTestCounts(gui: TestGui, results: TestRunResults) {
  gui.progressBar.value = gui.totalTests === 0 ? 1 : results.ran / gui.totalTests
  gui.progressLabel.caption = ["", results.ran, "/", gui.totalTests]

  const testCounts = gui.testCounts.children

  if (results.failed > 0) testCounts[0]!.caption = [ProgressGui.NFailed, results.failed]
  if (results.describeBlockErrors > 0) testCounts[1]!.caption = [ProgressGui.NErrors, results.describeBlockErrors]
  if (results.skipped > 0) testCounts[2]!.caption = [ProgressGui.NSkipped, results.skipped]
  if (results.todo > 0) testCounts[3]!.caption = [ProgressGui.NTodo, results.todo]
  if (results.passed > 0) testCounts[4]!.caption = [ProgressGui.NPassed, results.passed]
}

export const progressGuiListener: TestEventListener = (event, state) => {
  if (event.type === "testRunStarted") {
    storage.__testGui = createTestProgressGui(state)
    return
  }
  const gui = getTestProgressGui()
  if (!gui) return
  switch (event.type) {
    case "describeBlockEntered": {
      const { block } = event
      gui.statusText.caption = [ProgressGui.RunningTest, block.path]
      break
    }
    case "testEntered": {
      const { test } = event
      gui.statusText.caption = [ProgressGui.RunningTest, test.path]
      break
    }
    case "testFailed": {
      updateTestCounts(gui, state.results)
      gui.statusText.caption = [ProgressGui.RunningTest, event.test.parent.path]
      break
    }
    case "testPassed": {
      updateTestCounts(gui, state.results)
      gui.statusText.caption = [ProgressGui.RunningTest, event.test.parent.path]
      break
    }
    case "testSkipped": {
      updateTestCounts(gui, state.results)
      gui.statusText.caption = [ProgressGui.RunningTest, event.test.parent.path]
      break
    }
    case "testTodo": {
      updateTestCounts(gui, state.results)
      gui.statusText.caption = [ProgressGui.RunningTest, event.test.parent.path]
      break
    }
    case "describeBlockFinished": {
      const { block } = event
      if (block.parent) gui.statusText.caption = [ProgressGui.RunningTest, block.parent.path]
      break
    }
    case "describeBlockFailed": {
      updateTestCounts(gui, state.results)
      const { block } = event
      if (block.parent) gui.statusText.caption = [ProgressGui.RunningTest, block.parent.path]
      break
    }
    case "testRunFinished": {
      const statusLocale =
        state.results.status == "passed"
          ? ProgressGui.TestsPassed
          : state.results.status == "todo"
            ? ProgressGui.TestsPassedWithTodo
            : ProgressGui.TestsFailed

      gui.statusText.caption = [statusLocale]
      gui.closeButton.enabled = true
      gui.actionButton.caption = [ConfigGui.RerunTests]
      gui.actionButton.tags = { modName: "factorio-test", on_gui_click: Misc.RunTests }
      break
    }
    case "testRunCancelled": {
      gui.statusText.caption = [ProgressGui.TestsCancelled]
      gui.closeButton.enabled = true
      gui.actionButton.caption = [ConfigGui.RerunTests]
      gui.actionButton.tags = { modName: "factorio-test", on_gui_click: Misc.RunTests }
      break
    }
    case "loadError": {
      gui.statusText.caption = [ProgressGui.LoadError]
      gui.closeButton.enabled = true
      gui.actionButton.caption = [ConfigGui.RerunTests]
      gui.actionButton.tags = { modName: "factorio-test", on_gui_click: Misc.RunTests }
      break
    }
    case "customEvent": {
      if (event.name === "closeProgressGui") {
        closeTestProgressGui()
      }
      break
    }
  }
}

const profilerLength = "(Duration: 0.082400ms)".length - "(<Profiler>)".length
export const progressGuiLogger: MessageHandler = (message) => {
  const gui = storage.__testGui
  if (!gui || !gui.progressBar.valid) return
  const output = gui.output
  const textBox = output.add({
    type: "text-box",
    style: Prototypes.TestOutputBoxStyle,
  })
  textBox.read_only = true
  textBox.word_wrap = true
  let lines = 0
  let isFirstLine = true
  for (const line of message.plainText.split("\n")) {
    const lineLength = line.length + (isFirstLine ? profilerLength : 0)
    if (lineLength > 110) {
      lines += math.ceil(lineLength / 105)
    } else {
      lines++
    }
    isFirstLine = false
  }
  textBox.style.height = 20 * lines
  textBox.caption = message.richText
}
