export const enum Remote {
  TestsAvailableFor = "factorio-test-tests-available-for-",
  FactorioTest = "factorio-test",
}

export const enum Prototypes {
  TestTubeSprite = "factorio-test:test-tube-sprite",
  TestOutputBoxStyle = "factorio-test:test-output-box-style",
}

export namespace Locale {
  export const enum FactorioTest {
    Tests = "factorio-test.tests",
  }
  export const enum ConfigGui {
    Title = "factorio-test.config-gui.title",
    LoadTestsFor = "factorio-test.config-gui.load-tests-for",
    NoMod = "factorio-test.config-gui.none",
    OtherMod = "factorio-test.config-gui.other",
    ReloadMods = "factorio-test.config-gui.reload-mods",
    ModNotRegisteredTests = "factorio-test.config-gui.mod-not-registered",
    TestsNotRun = "factorio-test.config-gui.tests-not-run",
    TestsRunning = "factorio-test.config-gui.tests-running",
    TestsFinished = "factorio-test.config-gui.tests-finished",
    TestsLoadError = "factorio-test.config-gui.tests-load-error",
    RunTests = "factorio-test.config-gui.run-tests",
  }
  export const enum ProgressGui {
    Title = "factorio-test.progress-gui.title",
    TitleRerun = "factorio-test.progress-gui.title-rerun",
    RunningTest = "factorio-test.progress-gui.running-test",
    NPassed = "factorio-test.progress-gui.n-passed",
    NFailed = "factorio-test.progress-gui.n-failed",
    NErrors = "factorio-test.progress-gui.n-errors",
    NSkipped = "factorio-test.progress-gui.n-skipped",
    NTodo = "factorio-test.progress-gui.n-todo",
    TestsFinished = "factorio-test.progress-gui.tests-finished",
    TestsFinishedRerun = "factorio-test.progress-gui.tests-finished-rerun",
    LoadError = "factorio-test.progress-gui.load-error",
  }
}

export const enum TestStage {
  NotRun = "NotRun",
  Ready = "Ready",
  Running = "Running",
  ToReload = "ToReload",
  LoadError = "LoadError",
  Finished = "Finished",
}

export const enum Misc {
  CloseProgressGui = "close-progress-gui",
  TestProgressGui = "factorio-test:test-progress",
}
