import SwiftUI
import UIKit

private struct Plan: Identifiable {
    let d: Device
    let hours: Set<Int>
    let avg: Double
    let kwh: Double
    let save: Double
    var id: String { d.key }
}

private func iconFor(_ key: String) -> String {
    switch key { case "heatpump": "thermometer.medium"; case "car": "ev.plug.ac.type.2"; default: "drop" }
}

struct AutomationScreen: View {
    @Environment(AppModel.self) private var vm

    var body: some View {
        let s = vm.settings
        let unit = s.zone.unit
        let today = vm.days().first { $0.date == Clock.today() }
        Adaptive { wide in
            VStack(spacing: 0) {
                ScreenHeader(title: L10n.string("nav_smart"), subtitle: L10n.string("smart_subtitle"))
                if let today {
                    let prices = today.price
                    let dayAvg = prices.reduce(0, +) / 24
                    let order = prices.enumerated().map { ($0.offset, $0.element) }.sorted { $0.1 < $1.1 }
                    let plans: [Plan] = s.devices.map { d in
                        let chosen = Array(order.prefix(d.hours))
                        let kwh = Double(d.hours) * d.kw
                        let cost = chosen.reduce(0) { $0 + $1.1 * d.kw }
                        return Plan(d: d, hours: Set(chosen.map { $0.0 }), avg: chosen.map { $0.1 }.reduce(0, +) / Double(chosen.count), kwh: kwh, save: dayAvg * kwh - cost)
                    }
                    let active = plans.filter { $0.d.on }
                    let saveTotal = active.reduce(0) { $0 + $1.save }
                    let kwhTotal = active.reduce(0) { $0 + $1.kwh }

                    let summary = HStack {
                        VStack(alignment: .leading, spacing: 0) {
                            Text(L10n.string("savings_today").uppercased(with: L10n.textLocale)).font(.app(12, .bold)).tracking(1).foregroundStyle(.white.opacity(0.85))
                            if unit.isSubUnit {
                                // Outside Denmark: the amount in the zone's currency, written as the locale writes it ("1,23 €").
                                Text(unit.money(saveTotal)).font(.app(36, .bold)).tracking(-1).foregroundStyle(.white)
                                    .lineLimit(1).minimumScaleFactor(0.6)
                            } else {
                                HStack(alignment: .lastTextBaseline, spacing: 4) {
                                    Text(fmt(saveTotal)).font(.app(36, .bold)).tracking(-1)
                                    Text(L10n.string("unit_kr")).font(.app(16, .bold))
                                }
                                .foregroundStyle(.white)
                            }
                        }
                        Spacer()
                        Text("\(L10n.plural("devices_active", active.count))\n\(L10n.string("kwh_moved", fmt(kwhTotal, 1)))")
                            .font(.app(13, .semibold)).lineSpacing(3).multilineTextAlignment(.trailing).foregroundStyle(.white)
                    }
                    .padding(.horizontal, 20).padding(.vertical, 16)
                    .background(T.brandSolid, in: RoundedRectangle(cornerRadius: 28, style: .continuous))

                    let devices = VStack(spacing: 10) {
                        ForEach(plans) { p in DeviceCard(plan: p, prices: prices, unit: unit, wide: wide) }
                    }
                    let export = ExportCard(plans: active.map { ($0.d, $0.hours) }, date: today.date, zone: s.zone, mode: s.mode)

                    if wide {
                        HStack(alignment: .top, spacing: 20) {
                            ScrollView { VStack(spacing: 12) { summary; devices }.padding(.bottom, 20) }
                            ScrollView { VStack(spacing: 12) { PlanCard(prices: prices, rows: plans.map { ($0.d, $0.hours) }); export }.padding(.bottom, 20) }.frame(width: 400)
                        }
                        .padding(.horizontal, 20)
                    } else {
                        ScrollView { VStack(spacing: 10) { summary; devices; export }.padding(.horizontal, 16).padding(.bottom, 16) }
                            .refreshable { await vm.load(force: true) }
                    }
                } else {
                    ScrollView { Group { vm.loading ? AnyView(LoadingView()) : AnyView(ErrorCard(text: vm.error ?? L10n.string("error_no_prices_today"), onRetry: { vm.refresh(force: true) })) }.padding(16) }
                }
            }
        }
        .background(T.bg)
    }
}

private struct DeviceCard: View {
    @Environment(AppModel.self) private var vm
    let plan: Plan
    let prices: [Double]
    let unit: PriceUnit
    let wide: Bool

    private func change(_ nd: Device) {
        vm.settings.updateDevices(vm.settings.devices.map { $0.key == nd.key ? nd : $0 })
    }

    var body: some View {
        let d = plan.d
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                Image(systemName: iconFor(d.key)).font(.app(20, .semibold)).foregroundStyle(T.brand)
                    .frame(width: 44, height: 44).background(T.brandSoft, in: Circle())
                VStack(alignment: .leading, spacing: 0) {
                    Text(d.name).font(.app(16, .heavy))
                    Text(L10n.string("device_power_line", fmt(d.kw, 1))).font(.app(12.5, .semibold)).foregroundStyle(T.text2)
                }
                Spacer()
                Toggle(L10n.string("a11y_device_toggle", d.name), isOn: Binding(get: { d.on }, set: { v in var x = d; x.on = v; change(x) }))
                    .labelsHidden().tint(T.brandSolid)
            }
            HStack {
                HStack(spacing: 4) {
                    Button { var x = d; x.hours = max(1, d.hours - 1); change(x) } label: {
                        Text("−").font(.app(22, .bold)).foregroundStyle(T.text).frame(width: 40, height: 40)
                    }
                    .accessibilityLabel(L10n.string("stepper_less"))
                    Text(L10n.plural("hours_count", d.hours)).font(.app(14, .heavy)).lineLimit(1).minimumScaleFactor(0.7).frame(width: 78)
                    Button { var x = d; x.hours = min(12, d.hours + 1); change(x) } label: {
                        Text("+").font(.app(22, .bold)).foregroundStyle(T.text).frame(width: 40, height: 40)
                    }
                    .accessibilityLabel(L10n.string("stepper_more"))
                }
                .buttonStyle(.plain)
                .padding(2).background(T.surface2, in: Capsule())
                Spacer()
                Text(L10n.string("device_avg_save", unit.withUnit(plan.avg), unit.money(plan.save)))
                    .font(.app(12.5, .semibold)).lineSpacing(2).multilineTextAlignment(.trailing).foregroundStyle(T.text2)
            }
            .padding(.top, 8)
            HStack(spacing: 2) {
                ForEach(0..<24, id: \.self) { h in
                    RoundedRectangle(cornerRadius: 5)
                        .fill(plan.hours.contains(h) ? (d.on ? T.brandSolid : T.text2.opacity(0.5)) : T.surface2)
                        .frame(height: wide ? 24 : 20)
                }
            }
            .padding(.top, 10)
            HStack {
                ForEach(["00", "06", "12", "18", "24"], id: \.self) { Text($0).font(.app(10.5)).foregroundStyle(T.text2); if $0 != "24" { Spacer() } }
            }
            .padding(.top, 3)
        }
        .card(padding: 14)
        .opacity(d.on ? 1 : 0.72)
    }
}

private struct PlanCard: View {
    let prices: [Double]
    let rows: [(Device, Set<Int>)]
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: L10n.string("plan_title"))
            HStack(spacing: 10) {
                Text(L10n.string("plan_row_price")).font(.app(12.5, .bold)).foregroundStyle(T.text2).frame(width: 96, alignment: .leading)
                HStack(spacing: 1) { ForEach(0..<24, id: \.self) { h in RoundedRectangle(cornerRadius: 3).fill(ramp(tOf(prices[h], prices))).frame(height: 22) } }
            }
            .padding(.top, 4)
            ForEach(rows, id: \.0.key) { d, hrs in
                HStack(spacing: 10) {
                    Text(d.name).font(.app(12.5, .bold)).lineLimit(1).frame(width: 96, alignment: .leading)
                    HStack(spacing: 1) { ForEach(0..<24, id: \.self) { h in RoundedRectangle(cornerRadius: 3).fill(d.on && hrs.contains(h) ? T.brandSolid : T.surface2).frame(height: 22) } }
                }
            }
        }
        .card()
    }
}

private struct ExportCard: View {
    @Environment(AppModel.self) private var vm
    let plans: [(Device, Set<Int>)]
    let date: String
    let zone: Zone
    let mode: String
    @State private var copied = false

    /// The device names in the exported JSON are a fixed data format for Home Assistant / Shelly (as on Android): they do not follow the
    /// app's language, so a user's automation does not break when the language changes.
    private static func exportName(_ key: String) -> String {
        switch key { case "heatpump": "varmepumpe"; case "car": "elbil"; default: "vandvarmer" }
    }

    private var json: String {
        // Keys as ever: "area" is the zone key in capitals (DK1, DK2, NO1, DE ...), "mode" "spot" outside Denmark.
        var out = "{\n  \"area\": \"\(zone.key.uppercased())\", \"mode\": \"\(zone.isDanish ? mode : "spot")\", \"date\": \"\(date)\",\n  \"devices\": [\n"
        for (i, p) in plans.enumerated() {
            out += "    { \"name\": \"\(Self.exportName(p.0.key))\",\n      \"hours\": [\(p.1.sorted().map(String.init).joined(separator: ", "))] }\(i < plans.count - 1 ? "," : "")\n"
        }
        return out + "  ]\n}"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 0) {
                    Text(L10n.string("export_title")).font(.app(14.5, .heavy))
                    Text(L10n.string("export_subtitle")).font(.app(12, .semibold)).foregroundStyle(T.text2)
                }
                Spacer()
                SoftButton(title: L10n.string(copied ? "export_copied" : "export_copy"), bg: T.brandSoft, fg: T.brand) {
                    UIPasteboard.general.string = json
                    copied = true
                }
            }
            Text(json).font(.system(size: 11, design: .monospaced)).lineSpacing(3)
                .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                .background(T.surface2, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .card(padding: 14)
    }
}
