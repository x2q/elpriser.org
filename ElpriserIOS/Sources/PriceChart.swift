import SwiftUI

func niceTicks(_ lo: Double, _ hi: Double) -> [Double] {
    let raw = (hi - lo) / 3
    let step = [0.1, 0.2, 0.25, 0.5, 1.0, 2.0, 5.0].first { $0 >= raw } ?? 5.0
    var out: [Double] = []
    var v = (lo / step - 1e-9).rounded(.up) * step
    while v <= hi + 1e-9 { out.append(v); v += step }
    return out
}

/// Prisgrafen: linjen farves efter prisen (grøn nederst, rød øverst), de faktiske timer er fuldt optrukne,
/// prognosen er stiplet med P10–P90-bånd, og et punkt viser, hvor vi er nu.
struct PriceChart: View {
    let vals: [Double]
    var nSolid: Int
    var nowIndex: Int?
    var lo: [Double]?
    var hi: [Double]?
    var bandFrom = 0
    var days = 1
    var dayNames: [String] = []
    var height: CGFloat = 170

    var body: some View {
        VStack(spacing: 2) {
            Canvas { ctx, size in draw(&ctx, size) }
                .frame(height: height)
                .accessibilityElement()
                .accessibilityLabel("Prisgraf time for time")
            if !dayNames.isEmpty {
                HStack(spacing: 0) {
                    ForEach(dayNames.indices, id: \.self) { i in
                        Text(dayNames[i]).font(.system(size: 11, weight: .bold)).foregroundStyle(T.text2).frame(maxWidth: .infinity)
                    }
                }
            }
        }
    }

    private func draw(_ ctx: inout GraphicsContext, _ size: CGSize) {
        let n = vals.count
        guard n > 1 else { return }
        let padT: CGFloat = 8, labelH: CGFloat = 18
        let top = padT, bottom = size.height - labelH
        var minV = vals.min()!, maxV = vals.max()!
        if let lo { minV = Swift.min(minV, lo.min()!) }
        if let hi { maxV = Swift.max(maxV, hi.max()!) }
        let span = (maxV - minV) > 0 ? (maxV - minV) : 1
        func x(_ i: Int) -> CGFloat { CGFloat(i) / CGFloat(n - 1) * size.width }
        func y(_ v: Double) -> CGFloat { top + CGFloat(1 - (v - minV) / span) * (bottom - top) }

        let tickFont = Font.system(size: 10, weight: .semibold)
        let ticks = niceTicks(minV, maxV)
        for v in ticks {
            var p = Path(); p.move(to: CGPoint(x: 0, y: y(v))); p.addLine(to: CGPoint(x: size.width, y: y(v)))
            ctx.stroke(p, with: .color(T.outline), lineWidth: 1)
        }
        for d in 1..<Swift.max(days, 1) {
            var p = Path(); p.move(to: CGPoint(x: x(d * 24), y: top)); p.addLine(to: CGPoint(x: x(d * 24), y: bottom))
            ctx.stroke(p, with: .color(T.outline), lineWidth: 1)
        }
        for d in 0..<days {
            for h in [0, 6, 12, 18] where d * 24 + h < n {
                let t = Text(pad(h)).font(tickFont).foregroundStyle(T.text2)
                let r = ctx.resolve(t)
                let tx = Swift.min(Swift.max(x(d * 24 + h) - r.measure(in: size).width / 2, 0), size.width - r.measure(in: size).width)
                ctx.draw(r, at: CGPoint(x: tx, y: bottom + 4), anchor: .topLeading)
            }
        }
        // P10–P90-bånd
        if let lo, let hi, bandFrom < n {
            var band = Path()
            for i in bandFrom..<n { i == bandFrom ? band.move(to: CGPoint(x: x(i), y: y(hi[i]))) : band.addLine(to: CGPoint(x: x(i), y: y(hi[i]))) }
            for i in stride(from: n - 1, through: bandFrom, by: -1) { band.addLine(to: CGPoint(x: x(i), y: y(lo[i]))) }
            band.closeSubpath()
            ctx.fill(band, with: .color(T.brandSolid.opacity(0.16)))
        }
        let shade = GraphicsContext.Shading.linearGradient(
            Gradient(stops: [
                .init(color: Color(red: 255 / 255, green: 59 / 255, blue: 48 / 255), location: 0),
                .init(color: Color(red: 255 / 255, green: 149 / 255, blue: 0), location: 0.15),
                .init(color: Color(red: 255 / 255, green: 204 / 255, blue: 0), location: 0.40),
                .init(color: Color(red: 168 / 255, green: 216 / 255, blue: 74 / 255), location: 0.65),
                .init(color: Color(red: 52 / 255, green: 199 / 255, blue: 89 / 255), location: 1),
            ]),
            startPoint: CGPoint(x: 0, y: top), endPoint: CGPoint(x: 0, y: bottom))
        let ns = Swift.min(Swift.max(nSolid, 0), n)
        if ns > 1 {
            var p = Path()
            for i in 0..<ns { i == 0 ? p.move(to: CGPoint(x: x(i), y: y(vals[i]))) : p.addLine(to: CGPoint(x: x(i), y: y(vals[i]))) }
            ctx.stroke(p, with: shade, style: StrokeStyle(lineWidth: 3.2, lineCap: .round, lineJoin: .round))
        }
        if ns < n {
            var p = Path()
            let from = Swift.max(ns - 1, 0)
            for i in from..<n { i == from ? p.move(to: CGPoint(x: x(i), y: y(vals[i]))) : p.addLine(to: CGPoint(x: x(i), y: y(vals[i]))) }
            ctx.stroke(p, with: shade, style: StrokeStyle(lineWidth: 3.2, lineCap: .round, lineJoin: .round, dash: [9, 7]))
        }
        if let nowIndex, (0..<n).contains(nowIndex) {
            let xx = x(nowIndex)
            var p = Path(); p.move(to: CGPoint(x: xx, y: top)); p.addLine(to: CGPoint(x: xx, y: bottom))
            ctx.stroke(p, with: .color(T.text2.opacity(0.5)), style: StrokeStyle(lineWidth: 1.5, dash: [4, 4]))
            let c = CGPoint(x: xx, y: y(vals[nowIndex]))
            ctx.fill(Path(ellipseIn: CGRect(x: c.x - 8, y: c.y - 8, width: 16, height: 16)), with: .color(T.surface))
            ctx.fill(Path(ellipseIn: CGRect(x: c.x - 5.5, y: c.y - 5.5, width: 11, height: 11)), with: .color(T.brandSolid))
        }
        // prisskalaens tal tegnes til sidst, oven på linjen
        for v in ticks {
            let r = ctx.resolve(Text(fmt(v, 2)).font(tickFont).foregroundStyle(T.text2))
            let sz = r.measure(in: size)
            let ty = y(v) - sz.height - 1
            ctx.fill(Path(roundedRect: CGRect(x: 0, y: ty, width: sz.width + 6, height: sz.height), cornerRadius: 4), with: .color(T.surface.opacity(0.9)))
            ctx.draw(r, at: CGPoint(x: 3, y: ty), anchor: .topLeading)
        }
    }
}
