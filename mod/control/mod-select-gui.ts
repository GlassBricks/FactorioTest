import * as modGui from "mod-gui"
import {Locale, Prototypes, Remote, Settings, TestStage} from "../constants"
import {guiAction} from "./guiAction"
import {postLoadAction} from "./post-load-action"
import {
    ButtonGuiElement,
    CustomEventId,
    DropDownGuiElement,
    FrameGuiElement,
    LocalisedString,
    LuaGuiElement,
    LuaPlayer,
    OnGuiTextChangedEvent,
    SpriteButtonGuiElement,
    TextFieldGuiElement
} from "factorio:runtime"
import ConfigGui = Locale.ConfigGui

const ModSelectGuiName = "factorio-test:mod-select"
const ModSelectWidth = 150

const thisModName = script.mod_name

// there can only be one mod select gui
declare const global: {
    modSelectGui?: {
        player: LuaPlayer
        mainFrame: FrameGuiElement
        modSelect: DropDownGuiElement
        refreshButton: SpriteButtonGuiElement
        modTextField: TextFieldGuiElement | undefined
        runButton: ButtonGuiElement
    }
}

function modSelectGuiValid(): boolean {
    return global.modSelectGui?.mainFrame?.valid ?? false
}

function getModDropdownItems(): LocalisedString[] {
    const mods = Object.keys(script.active_mods).filter((mod) => remote.interfaces[Remote.TestsAvailableFor + mod])
    return [[ConfigGui.NoMod], ...mods, [ConfigGui.OtherMod]]
}

function TitleBar(parent: FrameGuiElement, title: LocalisedString) {
    const titleBar = parent.add({
        type: "flow",
        direction: "horizontal",
    })
    titleBar.drag_target = parent

    const style = titleBar.style
    style.horizontal_spacing = 8
    style.height = 28
    titleBar.add({
        type: "label",
        caption: title,
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
    // close button
    {
        titleBar.add({
            type: "sprite-button",
            style: "frame_action_button",
            sprite: "utility/close_white",
            hovered_sprite: "utility/close_black",
            clicked_sprite: "utility/close_black",
            tooltip: ["gui.close"],
            mouse_button_filter: ["left"],
            tags: {
                modName: thisModName,
                on_gui_click: DestroyConfigGui,
            },
        })
    }
}

function setTestMod(mod: string) {
    settings.global[Settings.ModToTest] = {value: mod}
    updateConfigGui()
}

function getTestMod(): string {
    return settings.global[Settings.ModToTest]!.value as string
}

function ModSelect(parent: LuaGuiElement) {
    const mainFlow = parent.add({
        type: "flow",
        direction: "horizontal",
    })
    mainFlow.add({
        type: "label",
        style: "caption_label",
        caption: [ConfigGui.LoadTestsFor],
    })

    const selectFlow = mainFlow.add({
        type: "flow",
        direction: "vertical",
    })

    const modSelectItems = getModDropdownItems()

    const modSelect = selectFlow.add({
        type: "drop-down",
        items: modSelectItems,
        tags: {
            modName: thisModName,
            on_gui_selection_state_changed: OnModSelectionChanged,
        },
    })
    modSelect.style.minimal_width = ModSelectWidth

    const configGui = global.modSelectGui!
    configGui.modSelect = modSelect

    configGui.refreshButton = mainFlow.add({
        type: "sprite-button",
        style: "tool_button",
        sprite: "utility/refresh",
        tooltip: [ConfigGui.ReloadMods],
        tags: {
            modName: thisModName,
            on_gui_click: ReloadMods,
        },
    })

    let modSelectedIndex: number
    const testMod = getTestMod()
    if (testMod === "") {
        modSelectedIndex = 1
    } else {
        const foundIndex = modSelectItems.indexOf(testMod)
        if (foundIndex !== -1) {
            modSelectedIndex = foundIndex + 1
        } else {
            modSelectedIndex = modSelectItems.length
        }
    }
    modSelect.items = modSelectItems
    modSelect.selected_index = modSelectedIndex
    let modTextField: TextFieldGuiElement | undefined
    if (modSelectedIndex === modSelectItems.length) {
        modTextField = createModTextField()
        modTextField.text = testMod
    }
}

const OnModSelectionChanged = guiAction("OnModSelectionChanged", () => {
    const {modSelect} = global.modSelectGui!
    const modSelectItems = modSelect.items

    const selectedIndex = modSelect.selected_index
    const selected = modSelectItems[selectedIndex - 1]

    let selectedMod: string
    let isOther = false
    if (typeof selected === "string") {
        selectedMod = selected
    } else if (selectedIndex === 1) {
        selectedMod = ""
    } else {
        isOther = true
        selectedMod = ""
    }
    if (isOther) {
        createModTextField()
    } else {
        destroyModTextField()
    }
    setTestMod(selectedMod)
})

function createModTextField(): TextFieldGuiElement {
    if (global.modSelectGui!.modTextField?.valid) {
        return global.modSelectGui!.modTextField
    }
    const modSelect = global.modSelectGui!.modSelect
    const textfield = modSelect.parent!.add({
        type: "textfield",
        lose_focus_on_confirm: true,
        tags: {
            modName: thisModName,
            on_gui_text_changed: OnModTextfieldChanged,
        },
        index: 2,
    })
    textfield.style.width = ModSelectWidth

    global.modSelectGui!.modTextField = textfield
    return textfield
}

const OnModTextfieldChanged = guiAction("OnModTextfieldChanged", (e: OnGuiTextChangedEvent) => {
    const element = e.element as TextFieldGuiElement
    setTestMod(element.text)
})

function destroyModTextField() {
    const configGui = global.modSelectGui!
    if (!configGui.modTextField) return
    configGui.modTextField.destroy()
    configGui.modTextField = undefined
}

const refreshAfterLoad = postLoadAction("afterRefresh", refreshConfigGui)
const ReloadMods = guiAction("refresh", () => {
    game.reload_mods()
    refreshAfterLoad()
})

const callRunTests = postLoadAction("runTests", () => {
    if (!remote.interfaces[Remote.FactorioTest]) {
        game.print([ConfigGui.ModNotRegisteredTests])
        return
    }
    remote.call(Remote.FactorioTest, "runTests")
    updateConfigGui()
})

const RunTests = guiAction("startTests", () => {
    game.reload_mods()
    game.auto_save("beforeTest")
    callRunTests()
})

function TestStageBar(parent: LuaGuiElement) {
    const configGui = global.modSelectGui!

    const mainFlow = parent.add({
        type: "flow",
        direction: "vertical",
    })

    const buttonFlow = mainFlow.add({
        type: "flow",
        direction: "horizontal",
    })

    buttonFlow.add({
        type: "empty-widget",
    }).style.horizontally_stretchable = true

    configGui.runButton = buttonFlow.add({
        type: "button",
        name: "runTests",
        style: "green_button",
        caption: [ConfigGui.RunTests],
        tags: {modName: thisModName, on_gui_click: RunTests},
    })
}

function updateConfigGui() {
    if (!modSelectGuiValid()) return
    const configGui = global.modSelectGui!

    const testModIsRegistered = remote.interfaces[Remote.TestsAvailableFor + getTestMod()] !== undefined
    const testModLoaded =
        remote.interfaces[Remote.FactorioTest] !== undefined && remote.call(Remote.FactorioTest, "modName") === getTestMod()
    const stage = testModLoaded ? (remote.call(Remote.FactorioTest, "getTestStage") as TestStage) : undefined

    const running = stage === TestStage.Running || stage === TestStage.ReloadingMods

    configGui.modSelect.enabled = !running
    configGui.refreshButton.enabled = !running

    configGui.runButton.enabled = testModIsRegistered && !running
    configGui.runButton.tooltip = testModIsRegistered ? "" : [ConfigGui.ModNotRegisteredTests]
}

script.on_load(() => {
    const remoteExits = remote.interfaces[Remote.FactorioTest]?.onTestStageChanged
    if (remoteExits) {
        const eventId = remote.call(Remote.FactorioTest, "onTestStageChanged") as CustomEventId<object>
        script.on_event(eventId, updateConfigGui)
    }
})

function createConfigGui(player: LuaPlayer): FrameGuiElement | undefined {
    if (game.is_multiplayer()) {
        game.print("Cannot run tests in multiplayer")
        return undefined
    }
    player.gui.screen[ModSelectGuiName]?.destroy()
    global.modSelectGui = {player} as typeof global.modSelectGui

    const frame = player.gui.screen.add({
        type: "frame",
        name: ModSelectGuiName,
        direction: "vertical",
    })
    frame.auto_center = true

    global.modSelectGui!.mainFrame = frame

    TitleBar(frame, [ConfigGui.Title])
    ModSelect(frame)
    TestStageBar(frame)
    updateConfigGui()
    return frame
}

function destroyConfigGui() {
    if (!modSelectGuiValid()) return
    const configGui = global.modSelectGui!
    global.modSelectGui = undefined
    const element = configGui.player.gui.screen[ModSelectGuiName]
    if (element && element.valid) {
        element.destroy()
    }
}

const DestroyConfigGui = guiAction("destroyConfigGui", destroyConfigGui)

const CreateConfigGui = guiAction("createConfigGui", (e) => {
    if (modSelectGuiValid()) {
        destroyConfigGui()
    }
    createConfigGui(game.players[e.player_index]!)
})

function createModButton(player: LuaPlayer) {
    const flow = modGui.get_button_flow(player)
    flow[ModSelectGuiName]?.destroy()
    flow.add({
        type: "sprite-button",
        name: ModSelectGuiName,
        style: modGui.button_style,
        sprite: Prototypes.TestTubeSprite,
        tooltip: [Locale.FactorioTest.Tests],
        tags: {
            modName: thisModName,
            on_gui_click: CreateConfigGui,
        },
    })
}

function refreshConfigGui() {
    if (!modSelectGuiValid()) return
    const previousPlayer = global.modSelectGui!.player
    destroyConfigGui()
    createConfigGui(previousPlayer)?.bring_to_front()
}

function createModButtonForAllPlayers() {
    for (const [, player] of pairs(game.players)) {
        createModButton(player)
    }
}

script.on_init(createModButtonForAllPlayers)
script.on_configuration_changed(() => {
    createModButtonForAllPlayers()
    refreshConfigGui()
})
script.on_event([defines.events.on_player_created], (e) => createModButton(game.players[e.player_index]!))
