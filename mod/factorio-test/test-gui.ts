import {
  ButtonGuiElement,
  FrameGuiElement,
  LabelGuiElement,
  LocalisedString,
  LuaGuiElement,
  LuaPlayer,
  ProgressBarGuiElement,
  ScrollPaneGuiElement,
} from "factorio:runtime"
import { Locale, Misc, Prototypes } from "../constants"
import { getPlayer } from "./_util"
import { MessageHandler } from "./output"
import { TestRunResults } from "./results"
import { TestState } from "./state"
import { TestEventListener } from "./test-events"
import { countActiveTests } from "./tests"
import ProgressGui = Locale.ProgressGui
import ConfigGui = Locale.ConfigGui

interface TestGui {
  player: LuaPlayer
  mainFrame: FrameGuiElement
  statusText: LabelGuiElement
  progressBar: ProgressBarGuiElement
  progressLabel: LabelGuiElement
  testSummary: LabelGuiElement
  output: ScrollPaneGuiElement
  actionButton: ButtonGuiElement
  stepBar: FrameGuiElement
  stepLabel: LabelGuiElement

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

function TestSummary(parent: LuaGuiElement): LabelGuiElement {
  const label = parent.add({ type: "label" })
  label.style.font = "default-bold"
  return label
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

function StepBar(parent: LuaGuiElement): {
  stepBar: FrameGuiElement
  stepLabel: LabelGuiElement
} {
  const stepBar = parent.add<"frame">({
    type: "frame",
    style: "inside_shallow_frame_with_padding",
    direction: "horizontal",
  })
  stepBar.visible = false
  stepBar.style.horizontally_stretchable = true

  // alignment and spacing belong on a flow; frame styles reject them
  const flow = stepBar.add<"flow">({
    type: "flow",
    direction: "horizontal",
  })
  const flowStyle = flow.style
  flowStyle.horizontally_stretchable = true
  flowStyle.vertical_align = "center"
  flowStyle.horizontal_spacing = 8

  const stepLabel = flow.add({ type: "label" })
  stepLabel.style.font = "default-bold"
  stepLabel.style.single_line = false

  const spacer = flow.add({ type: "empty-widget" })
  spacer.style.horizontally_stretchable = true

  function stepButton(caption: string, action: string, style: string) {
    flow.add({
      type: "button",
      style,
      caption: [caption],
      tags: {
        modName: "factorio-test",
        on_gui_click: action,
      },
    })
  }
  stepButton(ProgressGui.StepSkipTest, Misc.StepSkipTest, "button")
  stepButton(ProgressGui.StepRunRest, Misc.StepRunRest, "button")
  stepButton(ProgressGui.StepNext, Misc.StepNext, "confirm_button")

  return { stepBar, stepLabel }
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
    caption: state.hasFocusedTests
      ? ["", [ProgressGui.Title, script.mod_name], " (.only)"]
      : [ProgressGui.Title, script.mod_name],
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

  titleBar.add({
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
    statusText: StatusText(topFrame),
    ...ProgressBar(topFrame),
    testSummary: TestSummary(topFrame),
    output: TestOutput(contentFlow),
    ...StepBar(contentFlow),
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

function buildTestSummary(results: TestRunResults): LocalisedString {
  const parts: LocalisedString[] = []
  if (results.passed > 0) parts.push([ProgressGui.NPassed, results.passed])
  if (results.failed > 0) parts.push([ProgressGui.NFailed, results.failed])
  if (results.describeBlockErrors > 0) parts.push([ProgressGui.NErrors, results.describeBlockErrors])
  if (results.skipped > 0) parts.push([ProgressGui.NSkipped, results.skipped])
  if (results.todo > 0) parts.push([ProgressGui.NTodo, results.todo])
  if (parts.length === 0) return ""
  const result: LocalisedString = [""]
  for (const [i, part] of ipairs(parts)) {
    if (i > 1) result.push(", ")
    result.push(part)
  }
  return result
}

function updateTestCounts(gui: TestGui, results: TestRunResults) {
  gui.progressBar.value = gui.totalTests === 0 ? 1 : results.ran / gui.totalTests
  gui.progressLabel.caption = ["", results.ran, "/", gui.totalTests]
  gui.testSummary.caption = buildTestSummary(results)
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
    case "stepPaused": {
      gui.stepLabel.caption = [ProgressGui.StepPaused, event.caption]
      gui.stepBar.visible = true
      // Freeze the world while we wait, so what you are looking at is the state at the
      // step boundary and not whatever it drifted into while you were reading.
      game.tick_paused = true
      break
    }
    case "stepResumed": {
      gui.stepBar.visible = false
      break
    }
    case "testRunFinished": {
      gui.stepBar.visible = false
      const statusLocale =
        state.results.status == "passed"
          ? ProgressGui.TestsPassed
          : state.results.status == "todo"
            ? ProgressGui.TestsPassedWithTodo
            : ProgressGui.TestsFailed

      gui.statusText.caption = [statusLocale]
      gui.actionButton.caption = [ConfigGui.RerunTests]
      gui.actionButton.tags = { modName: "factorio-test", on_gui_click: Misc.RunTests }
      break
    }
    case "testRunCancelled": {
      gui.stepBar.visible = false
      gui.statusText.caption = [ProgressGui.TestsCancelled]
      gui.actionButton.caption = [ConfigGui.RerunTests]
      gui.actionButton.tags = { modName: "factorio-test", on_gui_click: Misc.RunTests }
      break
    }
    case "loadError": {
      gui.stepBar.visible = false
      gui.statusText.caption = [ProgressGui.LoadError]
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
