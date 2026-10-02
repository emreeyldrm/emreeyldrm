import Foundation
import MapKit

/// Google Takeout "Kayıtlı yerler" CSV dosyasını okur.
/// Sütunlar: Title, Note, URL, Comment. Koordinat gelmez; MapKit ile bulunur.
enum TakeoutImporter {
    struct Row {
        let title: String
        let note: String
        let url: String
    }

    static func parse(csv: String) -> [Row] {
        let records = parseCSV(csv)
        guard let header = records.first else { return [] }
        let idx = { (name: String) in header.firstIndex { $0.lowercased() == name } }
        guard let t = idx("title") else { return [] }
        let n = idx("note"), u = idx("url")
        return records.dropFirst().compactMap { r in
            guard t < r.count, !r[t].isEmpty else { return nil }
            return Row(title: r[t],
                       note: n.flatMap { $0 < r.count ? r[$0] : nil } ?? "",
                       url: u.flatMap { $0 < r.count ? r[$0] : nil } ?? "")
        }
    }

    /// Satırları Place'e çevirir; koordinatı şehir adıyla arayarak bulmaya çalışır.
    static func makePlaces(from rows: [Row], cityName: String,
                           category: PlaceCategory) async -> [Place] {
        var result: [Place] = []
        for row in rows {
            let place = Place(name: row.title, category: category,
                              note: row.note, googleMapsURL: row.url.isEmpty ? nil : row.url)
            let request = MKLocalSearch.Request()
            request.naturalLanguageQuery = "\(row.title) \(cityName)"
            if let item = try? await MKLocalSearch(request: request).start().mapItems.first {
                place.latitude = item.placemark.coordinate.latitude
                place.longitude = item.placemark.coordinate.longitude
            }
            result.append(place)
        }
        return result
    }

    // Tırnaklı alanları ve satır sonlarını destekleyen minimal CSV ayrıştırıcı.
    private static func parseCSV(_ text: String) -> [[String]] {
        var rows: [[String]] = [], row: [String] = [], field = ""
        var inQuotes = false
        var chars = text.makeIterator()
        var pending: Character? = nil
        while let c = pending ?? chars.next() {
            pending = nil
            if inQuotes {
                if c == "\"" {
                    if let next = chars.next() {
                        if next == "\"" { field.append("\"") } else { inQuotes = false; pending = next }
                    } else { inQuotes = false }
                } else { field.append(c) }
            } else {
                switch c {
                case "\"": inQuotes = true
                case ",": row.append(field); field = ""
                case "\n", "\r\n":
                    row.append(field); field = ""
                    if !(row.count == 1 && row[0].isEmpty) { rows.append(row) }
                    row = []
                case "\r": break
                default: field.append(c)
                }
            }
        }
        if !field.isEmpty || !row.isEmpty { row.append(field); rows.append(row) }
        return rows
    }
}
