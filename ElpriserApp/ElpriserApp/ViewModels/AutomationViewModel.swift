import Foundation

@Observable
class AutomationViewModel {
    var area: Area = .dk1
    var mode: PriceMode = .inklAlt
    var device: DeviceType = .heatPump
    var strategy: Strategy = .cheapestN
    var param: Int = 6
    var networkGLN: String?

    var scheduleDays: [ScheduleDay] = []
    var isLoading = false
    var error: String?
    var savingsEstimate: String?

    var apiURL: String {
        var url = "https://elpriser.org/api/now?area=\(area.rawValue)&mode=\(mode.rawValue)&strategy=\(strategy.rawValue)"
        if strategy.requiresParam {
            url += "&\(strategy.paramKey)=\(param)"
        }
        if let gln = networkGLN, mode.requiresNetwork {
            url += "&gln=\(gln)"
        }
        return url
    }

    var homeAssistantYAML: String {
        """
        # REST-sensor — henter status fra elpriser.org API
        rest:
          - resource: "\(apiURL)"
            scan_interval: 60
            sensor:
              - name: "Elpris Status"
                value_template: "{{ value_json.on }}"
                json_attributes:
                  - price
                  - hour
                  - area
                  - strategy

        # Automation — tænd/sluk baseret på API
        automation:
          - alias: "Elpris styring"
            trigger:
              - platform: state
                entity_id: sensor.elpris_status
            action:
              - choose:
                  - conditions:
                      - condition: state
                        entity_id: sensor.elpris_status
                        state: "True"
                    sequence:
                      - service: switch.turn_on
                        target:
                          entity_id: switch.DIN_ENHED
                  - conditions:
                      - condition: state
                        entity_id: sensor.elpris_status
                        state: "False"
                    sequence:
                      - service: switch.turn_off
                        target:
                          entity_id: switch.DIN_ENHED
        """
    }

    var shellyScript: String {
        """
        // Shelly Plus/Pro — Elpris automation
        // Kalder API hvert minut og sætter output
        let URL = "\(apiURL)";
        let SWITCH_ID = 0;

        function check() {
          Shelly.call("HTTP.GET", { url: URL }, function(res, err) {
            if (err || !res || res.code !== 200) return;
            let d = JSON.parse(res.body);
            Shelly.call("Switch.Set", { id: SWITCH_ID, on: d.on });
          });
        }

        // Check every 60 seconds
        Timer.set(60000, true, check);
        check();
        """
    }

    func load() async {
        isLoading = true
        error = nil

        let df = DateFormatter()
        df.dateFormat = "yyyy-MM-dd"
        let today = Date()
        let cal = Calendar.current

        var days: [ScheduleDay] = []

        do {
            for offset in 0..<7 {
                let date = cal.date(byAdding: .day, value: offset, to: today)!
                let dateStr = df.string(from: date)
                let gln = mode.requiresNetwork ? networkGLN : nil

                let resp = try await ElpriserAPI.shared.fetchSchedule(
                    area: area, mode: mode, strategy: strategy,
                    param: param, date: dateStr, gln: gln
                )
                days.append(ScheduleDay(date: resp.date, schedule: resp.schedule))
            }

            // Calculate savings estimate
            let allOnPrices = days.flatMap { $0.schedule.filter { $0.on }.compactMap { $0.price } }
            let allPrices = days.flatMap { $0.schedule.compactMap { $0.price } }
            let avgAll = allPrices.isEmpty ? 0 : allPrices.reduce(0, +) / Double(allPrices.count)
            let avgOn = allOnPrices.isEmpty ? 0 : allOnPrices.reduce(0, +) / Double(allOnPrices.count)
            let savings = avgAll > 0 ? ((avgAll - avgOn) / avgAll * 100) : 0
            let finalDays = days

            await MainActor.run {
                self.scheduleDays = finalDays
                if savings > 0 {
                    self.savingsEstimate = String(format: "Ca. %.0f%% billigere end gennemsnit ved at køre i de valgte timer", savings)
                } else {
                    self.savingsEstimate = nil
                }
                self.isLoading = false
            }
        } catch {
            await MainActor.run {
                self.error = error.localizedDescription
                self.isLoading = false
            }
        }
    }

    func onDeviceChange() {
        strategy = device.defaultStrategy
        param = device.defaultHours
    }
}
