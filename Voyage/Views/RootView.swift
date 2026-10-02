import SwiftUI

struct RootView: View {
    var body: some View {
        TabView {
            DiscoverView()
                .tabItem { Label("Keşfet", systemImage: "safari") }
            CitiesView()
                .tabItem { Label("Listelerim", systemImage: "mappin.and.ellipse") }
            MessagesPlaceholderView()
                .tabItem { Label("Mesajlar", systemImage: "bubble.left.and.bubble.right") }
            ProfileView()
                .tabItem { Label("Profil", systemImage: "person.crop.circle") }
        }
    }
}

struct MessagesPlaceholderView: View {
    var body: some View {
        NavigationStack {
            ContentUnavailableView("Yakında", systemImage: "bubble.left.and.bubble.right",
                description: Text("Arkadaşlarınla liste ve yer paylaşabileceğin mesajlaşma sonraki sürümde."))
                .navigationTitle("Mesajlar")
        }
    }
}
