import SwiftUI
import SwiftData

@main
struct VoyageApp: App {
    var body: some Scene {
        WindowGroup {
            CitiesView()
                .tint(Theme.green)
                .background(Theme.background)
        }
        .modelContainer(for: [City.self, Place.self])
    }
}
