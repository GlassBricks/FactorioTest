import { isHeadlessMode } from "../factorio-test/auto-start-config"

if (!isHeadlessMode()) {
  script.on_nth_tick(1, () => helpers.recv_udp())
  script.on_event(defines.events.on_udp_packet_received, (event) => {
    if (event.payload !== "rerun") return
    game.reload_mods()
  })
}
