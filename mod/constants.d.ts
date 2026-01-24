export const enum Remote {
  TestsAvailableFor = "factorio-test-tests-available-for-",
  FactorioTest = "factorio-test",
}

export const enum Prototypes {
  TestTubeSprite = "factorio-test-test-tube-sprite",
  TestOutputBoxStyle = "factorio-test-test-output-box-style",
}

export const enum Settings {
  ModToTest = "factorio-test-mod-to-test",
  AutoStart = "factorio-test-auto-start",
  Config = "factorio-test-config",
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
    RunTests = "factorio-test.config-gui.run-tests",
    RerunTests = "factorio-test.config-gui.rerun-tests",
  }

  export const enum ProgressGui {
    Title = "factorio-test.progress-gui.title",
    RunningTest = "factorio-test.progress-gui.running-test",
    NPassed = "factorio-test.progress-gui.n-passed",
    NFailed = "factorio-test.progress-gui.n-failed",
    NErrors = "factorio-test.progress-gui.n-errors",
    NSkipped = "factorio-test.progress-gui.n-skipped",
    NTodo = "factorio-test.progress-gui.n-todo",
    TestsPassed = "factorio-test.progress-gui.tests-passed",
    TestsFailed = "factorio-test.progress-gui.tests-failed",
    TestsPassedWithTodo = "factorio-test.progress-gui.tests-passed-with-todo",
    LoadError = "factorio-test.progress-gui.load-error",
  }
}

export const enum TestStage {
  NotRun = "NotRun",
  Ready = "Ready",
  Running = "Running",
  ReloadingMods = "ReloadingMods",
  LoadError = "LoadError",
  Finished = "Finished",
}

export const enum Misc {
  CloseTestGui = "close-test-gui",
  RunTests = "start-tests",
  TestGui = "factorio-test-test-gui",
}
