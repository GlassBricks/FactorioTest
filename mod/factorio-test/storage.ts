/** @noSelfInFile */
import { TestStage } from "../constants"
import type { PersistedRunData } from "./state"
import type { TestGui } from "./test-gui"

/**
 * This is injected into the mod under test and shares its `storage`;
 * keep everything under one namespaced key.
 */
export interface FactorioTestStorage extends PersistedRunData {
  testStage?: TestStage
  gui?: TestGui
}

declare const storage: {
  __factorio_test?: FactorioTestStorage
}

export function testStorage(): FactorioTestStorage {
  return (storage.__factorio_test ??= {})
}
