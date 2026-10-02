import SwiftUI

enum PlaceCategory: String, Codable, CaseIterable, Identifiable {
    case food, coffee, bar, historic, other

    var id: String { rawValue }

    var title: String {
        switch self {
        case .food: "Yemek"
        case .coffee: "Kahve"
        case .bar: "Bar"
        case .historic: "Tarihi"
        case .other: "Diğer"
        }
    }

    var symbol: String {
        switch self {
        case .food: "fork.knife"
        case .coffee: "cup.and.saucer.fill"
        case .bar: "wineglass.fill"
        case .historic: "building.columns.fill"
        case .other: "mappin"
        }
    }

    var color: Color {
        switch self {
        case .food: .orange
        case .coffee: .brown
        case .bar: .purple
        case .historic: .teal
        case .other: .gray
        }
    }
}
