import SwiftUI

struct TimeScreen: View {
    @Environment(AppModel.self) private var vm
    @State private var sheetHour: Int?

    var body: some View {
        let days = vm.days()
        let sel = min(max(vm.selDay, 0), max(days.count - 1, 0))
        Adaptive { wide in
            VStack(spacing: 0) {
                if days.isEmpty {
                    ScrollView { Group { vm.loading ? AnyView(LoadingView()) : AnyView(ErrorCard(text: vm.error ?? "Ingen data endnu.", onRetry: { vm.refresh(force: true) })) }.padding(16) }
                } else {
                    dayChips(days, sel)
                    let d = days[sel]
                    if wide {
                        WideDay(day: d)
                    } else {
                        PhoneDay(day: d, hour: $sheetHour)
                    }
                }
            }
        }
        .background(T.bg)
        .navigationTitle("Time for time")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .sheet(item: Binding(get: { sheetHour.map { HourID(h: $0) } }, set: { sheetHour = $0?.h })) { item in
            let d = days[sel]
            ScrollView { Breakdown(day: d, hour: item.h).padding(24) }
                .presentationDetents([.medium, .large])
                .background(T.surface)
        }
    }

    private func dayChips(_ days: [Day], _ sel: Int) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Array(days.enumerated()), id: \.element.id) { i, d in
                    let on = i == sel
                    Button { vm.selDay = i } label: {
                        VStack(spacing: 0) {
                            Text(dayShort(d)).font(.system(size: 11.5, weight: .semibold)).foregroundStyle(on ? .white : T.text2)
                            Text("\(dayNum(d))").font(.system(size: 18, weight: .heavy)).foregroundStyle(on ? .white : T.text)
                            Text(d.actual ? "børs" : "prog.").font(.system(size: 10.5, weight: .semibold)).foregroundStyle(on ? Color.white.opacity(0.85) : T.text2)
                        }
                        .frame(width: 62).padding(.vertical, 8)
                        .background(on ? T.brandSolid : T.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(on ? T.brandSolid : T.outline, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 4)
        }
    }
}

private struct HourID: Identifiable { let h: Int; var id: Int { h } }

/// Telefon: døgnet som liste i to kolonner; tryk åbner prisopbygningen i et ark.
private struct PhoneDay: View {
    let day: Day
    @Binding var hour: Int?
    var body: some View {
        let lo = day.price.min()!, hi = day.price.max()!
        let isToday = day.date == Clock.today(), now = Clock.hour()
        ScrollView {
            VStack(alignment: .leading, spacing: 6) {
                Text("\(dayLong(day)) · tryk på en time for prisopbygningen")
                    .font(.system(size: 12.5, weight: .semibold)).foregroundStyle(T.text2).padding(.bottom, 2)
                ForEach(0..<12, id: \.self) { r in
                    HStack(spacing: 6) {
                        ForEach([r, r + 12], id: \.self) { h in
                            let p = day.price[h]
                            let cur = isToday && h == now
                            Button { hour = h } label: {
                                HStack(spacing: 0) {
                                    Rectangle().fill(ramp(hi == lo ? 0 : (p - lo) / (hi - lo))).frame(width: 6)
                                    VStack(alignment: .leading, spacing: 0) {
                                        Text(hh(h)).font(.system(size: 11.5, weight: .semibold)).foregroundStyle(T.text2)
                                        Text(fmt(p)).font(.system(size: 16, weight: .heavy)).foregroundStyle(T.text)
                                    }
                                    .padding(.leading, 10)
                                    Spacer(minLength: 0)
                                }
                                .frame(height: 52)
                                .background(T.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(cur ? T.brandSolid : T.outline, lineWidth: cur ? 2 : 1))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 16)
        }
    }
}

/// iPad: dagens graf øverst, døgnet som et kompakt gitter (6 × 4, læst som et ur) og prisopbygningen
/// for den valgte time fast til højre.
private struct WideDay: View {
    let day: Day
    @State private var chosen: Int?
    var body: some View {
        let lo = day.price.min()!, hi = day.price.max()!
        let cheapH = day.price.firstIndex(of: lo)!, dearH = day.price.firstIndex(of: hi)!
        let isToday = day.date == Clock.today(), now = Clock.hour()
        let pick = chosen ?? (isToday ? now : cheapH)
        HStack(alignment: .top, spacing: 20) {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(dayLong(day)).font(.system(size: 17, weight: .heavy))
                        Text(day.actual ? "Offentliggjorte børspriser" : "Modelprognose med P10–P90-bånd").font(.system(size: 12.5, weight: .semibold)).foregroundStyle(T.text2)
                        PriceChart(vals: day.price, nSolid: day.actual ? 24 : 0, nowIndex: isToday ? now : nil, lo: day.lo, hi: day.hi, height: 170)
                    }
                    .card()
                    Text("Tryk på en time for at se, hvad prisen består af").font(.system(size: 13, weight: .semibold)).foregroundStyle(T.text2)
                    ForEach(0..<4, id: \.self) { r in
                        HStack(spacing: 8) {
                            ForEach(0..<6, id: \.self) { c in
                                let h = r * 6 + c
                                let p = day.price[h]
                                let picked = h == pick
                                let tag = h == cheapH ? "billigst" : h == dearH ? "dyrest" : (isToday && h == now ? "nu" : "")
                                Button { chosen = h } label: {
                                    VStack(alignment: .leading, spacing: 0) {
                                        Rectangle().fill(ramp(hi == lo ? 0 : (p - lo) / (hi - lo))).frame(height: 6)
                                        VStack(alignment: .leading, spacing: 0) {
                                            Text(hh(h)).font(.system(size: 12, weight: .semibold)).foregroundStyle(T.text2)
                                            Text(fmt(p)).font(.system(size: 22, weight: .heavy)).foregroundStyle(T.text)
                                            HourTag(text: tag, color: tag == "billigst" ? T.good : tag == "dyrest" ? T.bad : T.brand)
                                        }
                                        .padding(.horizontal, 12).padding(.vertical, 8)
                                    }
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .background(picked ? T.brandSoft : T.surface)
                                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(picked ? T.brandSolid : T.outline, lineWidth: picked ? 2 : 1))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
                .padding(.bottom, 20)
            }
            ScrollView { Breakdown(day: day, hour: pick).card() }.frame(width: 340)
        }
        .padding(.horizontal, 20).padding(.top, 8)
    }
}

/// Prisopbygning for én time: spot, nettarif, Energinets tariffer og elafgift samt moms.
struct Breakdown: View {
    @Environment(AppModel.self) private var vm
    let day: Day
    let hour: Int

    private func at(_ mode: String) -> Double? { vm.days(mode).first { $0.date == day.date }?.price[hour] }

    private struct Part: Identifiable { let id = UUID(); let label: String; let value: Double; let color: Color }

    var body: some View {
        let hasNet = vm.settings.net != nil
        let a = at("inkl_alt"), sp = at("spot_inkl"), n = hasNet ? at("net_inkl_alt") : nil
        let total = n ?? a
        VStack(alignment: .leading, spacing: 0) {
            Text("Kl. \(hh(hour)) · \(dayLong(day))").font(.system(size: 13, weight: .bold)).foregroundStyle(T.text2)
            if let total, let a, let sp {
                HStack(alignment: .lastTextBaseline, spacing: 6) {
                    Text(fmt(total)).font(.system(size: 52, weight: .bold)).tracking(-2)
                    Text("kr/kWh").font(.system(size: 15, weight: .bold)).foregroundStyle(T.text2)
                }
                .padding(.top, 4)
                let spot = sp / 1.25
                let grid = n.map { ($0 - a) / 1.25 } ?? 0
                let rest = a / 1.25 - spot
                let vat = total - total / 1.25
                let parts: [Part] = [Part(label: "Spotpris", value: spot, color: T.brandSolid)]
                    + (n != nil ? [Part(label: "\(vm.settings.net?.name ?? "")s nettarif", value: grid, color: Color(hex: 0xFF9500))] : [])
                    + [Part(label: "Energinets tariffer og elafgift", value: rest, color: Color(hex: 0xA8D84A)), Part(label: "Moms (25 %)", value: vat, color: T.text2)]
                GeometryReader { g in
                    let sum = parts.reduce(0) { $0 + max($1.value, 0) }
                    HStack(spacing: 0) {
                        ForEach(parts) { p in
                            if p.value > 0 { Rectangle().fill(p.color).frame(width: g.size.width * CGFloat(p.value / max(sum, 0.0001))) }
                        }
                    }
                    .clipShape(Capsule())
                }
                .frame(height: 14).padding(.top, 14)
                VStack(spacing: 0) {
                    ForEach(parts) { p in
                        HStack(spacing: 10) {
                            RoundedRectangle(cornerRadius: 4).fill(p.color).frame(width: 12, height: 12)
                            Text(p.label).font(.system(size: 14.5, weight: .semibold))
                            Spacer()
                            Text(fmt(p.value)).font(.system(size: 14.5, weight: .heavy))
                        }
                        .padding(.vertical, 7)
                    }
                }
                .padding(.top, 10)
                if !hasNet {
                    Text("Vælg dit netselskab under Mere for at få nettariffen med.").font(.system(size: 12.5)).foregroundStyle(T.text2).padding(.top, 6)
                }
            } else {
                Text("Prisopbygningen er ikke hentet endnu.").font(.system(size: 15)).padding(.vertical, 24)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
