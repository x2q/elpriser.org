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
        let today = vm.days().first { $0.date == Clock.today() }
        Adaptive { wide in
            VStack(spacing: 0) {
                ScreenHeader(title: "Automation", subtitle: "Kør efter de billigste timer i dag")
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
                            Text("BESPARELSE I DAG").font(.system(size: 12, weight: .bold)).tracking(1).foregroundStyle(.white.opacity(0.85))
                            HStack(alignment: .lastTextBaseline, spacing: 4) {
                                Text(fmt(saveTotal)).font(.system(size: 36, weight: .bold)).tracking(-1)
                                Text("kr").font(.system(size: 16, weight: .bold))
                            }
                            .foregroundStyle(.white)
                        }
                        Spacer()
                        Text("\(active.count) \(active.count == 1 ? "enhed aktiv" : "enheder aktive")\n\(fmt(kwhTotal, 1)) kWh flyttet")
                            .font(.system(size: 13, weight: .semibold)).lineSpacing(3).multilineTextAlignment(.trailing).foregroundStyle(.white)
                    }
                    .padding(.horizontal, 20).padding(.vertical, 16)
                    .background(T.brandSolid, in: RoundedRectangle(cornerRadius: 28, style: .continuous))

                    let devices = VStack(spacing: 10) {
                        ForEach(plans) { p in DeviceCard(plan: p, prices: prices, wide: wide) }
                    }
                    let export = ExportCard(plans: active.map { ($0.d, $0.hours) }, date: today.date)

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
                    ScrollView { Group { vm.loading ? AnyView(LoadingView()) : AnyView(ErrorCard(text: vm.error ?? "Ingen priser for i dag endnu.", onRetry: { vm.refresh(force: true) })) }.padding(16) }
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
    let wide: Bool

    private func change(_ nd: Device) {
        vm.settings.updateDevices(vm.settings.devices.map { $0.key == nd.key ? nd : $0 })
    }

    var body: some View {
        let d = plan.d
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                Image(systemName: iconFor(d.key)).font(.system(size: 20, weight: .semibold)).foregroundStyle(T.brand)
                    .frame(width: 44, height: 44).background(T.brandSoft, in: Circle())
                VStack(alignment: .leading, spacing: 0) {
                    Text(d.name).font(.system(size: 16, weight: .heavy))
                    Text("\(fmt(d.kw, 1)) kW · billigste timer").font(.system(size: 12.5, weight: .semibold)).foregroundStyle(T.text2)
                }
                Spacer()
                Toggle("\(d.name) automatik", isOn: Binding(get: { d.on }, set: { v in var x = d; x.on = v; change(x) }))
                    .labelsHidden().tint(T.brandSolid)
            }
            HStack {
                HStack(spacing: 4) {
                    Button { var x = d; x.hours = max(1, d.hours - 1); change(x) } label: {
                        Text("−").font(.system(size: 22, weight: .bold)).foregroundStyle(T.text).frame(width: 40, height: 40)
                    }
                    Text("\(d.hours) \(d.hours == 1 ? "time" : "timer")").font(.system(size: 14, weight: .heavy)).frame(width: 78)
                    Button { var x = d; x.hours = min(12, d.hours + 1); change(x) } label: {
                        Text("+").font(.system(size: 22, weight: .bold)).foregroundStyle(T.text).frame(width: 40, height: 40)
                    }
                }
                .buttonStyle(.plain)
                .padding(2).background(T.surface2, in: Capsule())
                Spacer()
                Text("gns. \(fmt(plan.avg)) kr/kWh\nspar \(fmt(plan.save)) kr")
                    .font(.system(size: 12.5, weight: .semibold)).lineSpacing(2).multilineTextAlignment(.trailing).foregroundStyle(T.text2)
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
                ForEach(["00", "06", "12", "18", "24"], id: \.self) { Text($0).font(.system(size: 10.5)).foregroundStyle(T.text2); if $0 != "24" { Spacer() } }
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
            SectionLabel(text: "Dagens plan")
            HStack(spacing: 10) {
                Text("Pris").font(.system(size: 12.5, weight: .bold)).foregroundStyle(T.text2).frame(width: 96, alignment: .leading)
                HStack(spacing: 1) { ForEach(0..<24, id: \.self) { h in RoundedRectangle(cornerRadius: 3).fill(ramp(tOf(prices[h], prices))).frame(height: 22) } }
            }
            .padding(.top, 4)
            ForEach(rows, id: \.0.key) { d, hrs in
                HStack(spacing: 10) {
                    Text(d.name).font(.system(size: 12.5, weight: .bold)).lineLimit(1).frame(width: 96, alignment: .leading)
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
    @State private var copied = false

    private var json: String {
        let s = vm.settings
        var out = "{\n  \"area\": \"\(s.effectiveArea)\", \"mode\": \"\(s.mode)\", \"date\": \"\(date)\",\n  \"devices\": [\n"
        for (i, p) in plans.enumerated() {
            out += "    { \"name\": \"\(p.0.name.lowercased())\",\n      \"hours\": [\(p.1.sorted().map(String.init).joined(separator: ", "))] }\(i < plans.count - 1 ? "," : "")\n"
        }
        return out + "  ]\n}"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 0) {
                    Text("Hent planen til Home Assistant").font(.system(size: 14.5, weight: .heavy))
                    Text("eller Shelly — JSON med de valgte timer").font(.system(size: 12, weight: .semibold)).foregroundStyle(T.text2)
                }
                Spacer()
                SoftButton(title: copied ? "Kopieret" : "Kopiér", bg: T.brandSoft, fg: T.brand) {
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
