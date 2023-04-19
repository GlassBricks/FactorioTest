// a hacky way to send an event that will only fire at a later time --
// after game.reload_mods(), and won't be present in game.auto_save() fired on the same tick

const lsId = "factorio-test.fake-translation"
function fireFakeTranslation(data: string) {
  const ls: LocalisedString = [lsId, data]
  for (const player of game.connected_players) {
    if (player.request_translation(ls)) return
  }
  error("No connected players found to raise fake translation event. Please report this to the mod author")
}

const loadEvents: Record<string, () => void> = {}
export function postLoadAction(name: string, func: () => void): () => void {
  if (name in loadEvents) error(`duplicate load event name ${name}`)
  loadEvents[name] = func
  return () => {
    fireFakeTranslation(name)
  }
}

script.on_event(defines.events.on_string_translated, (data) => {
  const ls = data.localised_string
  if (Array.isArray(ls) && ls[0] === lsId) {
    const action = ls[1] as string
    loadEvents[action]?.()
  }
})
