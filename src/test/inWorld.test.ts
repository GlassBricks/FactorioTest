import { test_area } from "../testUtil/areas"

test("inWorld", () => {
  const [surface, area] = test_area(1, "Test1")
  const chest = surface.find_entities_filtered({
    area,
    name: "steel-chest",
  })[0]
  assert.equal(0, chest.get_inventory(defines.inventory.chest)!.get_item_count("iron-plate"))
  async()
  after_ticks(150, () => {
    assert.equal(5, chest.get_inventory(defines.inventory.chest)!.get_item_count("iron-plate"))
    done()
  })
})
