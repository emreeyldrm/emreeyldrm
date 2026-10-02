import Foundation

private struct CreateList: Encodable { let city: String; let title: String; let visibility: String }
private struct PatchList: Encodable { let visibility: String }
private struct SyncItem: Encodable {
    let provider = "voyage"
    let providerId: String
    let name: String
    let lat: Double?
    let lon: Double?
    let category: String
    let city: String
    let note: String
}
private struct SyncBody: Encodable { let items: [SyncItem] }

/// Yerel şehri sunucudaki bir listeyle eşler ve içeriğini gönderir.
@MainActor
enum SyncService {
    static func push(city: City, makePublic: Bool) async throws {
        let api = APIClient.shared
        let visibility = makePublic ? "public" : "private"
        if let id = city.remoteListID {
            try await api.perform("PATCH", "/lists/\(id)", body: PatchList(visibility: visibility))
        } else {
            let created: IDResponse = try await api.send(
                "POST", "/lists", body: CreateList(city: city.name, title: city.name, visibility: visibility))
            city.remoteListID = created.id
        }
        let items = city.places.map {
            SyncItem(providerId: $0.communityKey, name: $0.name, lat: $0.latitude, lon: $0.longitude,
                     category: $0.categoryRaw, city: city.name, note: $0.note)
        }
        try await api.perform("PUT", "/lists/\(city.remoteListID!)/items", body: SyncBody(items: items))
        city.isPublic = makePublic
    }
}
