import Foundation
import SwiftData

@Model
final class City {
    var name: String
    var country: String
    var createdAt: Date
    /// Sunucudaki liste kimliği (paylaşılmışsa).
    var remoteListID: Int?
    var isPublic: Bool = false
    @Relationship(deleteRule: .cascade, inverse: \Place.city)
    var places: [Place] = []

    init(name: String, country: String = "") {
        self.name = name
        self.country = country
        self.createdAt = Date()
    }
}
