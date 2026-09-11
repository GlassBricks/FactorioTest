/** @noSelfInFile */
import { TestStage } from "../constants"
import { testStorage } from "./storage"

export const onTestStageChanged = script.generate_event_name<{ stage: TestStage }>()

export function getGlobalTestStage(): TestStage {
  return testStorage().testStage ?? TestStage.NotRun
}

export function setGlobalTestStage(stage: TestStage): void {
  testStorage().testStage = stage
  script.raise_event(onTestStageChanged, { stage })
}
