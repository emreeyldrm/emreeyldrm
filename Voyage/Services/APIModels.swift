import Foundation

// Sunucu yanıtları snake_case gelir; APIClient bunları camelCase'e çevirir.

struct RemoteUser: Decodable {
    let id: Int
    let handle: String?
    let displayName: String?
}

struct AuthResponse: Decodable {
    let token: String
    let user: RemoteUser
}

struct IDResponse: Decodable { let id: Int }
struct Ack: Decodable {}

struct DiscoverList: Decodable, Identifiable, Hashable {
    let id: Int
    let city: String
    let title: String
    let ownerHandle: String?
    let itemCount: Int
    let avgStars: Double?
}

struct RemoteItem: Decodable, Identifiable {
    let placeId: Int
    let name: String
    let lat: Double?
    let lon: Double?
    let category: String
    let note: String
    var id: Int { placeId }
    var placeCategory: PlaceCategory { PlaceCategory(rawValue: category) ?? .other }
}

struct RemoteList: Decodable {
    let id: Int
    let city: String
    let title: String
    let ownerHandle: String?
    let items: [RemoteItem]
}

struct RatingInfo: Decodable {
    struct Bucket: Decodable { let stars: Int; let n: Int }
    let count: Int
    let avg: Double?
    let distribution: [Bucket]
    let mine: Int?
}

struct PlaceInfo: Decodable {
    struct Place: Decodable { let id: Int; let name: String; let category: String }
    let place: Place
    let rating: RatingInfo
}

struct RemoteComment: Decodable, Identifiable {
    let id: Int
    let body: String
    let createdAt: String
    let authorId: Int
    let author: String?
}
