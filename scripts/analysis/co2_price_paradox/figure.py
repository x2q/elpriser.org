#!/usr/bin/env python3
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd

P = "/private/tmp/claude-501/-Users-cc-elpriser/a438afc6-982e-4a54-be9e-898dd922f146/scratchpad/co2_paradox"
h = pd.read_csv(f"{P}/hourly_profile.csv").set_index("hour")
x = pd.read_csv(f"{P}/exchange_profile.csv").set_index("hour")

fig, ax = plt.subplots(1, 2, figsize=(13.5, 4.8))

a = ax[0]; b = a.twinx()
a.plot(h.index, h.price, color="#d02b22", lw=2.6, marker="o", ms=3.5, label="Pris")
b.plot(h.index, h.co2, color="#0e9888", lw=2.6, marker="o", ms=3.5, label="CO₂")
a.set(xlabel="Time på døgnet", ylabel="Spotpris, øre/kWh", xticks=range(0, 24, 3))
b.set_ylabel("CO₂, g/kWh", color="#0e9888")
b.tick_params(axis="y", colors="#0e9888")
a.tick_params(axis="y", colors="#d02b22"); a.yaxis.label.set_color("#d02b22")
a.axvspan(19, 21, color="#1b57f5", alpha=.07)
a.annotate("aften: dyrest\nog blandt de grønneste", xy=(19.6, h.price.max()),
           xytext=(9.0, h.price.max() * 0.72), fontsize=8.5, color="#1b57f5",
           arrowprops=dict(arrowstyle="->", color="#1b57f5", lw=1.2))
a.set_title("Pris og CO₂ over døgnet — de bevæger sig modsat", fontsize=11)
a.grid(alpha=.22)

c = ax[1]
c.bar(x.index - 0.2, x.NO, width=0.4, color="#1e9e4a", label="Handel med Norge")
c.bar(x.index + 0.2, x.DE, width=0.4, color="#8a6d3b", label="Handel med Tyskland")
c.axhline(0, color="#444", lw=1)
c.set(xlabel="Time på døgnet", ylabel="MWh/time  (positiv = import til DK1)",
      xticks=range(0, 24, 3))
c.set_title("Hvem Danmark handler med, skifter over døgnet", fontsize=11)
c.legend(fontsize=8.5, loc="lower left"); c.grid(alpha=.22, axis="y")
c.annotate("middag: importerer\ntysk strøm", xy=(13, 587), xytext=(4.5, 900),
           fontsize=8.5, color="#8a6d3b",
           arrowprops=dict(arrowstyle="->", color="#8a6d3b", lw=1.2))
c.annotate("aften: importerer\nnorsk vandkraft", xy=(20, 1027), xytext=(14.5, 1290),
           fontsize=8.5, color="#1e9e4a",
           arrowprops=dict(arrowstyle="->", color="#1e9e4a", lw=1.2))

fig.suptitle("Hvorfor den dyreste time også kan være den grønneste  ·  DK1, gennemsnit 2024–2026",
             fontsize=12.5)
fig.tight_layout()
fig.savefig(f"{P}/co2_pris_paradoks.png", dpi=132)
print("gemt")
