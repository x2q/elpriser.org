import XCTest
@testable import Elpriser

/// The text catalogue as the app reads it: the .lproj folders compiled into the app bundle from Localizable.xcstrings, which
/// scripts/i18n/build.mjs generates from i18n/. Every test names its language; none reads the simulator's.
final class L10nTests: XCTestCase {
    override func tearDown() {
        L10n.language = nil
        super.tearDown()
    }

    // MARK: what the catalogue contains

    /// The codes of Resources/localizations.json, in order.
    private static let codes: [String] = (Repo.json("ElpriserIOS/Resources/localizations.json") as! [String: Any])["languages"] as! [String]

    private struct CatalogueKey { let name: String; let kind: Kind; enum Kind { case string, plural, array } }

    /// The iOS keys of i18n/keys.json, with the kind each has in the source text (da.json): a string, plural forms, or an array.
    private static let keys: [CatalogueKey] = {
        let layout = Repo.json("i18n/keys.json") as! [String: Any]
        let da = Repo.json("i18n/strings/da.json") as! [String: Any]
        var out: [CatalogueKey] = []
        for g in layout["groups"] as! [[String: Any]] {
            for k in g["keys"] as! [[String: Any]] {
                if let p = k["platforms"] as? [String], !p.contains("ios") { continue }
                let name = k["key"] as! String
                if name == "location_usage" { continue }  // lives in InfoPlist.xcstrings, tested below
                switch da[name] {
                case is [String: Any]: out.append(CatalogueKey(name: name, kind: .plural))
                case is [Any]: out.append(CatalogueKey(name: name, kind: .array))
                default: out.append(CatalogueKey(name: name, kind: .string))
                }
            }
        }
        return out
    }()

    /// "no" is an alias of nb in the catalogue; Xcode compiles no .lproj for it. The app picks nb on a Norwegian phone.
    private static let withoutLproj: Set<String> = ["no"]
    private static var compiled: [String] { codes.filter { !withoutLproj.contains($0) } }

    private func placeholders(_ s: String) -> Set<String> {
        let re = try! NSRegularExpression(pattern: "%(\\d+)\\$(@|lld)")
        return Set(re.matches(in: s, range: NSRange(s.startIndex..., in: s)).map { String(s[Range($0.range, in: s)!]) })
    }

    /// The plural forms a translator wrote (nn and no are written as nb, sr-Latn as sr).
    private func sourceForms(_ lang: String, _ key: String) -> [String: String] {
        let file = ["nn": "nb", "no": "nb", "sr-Latn": "sr"][lang] ?? lang
        return ((Repo.json("i18n/strings/\(file).json") as! [String: Any])[key] as? [String: String]) ?? [:]
    }

    func testTheCatalogueHasTheKeysTheSourcesUse() {
        XCTAssertGreaterThan(Self.keys.count, 150)
        XCTAssertEqual(Self.keys.filter { $0.kind == .array }.map(\.name), ["weekdays_long", "weekdays_short", "months_short"])
        XCTAssertEqual(Self.keys.filter { $0.kind == .plural }.map(\.name), ["devices_active", "hours_count"])
        XCTAssertEqual(Self.codes.count, 29)
    }

    // MARK: every language, every key

    func testEveryShippedLanguageIsCompiledIntoTheBundle() {
        for c in Self.compiled {
            L10n.language = c
            XCTAssertEqual(L10n.code, c, "\(c).lproj is in the app bundle and is the one used")
        }
        XCTAssertEqual(Self.compiled.count, 28)
    }

    func testEveryKeyResolvesToARealTextInEveryLanguage() {
        for lang in Self.compiled {
            L10n.language = lang
            for k in Self.keys {
                switch k.kind {
                case .string:
                    XCTAssertTrue(L10n.defines(k.name), "\(lang): \(k.name) is missing")
                    XCTAssertNotEqual(L10n.raw(k.name), k.name, "\(lang): \(k.name) resolves to the key itself")
                    XCTAssertFalse(L10n.raw(k.name).isEmpty, "\(lang): \(k.name) is empty")
                case .plural:
                    XCTAssertTrue(L10n.defines(k.name), "\(lang): \(k.name) has no plural forms")
                case .array:
                    for i in 0..<(k.name == "months_short" ? 12 : 7) {
                        XCTAssertTrue(L10n.defines("\(k.name)_\(i)"), "\(lang): \(k.name)_\(i) is missing")
                    }
                }
            }
        }
    }

    func testPlaceholdersAreTheSameAsInEnglishAndFormatCleanly() {
        L10n.language = "en"
        var english: [String: Set<String>] = [:]
        for k in Self.keys where k.kind == .string { english[k.name] = placeholders(L10n.raw(k.name)) }
        for lang in Self.compiled {
            L10n.language = lang
            for k in Self.keys where k.kind == .string {
                let raw = L10n.raw(k.name)
                XCTAssertEqual(placeholders(raw), english[k.name], "\(lang): \(k.name) — \(raw)")
                // fill every placeholder and see that nothing is left over: a stray % would show on screen
                let n = (english[k.name] ?? []).count
                var args: [CVarArg] = []
                for i in 1...max(n, 1) where n > 0 {
                    args.append((english[k.name] ?? []).contains("%\(i)$lld") ? 7 as Int : "ARG\(i)" as String)
                }
                let text: String
                switch args.count {
                case 0: text = L10n.string(k.name)
                case 1: text = L10n.string(k.name, args[0])
                case 2: text = L10n.string(k.name, args[0], args[1])
                default: text = L10n.string(k.name, args[0], args[1], args[2])
                }
                XCTAssertFalse(text.contains("%1$") || text.contains("%2$") || text.contains("%3$") || text.contains("(null)"), "\(lang): \(k.name) — \(text)")
                if k.name != "part_vat" { XCTAssertFalse(text.contains("%"), "\(lang): \(k.name) — \(text)") }
            }
        }
    }

    func testPluralFormsOnlyUseTheCountOrNothing() {
        for lang in Self.compiled {
            L10n.language = lang
            for k in Self.keys where k.kind == .plural {
                for n in [0, 1, 2, 3, 5, 11, 21, 22, 25, 100] {
                    let text = L10n.plural(k.name, n)
                    XCTAssertFalse(text.contains("%"), "\(lang) \(k.name) \(n): \(text)")
                    XCTAssertNotEqual(text, k.name, "\(lang) \(k.name) \(n)")
                }
            }
        }
    }

    func testArraysHaveSevenSevenAndTwelveItems() {
        for lang in Self.compiled {
            L10n.language = lang
            let long = L10n.array("weekdays_long"), short = L10n.array("weekdays_short"), months = L10n.array("months_short")
            XCTAssertEqual(long.count, 7, lang)
            XCTAssertEqual(short.count, 7, lang)
            XCTAssertEqual(months.count, 12, lang)
            for a in [long, short, months] {
                XCTAssertFalse(a.contains(where: \.isEmpty), lang)
                XCTAssertEqual(Set(a).count, a.count, "\(lang): no two days or months are written alike")
            }
        }
        L10n.language = "en"
        XCTAssertEqual(L10n.array("weekdays_long").first, "Sunday")
        XCTAssertEqual(L10n.array("months_short").first, "Jan")
        XCTAssertTrue(L10n.array("no_such_array").isEmpty)
    }

    // MARK: plurals

    /// CLDR integer plural categories for counts 0, 1, 2, 3, 5, 11, 21, 22, 25, 100: written out by hand from the CLDR rules.
    private let counts = [0, 1, 2, 3, 5, 11, 21, 22, 25, 100]
    private var expected: [String: [String]] {
        let one1 = ["other", "one", "other", "other", "other", "other", "other", "other", "other", "other"]
        return [
            "pl": ["many", "one", "few", "few", "many", "many", "many", "few", "many", "many"],
            "ro": ["few", "one", "few", "few", "few", "few", "other", "other", "other", "other"],
            "lt": ["other", "one", "few", "few", "few", "other", "one", "few", "few", "other"],
            "lv": ["zero", "one", "other", "other", "other", "zero", "one", "other", "other", "zero"],
            "sl": ["other", "one", "two", "few", "other", "other", "other", "other", "other", "other"],
            "hr": ["other", "one", "few", "few", "other", "other", "one", "few", "other", "other"],
            "sr": ["other", "one", "few", "few", "other", "other", "one", "few", "other", "other"],
            "sr-Latn": ["other", "one", "few", "few", "other", "other", "one", "few", "other", "other"],
            "cs": ["other", "one", "few", "few", "other", "other", "other", "other", "other", "other"],
            "sk": ["other", "one", "few", "few", "other", "other", "other", "other", "other", "other"],
            "fr": ["one", "one", "other", "other", "other", "other", "other", "other", "other", "other"],
            "mk": ["other", "one", "other", "other", "other", "other", "one", "other", "other", "other"],
            "da": one1, "en": one1, "de": one1, "nl": one1, "sv": one1, "nb": one1, "nn": one1, "no": one1, "fi": one1, "it": one1,
            "es": one1, "pt": one1, "el": one1, "bg": one1, "hu": one1, "et": one1, "sq": one1,
        ]
    }

    func testPluralCategoriesAgreeWithCLDRForEveryLanguage() {
        for code in Self.codes {
            let table = try! XCTUnwrap(expected[code], code)
            XCTAssertEqual(counts.map { L10n.pluralCategory(code, $0) }, table, code)
        }
        XCTAssertEqual(L10n.pluralCategory("sr-Latn", 22), "few")
        XCTAssertEqual(L10n.pluralCategory("pl", -2), "few", "the sign does not matter")
    }

    func testPluralCategoriesStayInsideTheOnesLanguagesJsonListsForTheApp() {
        let langs = (Repo.json("i18n/languages.json") as! [String: Any])["languages"] as! [[String: Any]]
        for l in langs {
            let code = l["code"] as! String, allowed = Set(l["plural"] as! [String])
            for n in 0...1100 {
                XCTAssertTrue(allowed.contains(L10n.pluralCategory(code, n)), "\(code) \(n) -> \(L10n.pluralCategory(code, n)), allowed \(allowed)")
            }
        }
    }

    func testPluralTextIsTheFormOfTheRightCategoryInEveryLanguage() throws {
        for lang in Self.compiled {
            L10n.language = lang
            for key in ["hours_count", "devices_active"] {
                // sr-Latn is the generator's transliteration of the Cyrillic source: only the forms' shape is checked there
                if lang == "sr-Latn" { continue }
                let forms = sourceForms(lang, key)
                XCTAssertFalse(forms.isEmpty, "\(lang) \(key)")
                for n in counts {
                    let want = (forms[L10n.pluralCategory(lang, n)] ?? forms["other"]!).replacingOccurrences(of: "%1$d", with: String(n))
                    XCTAssertEqual(L10n.plural(key, n), want, "\(lang) \(key) \(n)")
                }
            }
        }
    }

    func testPolishHoursReadRight() {
        L10n.language = "pl"
        XCTAssertEqual(L10n.plural("hours_count", 1), "1 godzina")
        XCTAssertEqual(L10n.plural("hours_count", 2), "2 godziny")
        XCTAssertEqual(L10n.plural("hours_count", 5), "5 godzin")
        XCTAssertEqual(L10n.plural("hours_count", 12), "12 godzin")
        XCTAssertEqual(L10n.plural("hours_count", 22), "22 godziny")
    }

    func testDanishPluralsAreTheOnesTheAppAlwaysHad() {
        L10n.language = "da"
        XCTAssertEqual(L10n.plural("hours_count", 1), "1 time")
        XCTAssertEqual(L10n.plural("hours_count", 3), "3 timer")
        XCTAssertEqual(L10n.plural("devices_active", 1), "1 enhed aktiv")
        XCTAssertEqual(L10n.plural("devices_active", 2), "2 enheder aktive")
        XCTAssertEqual(L10n.plural("devices_active", 0), "0 enheder aktive")
    }

    // MARK: lookup rules

    func testFormatsAreFilledByPosition() {
        L10n.language = "da"
        XCTAssertEqual(L10n.string("tooltip", "I dag", "19", "3,90 kr/kWh"), "I dag kl. 19 · 3,90 kr/kWh")
        XCTAssertEqual(L10n.string("part_vat", 25), "Moms (25 %)")
        XCTAssertEqual(L10n.string("date_day_month", 17, "okt"), "17. okt")
        L10n.language = "en"
        XCTAssertEqual(L10n.string("tooltip", "Today", "19", "12.3 ct/kWh"), "Today at 19:00 · 12.3 ct/kWh")
        L10n.language = "de"
        XCTAssertEqual(L10n.string("part_vat", 19), "MwSt. (19 %)")
    }

    func testAnUnknownLanguageFallsBackToEnglishAndAnUnknownKeyToItself() {
        L10n.language = "ja"
        XCTAssertEqual(L10n.code, "en")
        XCTAssertEqual(L10n.string("nav_price"), "Price")
        L10n.language = "pt-BR"
        XCTAssertEqual(L10n.code, "pt")
        L10n.language = "sr-Latn"
        XCTAssertEqual(L10n.code, "sr-Latn")
        L10n.language = "da"
        XCTAssertEqual(L10n.string("no_such_key"), "no_such_key")
        XCTAssertFalse(L10n.has("no_such_key"))
        XCTAssertTrue(L10n.has("nav_price"))
    }

    func testTheDeviceLanguageIsPickedAmongTheCompiledOnes() {
        let available = Bundle.main.localizations
        func pick(_ prefs: [String]) -> String? { Bundle.preferredLocalizations(from: available, forPreferences: prefs).first }
        XCTAssertEqual(pick(["da-DK"]), "da")
        XCTAssertEqual(pick(["de-DE", "en-US"]), "de")
        XCTAssertEqual(pick(["nb-NO"]), "nb")
        XCTAssertEqual(pick(["nn-NO"]), "nn")
        XCTAssertEqual(pick(["pl-PL"]), "pl")
        XCTAssertEqual(pick(["pt-PT"]), "pt")
        XCTAssertEqual(pick(["en-GB"]), "en")
        XCTAssertEqual(pick(["ja-JP", "en-US"]), "en", "Japanese is not shipped: the next language, else English")
        XCTAssertEqual(pick(["ja-JP"])?.lowercased(), "en", "no language of the list at all: the development language, English")
    }

    // MARK: the bundle

    func testInfoPlistListsTheShippedLanguagesAndEnglishIsTheDevelopmentRegion() {
        // read from the built Info.plist (a bare `no` in project.yml once became a YAML boolean here)
        let plist = NSDictionary(contentsOfFile: Bundle(for: AppModel.self).bundlePath + "/Info.plist")
        let listed = plist?["CFBundleLocalizations"] as? [String]
        XCTAssertEqual(listed, Self.codes, "project.yml CFBundleLocalizations equals Resources/localizations.json")
        XCTAssertEqual(Bundle.main.developmentLocalization, "en")
        XCTAssertEqual((Repo.json("ElpriserIOS/Resources/localizations.json") as! [String: Any])["development"] as? String, "en")
    }

    func testThePermissionTextIsLocalizedAndTheBaseTextIsEnglish() throws {
        let key = "NSLocationWhenInUseUsageDescription"
        let base = try XCTUnwrap(Bundle.main.object(forInfoDictionaryKey: key) as? String)
        XCTAssertTrue(base.hasPrefix("Elpriser uses your position once"), base)
        for (lang, start) in [("da", "Elpriser bruger din position"), ("de", "Elpriser verwendet den Standort"), ("pl", "Elpriser używa"), ("fr", "Elpriser utilise")] {
            let path = Bundle.main.bundlePath + "/\(lang).lproj/InfoPlist.strings"
            let d = try XCTUnwrap(NSDictionary(contentsOfFile: path) as? [String: String], lang)
            XCTAssertTrue(d[key]?.hasPrefix(start) ?? false, "\(lang): \(d[key] ?? "nil")")
        }
        for lang in Self.compiled {
            let d = NSDictionary(contentsOfFile: Bundle.main.bundlePath + "/\(lang).lproj/InfoPlist.strings") as? [String: String]
            XCTAssertNotNil(d?[key], "\(lang) has the permission text")
        }
    }
}
