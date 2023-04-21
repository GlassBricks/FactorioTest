import { Data } from "typed-factorio/data/types"
import { Prototypes } from "./constants"

declare const data: Data

data.extend([
  {
    type: "sprite",
    name: Prototypes.TestTubeSprite,
    filename: "__factorio-test__/graphics/test-tube.png",
    priority: "extra-high-no-scale",
    size: 48,
  },
])

data.raw["gui-style"]!.default[Prototypes.TestOutputBoxStyle] = {
  type: "textbox_style",
  minimal_width: 0,
  natural_width: 1000,
  maximal_width: 1000,
  horizontally_stretchable: "on",
  default_background: {},
  font_color: [1, 1, 1],
  font: "factorio-test-mono",
}

data.extend([
  {
    type: "font",
    name: "factorio-test-mono",
    from: "default-mono",
    size: 14,
    spacing: -0.5,
  },
])
