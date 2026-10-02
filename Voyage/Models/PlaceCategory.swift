import SwiftUI

enum PlaceCategory: String, Codable, CaseIterable, Identifiable {
    case food, coffee, bar, historic, museum, park, beach, hotel, airport, other

    var id: String { rawValue }

    var title: String {
        switch self {
        case .food: "Yemek"
        case .coffee: "Kahve"
        case .bar: "Bar"
        case .historic: "Tarihi"
        case .museum: "Müze"
        case .park: "Park"
        case .beach: "Plaj"
        case .hotel: "Otel"
        case .airport: "Havalimanı"
        case .other: "Diğer"
        }
    }

    var symbol: String {
        switch self {
        case .food: "fork.knife"
        case .coffee: "cup.and.saucer.fill"
        case .bar: "wineglass.fill"
        case .historic: "building.columns.fill"
        case .museum: "paintpalette.fill"
        case .park: "tree.fill"
        case .beach: "beach.umbrella.fill"
        case .hotel: "bed.double.fill"
        case .airport: "airplane"
        case .other: "mappin"
        }
    }

    /// Koyu ton: simge, yazı ve harita pini dolgusu (beyaz zeminde okunur).
    var color: Color {
        switch self {
        case .food: Color(hex: 0xC2610C)
        case .coffee: Color(hex: 0x8C5C38)
        case .bar: Color(hex: 0x9E3359)
        case .historic: Color(hex: 0x2E7D5B)
        case .museum: Color(hex: 0x8F6A00)
        case .park: Color(hex: 0x3F7D22)
        case .beach: Color(hex: 0x0B7C8A)
        case .hotel: Color(hex: 0x5C54B3)
        case .airport: Color(hex: 0x2F5F9E)
        case .other: Color(hex: 0x55645C)
        }
    }

    /// Açık ton: yuvarlak simge ve filtre çipi zemini.
    var tint: Color {
        switch self {
        case .food: Color(hex: 0xFFF1E2)
        case .coffee: Color(hex: 0xF4ECE6)
        case .bar: Color(hex: 0xF9E8EE)
        case .historic: Color(hex: 0xE6F5EB)
        case .museum: Color(hex: 0xFBF1D6)
        case .park: Color(hex: 0xE9F5DF)
        case .beach: Color(hex: 0xDDF3F6)
        case .hotel: Color(hex: 0xEAE8F7)
        case .airport: Color(hex: 0xE1EBF7)
        case .other: Color(hex: 0xEEF1EF)
        }
    }
}
