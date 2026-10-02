import SwiftUI
import SwiftData

@main
struct VoyageApp: App {
    var body: some Scene {
        WindowGroup {
            CitiesView()
        }
        .modelContainer(for: [City.self, Place.self])
    }
}
