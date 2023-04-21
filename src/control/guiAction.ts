export type GuiAction = string & { _guiActionBrand: unknown }
type FilterByGui<T> = T extends `on_gui_${string}` ? T : never
type GuiEvents = (typeof defines.events)[FilterByGui<keyof typeof defines.events>]["_eventData"]

const guiActions: Record<GuiAction, (this: void, event: any) => void> = {}
export function guiAction<T extends GuiEvents>(name: string, func: (this: void, data: T) => void): GuiAction {
  if (name in guiActions) {
    error(`Duplicate guiAction ${name}`)
  }
  guiActions[name as GuiAction] = func
  return name as GuiAction
}

const modName = script.mod_name
const events = ["on_gui_click", "on_gui_selection_state_changed", "on_gui_text_changed"] as const
for (const eventName of events) {
  script.on_event(defines.events[eventName], (e) => {
    const element = e.element
    if (!element) return
    const tags = element.tags
    if (tags.modName !== modName) return
    const method = tags[eventName]
    if (!method) return
    guiActions[method as GuiAction]!(e)
  })
}
