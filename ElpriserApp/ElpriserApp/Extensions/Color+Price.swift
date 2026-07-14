import SwiftUI

extension Color {
    // Brand colors matching elpriser.org
    static let brand = Color(red: 0x1B/255, green: 0x57/255, blue: 0xF5/255)
    static let brandDark = Color(red: 0x19/255, green: 0x33/255, blue: 0x8F/255)
    static let accent = Color(red: 0x10/255, green: 0xB9/255, blue: 0x81/255)

    // Multi-stop gradient matching the web app's STOPS array
    // Position → [r, g, b]
    private static let priceStops: [(Double, (Double, Double, Double))] = [
        (0.00, (126, 205, 155)),  // green-600 pastel
        (0.14, (155, 237, 185)),  // green-400 pastel
        (0.28, (219, 248, 170)),  // lime-300 pastel
        (0.42, (254, 247, 190)),  // yellow-200 pastel
        (0.55, (253, 231, 157)),  // amber-300 pastel
        (0.67, (254, 217, 179)),  // orange-300 pastel
        (0.78, (252, 178, 126)),  // orange-500 pastel
        (0.88, (251, 177, 177)),  // red-400 pastel
        (1.00, (217, 130, 130)),  // red-700 pastel
    ]

    /// Returns a color from the price gradient based on a normalized value (0-1)
    static func priceColor(t: Double, isDark: Bool = false) -> Color {
        let t = max(0, min(1, t))
        var r: Double = 217, g: Double = 130, b: Double = 130

        for i in 0..<(priceStops.count - 1) {
            let (t0, c0) = priceStops[i]
            let (t1, c1) = priceStops[i + 1]
            if t >= t0 && t <= t1 {
                let f = (t - t0) / (t1 - t0)
                r = c0.0 + (c1.0 - c0.0) * f
                g = c0.1 + (c1.1 - c0.1) * f
                b = c0.2 + (c1.2 - c0.2) * f
                break
            }
        }

        if isDark {
            // Mix toward dark background (rgb(3,7,18) = gray-950)
            let m = 0.75
            r = r * m + 3 * (1 - m)
            g = g * m + 7 * (1 - m)
            b = b * m + 18 * (1 - m)
        }

        return Color(red: r / 255, green: g / 255, blue: b / 255)
    }

    /// Returns price color given actual price and the visible range
    static func forPrice(_ price: Double, min: Double, max: Double, isDark: Bool) -> Color {
        let range = max - min
        let t = range < 0.01 ? 0.5 : (price - min) / range
        return priceColor(t: t, isDark: isDark)
    }
}
