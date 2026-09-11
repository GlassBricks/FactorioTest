/** @noSelfInFile */
import { TestStage } from "../constants"
import type { ResumeData } from "./reload-resume"
import type { TestGui } from "./test-gui"

/**
 * This is injected into the mod under test and shares its `storage`;
 * keep everything under one namespaced key.
 */
export interface FactorioTestStorage {
  testStage?: TestStage
  resume?: ResumeData
  lastFailedTests?: LuaSet<string>
  gui?: TestGui
}

declare const storage: {
  __factorio_test?: FactorioTestStorage
}

export function testStorage(): FactorioTestStorage {
  return (storage.__factorio_test ??= {})
}
