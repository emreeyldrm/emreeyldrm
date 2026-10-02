import SwiftUI

enum PlaceCategory: String, Codable, CaseIterable, Identifiable {
    case food, coffee, bar, historic, airport, other

    var id: String { rawValue }

    var title: String {
        switch self {
        case .food: "Yemek"
        case .coffee: "Kahve"
        case .bar: "Bar"
        case .historic: "Tarihi"
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
        case .airport: "airplane"
        case .other: "mappin"
        }
    }

    /// Temaya uyumlu, birbirinden ayırt edilebilir renkler.
    var color: Color {
        switch self {
        case .food: Theme.orange
        case .coffee: Color(red: 0.55, green: 0.36, blue: 0.22)
        case .bar: Color(red: 0.62, green: 0.20, blue: 0.35)
        case .historic: Theme.green
        case .airport: Color(red: 0.25, green: 0.45, blue: 0.70)
        case .other: .gray
        }
    }
}
