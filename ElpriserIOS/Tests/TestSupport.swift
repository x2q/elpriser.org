import XCTest
@testable import Elpriser

/// A test that does not depend on the simulator's language, region or zone: texts and numbers are Danish (the language the
/// first 75 tests were written in) and the clock is Copenhagen's. Tests of other languages set `L10n.language` themselves;
/// tearDown puts everything back.
class DanishTestCase: XCTestCase {
    override func setUp() {
        super.setUp()
        L10n.language = "da"
        Clock.zone = Clock.copenhagen
    }

    override func tearDown() {
        L10n.language = nil
        Clock.zone = Clock.copenhagen
        super.tearDown()
    }
}

/// The repository's files the tests compare against, found from this file's own path (…/ElpriserIOS/Tests/TestSupport.swift).
enum Repo {
    static let root: URL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()

    static func json(_ relative: String) -> Any {
        let data = try! Data(contentsOf: root.appendingPathComponent(relative))
        return try! JSONSerialization.jsonObject(with: data)
    }
}

/// A settings object on an empty, throw-away store with a chosen device locale: no test reads or writes the app's own defaults.
func makeSettings(locale: String = "da_DK", _ prepare: (UserDefaults) -> Void = { _ in }) -> Settings {
    let name = "elpriser-test-\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: name)!
    defaults.removePersistentDomain(forName: name)
    prepare(defaults)
    return Settings(defaults: defaults, locale: Locale(identifier: locale))
}
