import Foundation

/// Stedslisten ("Hvor er du?"): de to prisområder og de rene regler for detaljetekst og søgning.
let placeAreas: [(area: String, name: String)] = [("DK1", "Vestdanmark"), ("DK2", "Østdanmark")]

func placeAreaName(_ area: String) -> String {
    placeAreas.first { $0.area == area }?.name ?? area
}

/// Detaljen yderst til højre på en områderække: netselskabets navn, "Uden netselskab" eller intet.
/// Et gemt netselskab bestemmer området; uden netselskab er det det valgte område (`chosenArea`), der tæller.
func placeAreaDetail(area: String, net: Net?, chosenArea: String) -> String {
    if let net { return net.area == area ? net.name : "" }
    return chosenArea == area ? "Uden netselskab" : ""
}

/// Om rækken "Uden netselskab" i et område er den nuværende.
func placeIsWithoutNet(area: String, net: Net?, chosenArea: String) -> Bool {
    net == nil && chosenArea == area
}

/// Søgning på tværs af begge områder: netselskaber, hvis navn indeholder søgeordet (uden hensyn til store/små bogstaver og accenter).
func placeSearch(_ query: String, in nets: [Net] = Nets.all) -> [Net] {
    let q = query.trimmingCharacters(in: .whitespaces)
    guard !q.isEmpty else { return [] }
    return nets.filter { $0.name.range(of: q, options: [.caseInsensitive, .diacriticInsensitive]) != nil }
}

func placeNoMatch(_ query: String) -> String {
    "Ingen netselskaber matcher “\(query.trimmingCharacters(in: .whitespaces))”."
}

/// Noter øverst i arket, når positionen ikke gav et netselskab.
enum PlaceNote {
    static let noPosition = "Vi kunne ikke finde din position. Vælg dit netselskab nedenfor i stedet."
    static let outside = "Din position ligger uden for Danmark. Vælg dit netselskab nedenfor."
    static let noNet = "Vi kunne ikke finde netselskabet for din position. Vælg det nedenfor — det står på din elregning."
    static let failed = "Opslaget lykkedes ikke. Vælg dit netselskab nedenfor, eller prøv igen senere."
}
