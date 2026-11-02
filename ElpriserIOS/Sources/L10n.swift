import Foundation

/// The app's texts. They live in Resources/Localizable.xcstrings (generated from i18n/ by scripts/i18n/build.mjs) and are
/// read here from the compiled <lang>.lproj folders of a swappable bundle, so a unit test can ask for any language without
/// touching the simulator's settings, and so one lookup works the same for strings, plurals and the weekday/month tables.
///
///   L10n.string("tooltip", when, hour, price)      positional %1$@ / %2$lld formats, String(format:locale:)
///   L10n.plural("hours_count", 3)                  the CLDR category of the count picks the form
///   L10n.array("weekdays_long")                    weekdays_long_0 … _6
///
/// A key a language does not have falls back to English (the development language), then to the key itself.
enum L10n {
    private static let lock = NSLock()
    private static var languageOverride: String?
    private static var bundleOverride: Bundle = .main
    private static var tables: [String: Table] = [:]

    /// nil (the default): the device's language, as the system picked it among the app's localizations.
    /// A code ("da", "pl", "sr-Latn" …): that language, whatever the device says. Used by tests.
    static var language: String? {
        get { lock.lock(); defer { lock.unlock() }; return languageOverride }
        set { lock.lock(); languageOverride = newValue; tables = [:]; lock.unlock() }
    }

    /// Where the <lang>.lproj folders are: the app bundle.
    static var bundle: Bundle {
        get { lock.lock(); defer { lock.unlock() }; return bundleOverride }
        set { lock.lock(); bundleOverride = newValue; tables = [:]; lock.unlock() }
    }

    /// The language the texts come from: the override, else the bundle's best localization for the device, else English.
    /// Always one with an .lproj folder in the bundle ("pt-BR" -> "pt", "ja" -> "en").
    static var code: String {
        let wanted = language ?? bundle.preferredLocalizations.first ?? "en"
        return resolve(wanted)
    }

    private static func resolve(_ wanted: String) -> String {
        let candidates = [wanted, String(wanted.split(separator: "-").first ?? "en"), "en"]
        for c in candidates where FileManager.default.fileExists(atPath: bundle.bundlePath + "/\(c).lproj") { return c }
        return "en"
    }

    /// The locale of numbers and dates. The override's language when a test set one; otherwise the device's (language and
    /// region: English text on a German-region phone still writes 3,90).
    static var locale: Locale {
        if let l = language { return Locale(identifier: l) }
        return Locale.current
    }

    /// The locale of names the system supplies (countries): the language of the texts, so a phone in Japanese that shows
    /// the English fallback gets English country names, not a mix.
    static var textLocale: Locale { Locale(identifier: code) }

    // MARK: lookups

    static func string(_ key: String, _ args: CVarArg...) -> String { format(raw(key), args) }

    /// The form of `key` for `count` (CLDR category of the language), with `count` itself as the first argument.
    static func plural(_ key: String, _ count: Int, _ args: CVarArg...) -> String {
        let c = code
        let category = pluralCategory(c, count)
        var form: String?
        for t in [table(c), c == "en" ? nil : table("en")] {
            guard let forms = t?.plurals[key] else { continue }
            form = forms[category] ?? forms["other"] ?? forms.values.first
            break
        }
        guard let form else { return format(raw(key), [count] + args) }
        return format(form, [count] + args)
    }

    /// `key_0 … key_N`, as many as the catalogue has.
    static func array(_ key: String) -> [String] {
        var out: [String] = []
        while let s = lookup("\(key)_\(out.count)") { out.append(format(s, [])) }
        return out
    }

    /// Whether the language (or English) has the key at all.
    static func has(_ key: String) -> Bool { lookup(key) != nil }

    /// Whether the language's own table has the key (a string or a plural), without the English fallback.
    static func defines(_ key: String) -> Bool {
        guard let t = table(code) else { return false }
        return t.strings[key] != nil || t.plurals[key] != nil
    }

    /// The text without formatting: what a translator wrote, placeholders and all. Falls back to the key.
    static func raw(_ key: String) -> String { lookup(key) ?? key }

    private static func lookup(_ key: String) -> String? {
        let c = code
        if let s = table(c)?.strings[key] { return s }
        return c == "en" ? nil : table("en")?.strings[key]
    }

    private static func format(_ f: String, _ args: [CVarArg]) -> String {
        if args.isEmpty && !f.contains("%") { return f }
        return String(format: f, locale: locale, arguments: args)
    }

    // MARK: compiled tables

    private final class Table {
        var strings: [String: String] = [:]
        /// key -> CLDR category -> the whole text of that form (with %1$lld in it).
        var plurals: [String: [String: String]] = [:]
    }

    private static func table(_ code: String) -> Table? {
        lock.lock()
        if let t = tables[code] { lock.unlock(); return t }
        let dir = bundleOverride.bundlePath + "/\(code).lproj"
        lock.unlock()

        let t = Table()
        if let d = NSDictionary(contentsOfFile: dir + "/Localizable.strings") as? [String: String] { t.strings = d }
        if let d = NSDictionary(contentsOfFile: dir + "/Localizable.stringsdict") as? [String: Any] {
            for (key, v) in d {
                guard let entry = v as? [String: Any], let template = entry["NSStringLocalizedFormatKey"] as? String else { continue }
                // "%#@arg1@" names the variable; its dictionary holds one string per category.
                for (name, sub) in entry {
                    guard let rules = sub as? [String: Any], rules["NSStringFormatSpecTypeKey"] as? String == "NSStringPluralRuleType" else { continue }
                    var forms: [String: String] = [:]
                    for (cat, text) in rules {
                        if let s = text as? String, ["zero", "one", "two", "few", "many", "other"].contains(cat) {
                            forms[cat] = template.replacingOccurrences(of: "%#@\(name)@", with: s)
                        }
                    }
                    t.plurals[key] = forms
                }
            }
        }
        lock.lock(); tables[code] = t; lock.unlock()
        return t
    }

    // MARK: plural rules

    /// The CLDR plural category of an integer count, for the languages of the app. The compiled catalogue has the forms; this
    /// picks one, from the language of the texts and not from the device's locale, so it is the same on every phone and in tests.
    static func pluralCategory(_ code: String, _ n: Int) -> String {
        let n = abs(n)
        let lang = String(code.split(separator: "-").first ?? "en")
        let m10 = n % 10, m100 = n % 100
        switch lang {
        case "pl":
            if n == 1 { return "one" }
            if (2...4).contains(m10) && !(12...14).contains(m100) { return "few" }
            return "many"
        case "cs", "sk":
            if n == 1 { return "one" }
            return (2...4).contains(n) ? "few" : "other"
        case "sl":
            if m100 == 1 { return "one" }
            if m100 == 2 { return "two" }
            return (3...4).contains(m100) ? "few" : "other"
        case "ro":
            if n == 1 { return "one" }
            return (n == 0 || (1...19).contains(m100)) ? "few" : "other"
        case "lt":
            if m10 == 1 && !(11...19).contains(m100) { return "one" }
            return ((2...9).contains(m10) && !(11...19).contains(m100)) ? "few" : "other"
        case "lv":
            if m10 == 0 || (11...19).contains(m100) { return "zero" }
            return (m10 == 1 && m100 != 11) ? "one" : "other"
        case "hr", "sr":
            if m10 == 1 && m100 != 11 { return "one" }
            return ((2...4).contains(m10) && !(12...14).contains(m100)) ? "few" : "other"
        case "mk":
            return (m10 == 1 && m100 != 11) ? "one" : "other"
        case "fr":
            return n <= 1 ? "one" : "other"
        case "da", "nb", "nn", "no", "hu", "el", "bg", "sq", "es", "pt", "it", "de", "en", "nl", "sv", "fi", "et":
            // pt: Portugal's rule (only 1 is singular); the catalogue's Portuguese is Português (Portugal).
            return n == 1 ? "one" : "other"
        default:
            return n == 1 ? "one" : "other"
        }
    }

    // MARK: numbers

    private static var symbolsCache: (id: String, decimal: String, minus: String)?

    /// The decimal separator and minus sign of the locale of numbers.
    static var numberSymbols: (decimal: String, minus: String) {
        let loc = locale
        lock.lock(); defer { lock.unlock() }
        if let c = symbolsCache, c.id == loc.identifier { return (c.decimal, c.minus) }
        let nf = NumberFormatter()
        nf.locale = loc
        nf.numberStyle = .decimal
        let dec = loc.decimalSeparator ?? "."
        let minus = nf.minusSign ?? "-"
        symbolsCache = (loc.identifier, dec, minus)
        return (dec, minus)
    }

    /// "-1.25" (C format) -> the locale's way of writing it: "1,25" with its decimal separator and minus sign.
    static func localizeNumber(_ s: String) -> String {
        let sym = numberSymbols
        if sym.decimal == "." && sym.minus == "-" { return s }
        return s.replacingOccurrences(of: ".", with: sym.decimal).replacingOccurrences(of: "-", with: sym.minus)
    }
}
