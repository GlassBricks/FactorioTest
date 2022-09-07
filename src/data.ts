import { Data } from "typed-factorio/data/types"
import { Graphics } from "./constants"
import { Prototypes } from "./shared-constants"

declare const data: Data

data.extend([
  {
    type: "sprite",
    name: Prototypes.TestTubeSprite,
    filename: Graphics.TestTube,
    priority: "extra-high-no-scale",
    size: 48,
  },
])

data.raw["gui-style"]!["default"]![Prototypes.TestOutputBoxStyle] = {
  type: "textbox_style",
  minimal_width: 0,
  natural_width: 1000,
  maximal_width: 1000,
  horizontally_stretchable: "on",
  default_background: {},
  font_color: [1, 1, 1],
}
