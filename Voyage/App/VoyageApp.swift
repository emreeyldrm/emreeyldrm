import SwiftUI
import SwiftData

@main
struct VoyageApp: App {
    @State private var auth = AuthStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(auth)
                .tint(Theme.green)
                .background(Theme.background)
        }
        .modelContainer(for: [City.self, Place.self])
    }
}
