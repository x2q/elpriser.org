import SwiftUI

extension PriceTier {
    var color: Color {
        switch self { case .low: T.tierLow; case .mid: T.tierMid; case .high: T.tierHigh }
    }
    var soft: Color {
        switch self { case .low: T.goodSoft; case .mid: T.midSoft; case .high: T.badSoft }
    }
    var ink: Color {
        switch self { case .low: T.good; case .mid: T.mid; case .high: T.bad }
    }
}

/// Prisgrafen på Pris: én søjle pr. time, farvet efter niveau, med en nulbaseret y-akse. Timer der er gået er
/// dæmpet, et punkt viser den nuværende time, og et tryk eller træk viser den præcise pris i et mørkt tip
/// (som aldrig går ud over kortet). `flexible` lader grafen vokse med den højde, kortet får.
struct PriceBarChart: View {
    let spec: PrisChartSpec
    @Binding var selected: Int?
    /// Højden på selve søjleområdet; grafen er mindst så høj.
    var plotHeight: CGFloat = 160
    var flexible = false
    /// Større skrift og luft på tablets.
    var large = false

    @State private var startSelection: Int?
    @State private var active = false
    @State private var scrolling = false

    private var gutter: CGFloat { large ? 36 : 26 }
    private let topRow: CGFloat = 20
    private var bottomRow: CGFloat { large ? 24 : 20 }

    var body: some View {
        GeometryReader { g in
            Canvas { ctx, size in draw(&ctx, size) }
                .contentShape(Rectangle())
                // Samtidig med rullen, så en lodret bevægelse stadig ruller siden; vandrette bevægelser scrubber.
                .simultaneousGesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { v in drag(v, width: g.size.width) }
                        .onEnded { v in dragEnded(v, width: g.size.width) })
        }
        .frame(minHeight: plotHeight + topRow + bottomRow, maxHeight: flexible ? .infinity : plotHeight + topRow + bottomRow)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spec.summary)
        .accessibilityValue(selected.flatMap { spec.bars.indices.contains($0) ? spec.bars[$0].tip : nil } ?? "")
        .accessibilityAdjustableAction { dir in
            let n = spec.bars.count
            guard n > 0 else { return }
            let cur = selected ?? spec.nowIndex ?? 0
            selected = Swift.min(Swift.max(cur + (dir == .increment ? 1 : -1), 0), n - 1)
        }
    }

    // MARK: berøring

    private func index(at x: CGFloat, width: CGFloat) -> Int {
        let n = spec.bars.count
        let w = Swift.max(width - gutter, 1)
        return Swift.min(Swift.max(Int(((x - gutter) / w * CGFloat(n)).rounded(.down)), 0), n - 1)
    }

    private func drag(_ v: DragGesture.Value, width: CGFloat) {
        guard !spec.bars.isEmpty else { return }
        if !active { active = true; scrolling = false; startSelection = selected }
        if scrolling { return }
        // Tydeligt lodret: brugeren ruller siden. Slip tippet, som det var, og lad rullen arbejde.
        if abs(v.translation.height) > 12 && abs(v.translation.height) > abs(v.translation.width) {
            scrolling = true
            selected = startSelection
            return
        }
        selected = index(at: v.location.x, width: width)
    }

    private func dragEnded(_ v: DragGesture.Value, width: CGFloat) {
        defer { active = false; scrolling = false; startSelection = nil }
        guard !scrolling, !spec.bars.isEmpty else { return }
        let moved = hypot(v.translation.width, v.translation.height) > 6
        // Et tryk på den allerede valgte søjle slukker tippet igen; ellers bliver det stående.
        if !moved, let s = startSelection, s == index(at: v.location.x, width: width) { selected = nil }
    }

    // MARK: tegning

    private func draw(_ ctx: inout GraphicsContext, _ size: CGSize) {
        let n = spec.bars.count
        guard n > 0, size.width > gutter + 10, size.height > topRow + bottomRow + 10 else { return }
        let plot = CGRect(x: gutter, y: topRow, width: size.width - gutter, height: size.height - topRow - bottomRow)
        let axis = spec.axis
        let span = Swift.max(axis.max - axis.min, 0.0001)
        func y(_ v: Double) -> CGFloat { plot.minY + CGFloat((axis.max - v) / span) * plot.height }
        let slot = plot.width / CGFloat(n)
        func cx(_ i: Double) -> CGFloat { plot.minX + CGFloat(i) * slot }
        let labelFont = Font.app(large ? 12 : 11, .bold)
        let small = Font.app(10, .bold)

        // vandrette hjælpelinjer og prisskalaen
        for v in axis.ticks {
            var p = Path(); p.move(to: CGPoint(x: plot.minX, y: y(v))); p.addLine(to: CGPoint(x: plot.maxX, y: y(v)))
            ctx.stroke(p, with: .color(T.hairline), lineWidth: 1)
            let r = ctx.resolve(Text(axis.label(v)).font(labelFont).foregroundStyle(T.text2))
            ctx.draw(r, at: CGPoint(x: plot.minX - 6, y: y(v)), anchor: .trailing)
        }
        ctx.draw(ctx.resolve(Text("kr/kWh").font(small).foregroundStyle(T.text2)),
                 at: CGPoint(x: 0, y: topRow - 8), anchor: .bottomLeading)

        // døgnskel i 3–10-visningen
        if spec.period == .long {
            for d in 1..<Swift.max(spec.days, 1) where d * 24 < n {
                var p = Path(); p.move(to: CGPoint(x: cx(Double(d * 24)), y: plot.minY)); p.addLine(to: CGPoint(x: cx(Double(d * 24)), y: plot.maxY))
                ctx.stroke(p, with: .color(T.hairline), lineWidth: 1)
            }
        }

        // prognosen: tynd skillelinje med navn
        if let f = spec.forecastFrom {
            let label = ctx.resolve(Text("Prognose").font(small).foregroundStyle(T.text2))
            if f > 0 && f < n {
                var p = Path(); p.move(to: CGPoint(x: cx(Double(f)), y: plot.minY)); p.addLine(to: CGPoint(x: cx(Double(f)), y: plot.maxY))
                ctx.stroke(p, with: .color(T.text2.opacity(0.55)), style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                ctx.draw(label, at: CGPoint(x: cx(Double(f)) + 4, y: topRow - 8), anchor: .bottomLeading)
            } else {
                ctx.draw(label, at: CGPoint(x: plot.maxX, y: topRow - 8), anchor: .bottomTrailing)
            }
        }

        // søjler
        let gap: CGFloat = n <= 60 ? (large ? 3 : 2) : (n <= 100 ? 1 : 0.5)
        let base = y(0)
        var selTop: CGFloat?
        for (i, b) in spec.bars.enumerated() {
            let w = Swift.max(slot - gap, 0.8)
            let x0 = cx(Double(i)) + (slot - w) / 2
            let yv = y(b.value)
            let top = Swift.min(yv, base), h = Swift.max(abs(base - yv), 1.5)
            let isSel = selected == i
            let r = Swift.min(large ? 3 : 2, w / 2)
            let rect = CGRect(x: x0, y: top, width: w, height: h)
            let shape = UnevenRoundedRectangle(topLeadingRadius: r, bottomLeadingRadius: 0, bottomTrailingRadius: 0, topTrailingRadius: r)
            if isSel {
                ctx.fill(Path(roundedRect: CGRect(x: cx(Double(i)), y: plot.minY, width: slot, height: plot.height), cornerRadius: 3),
                         with: .color(T.brandSolid.opacity(0.10)))
                selTop = top
            }
            ctx.fill(shape.path(in: rect), with: .color(b.tier.color.opacity(b.past && !isSel ? 0.35 : 1)))
            if isSel { ctx.fill(shape.path(in: rect), with: .color(.black.opacity(0.18))) }
        }

        // prik over den nuværende time
        if let now = spec.nowIndex, spec.bars.indices.contains(now) {
            let b = spec.bars[now]
            let top = Swift.min(y(b.value), base)
            let r: CGFloat = large ? 3.2 : 2.6
            let c = CGPoint(x: cx(Double(now)) + slot / 2, y: top - 4 - r)
            ctx.fill(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)), with: .color(T.text))
        }

        // x-aksen
        let step = plot.width >= 480 ? 6 : 12
        let lblFont = spec.period == .long && plot.width / CGFloat(Swift.max(spec.days, 1)) < 44 ? small : labelFont
        for l in spec.xLabels(step: step) {
            let r = ctx.resolve(Text(l.text).font(lblFont).foregroundStyle(T.text2))
            let w = r.measure(in: size).width
            var x = cx(l.at) - w / 2
            if l.at == 0 { x = plot.minX }
            x = Swift.min(Swift.max(x, plot.minX), size.width - w)
            ctx.draw(r, at: CGPoint(x: x, y: plot.maxY + 5), anchor: .topLeading)
        }

        // værktøjstippet tegnes sidst, oven på alt, og holdes inden for kortets kanter
        if let s = selected, spec.bars.indices.contains(s) {
            let r = ctx.resolve(Text(spec.bars[s].tip).font(Font.app(large ? 13 : 12, .bold)).foregroundStyle(Color.white))
            let t = r.measure(in: size)
            let padX: CGFloat = large ? 11 : 10, padY: CGFloat = large ? 7 : 6
            let w = t.width + padX * 2, h = t.height + padY * 2
            let mid = cx(Double(s)) + slot / 2
            let x = Swift.min(Swift.max(mid - w / 2, 0), size.width - w)
            let barTop = selTop ?? y(spec.bars[s].value)
            let yy = Swift.max(barTop - 14 - h, 0)
            let box = CGRect(x: x, y: yy, width: w, height: h)
            ctx.fill(Path(roundedRect: box.offsetBy(dx: 0, dy: 2), cornerRadius: 9), with: .color(.black.opacity(0.18)))
            ctx.fill(Path(roundedRect: box, cornerRadius: 9), with: .color(T.tooltip))
            ctx.draw(r, at: CGPoint(x: box.midX, y: box.midY), anchor: .center)
        }
    }
}
