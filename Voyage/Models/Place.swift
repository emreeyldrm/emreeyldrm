import Foundation
import SwiftData
import CoreLocation

@Model
final class Place {
    var name: String
    var categoryRaw: String
    var note: String
    var latitude: Double?
    var longitude: Double?
    var googleMapsURL: String?
    var visited: Bool
    /// Gezi planındaki gün (1, 2, ...). nil = henüz plana eklenmedi.
    var planDay: Int?
    /// Gün içindeki sıra (0'dan başlar).
    var planOrder: Int = 0
    var city: City?

    init(name: String, category: PlaceCategory = .other, note: String = "",
         latitude: Double? = nil, longitude: Double? = nil, googleMapsURL: String? = nil) {
        self.name = name
        self.categoryRaw = category.rawValue
        self.note = note
        self.latitude = latitude
        self.longitude = longitude
        self.googleMapsURL = googleMapsURL
        self.visited = false
    }

    var category: PlaceCategory {
        get { PlaceCategory(rawValue: categoryRaw) ?? .other }
        set { categoryRaw = newValue.rawValue }
    }

    var coordinate: CLLocationCoordinate2D? {
        guard let latitude, let longitude else { return nil }
        return CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }

    /// Sunucuda aynı yeri tanımak için anahtar: ad + yaklaşık koordinat (~100 m).
    var communityKey: String {
        let slug = name.lowercased().trimmingCharacters(in: .whitespaces)
        guard let latitude, let longitude else { return slug }
        return "\(slug)@" + String(format: "%.3f,%.3f", latitude, longitude)
    }

    /// Google Maps'te açan link: kayıtlı URL varsa o, yoksa koordinat/isim araması.
    var mapsLink: URL? {
        if let googleMapsURL, let url = URL(string: googleMapsURL) { return url }
        if let latitude, let longitude {
            return URL(string: "https://www.google.com/maps/search/?api=1&query=\(latitude),\(longitude)")
        }
        let q = name.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? name
        return URL(string: "https://www.google.com/maps/search/?api=1&query=\(q)")
    }
}
