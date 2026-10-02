import SwiftUI

struct DiscoverView: View {
    @Environment(AuthStore.self) private var auth
    @State private var city = ""
    @State private var lists: [DiscoverList] = []
    @State private var loading = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Group {
                if !auth.isSignedIn {
                    ContentUnavailableView("Giriş yap", systemImage: "person.crop.circle",
                        description: Text("Topluluk listelerini görmek için Profil sekmesinden giriş yap."))
                } else if let error {
                    ContentUnavailableView("Yüklenemedi", systemImage: "wifi.slash", description: Text(error))
                } else if lists.isEmpty && !loading {
                    ContentUnavailableView("Liste yok", systemImage: "map",
                        description: Text("Bu şehir için herkese açık liste bulunamadı."))
                } else {
                    List(lists) { list in
                        NavigationLink(value: list) { DiscoverRow(list: list) }
                            .listRowSeparator(.hidden)
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Keşfet")
            .searchable(text: $city, prompt: "Şehir ara")
            .onSubmit(of: .search) { Task { await load() } }
            .task(id: auth.isSignedIn) { if auth.isSignedIn { await load() } }
            .navigationDestination(for: DiscoverList.self) { PublicListView(listID: $0.id, title: $0.title) }
        }
    }

    private func load() async {
        loading = true; defer { loading = false }
        let q = city.trimmingCharacters(in: .whitespaces)
        let encoded = q.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? q
        do {
            lists = try await APIClient.shared.send("GET", "/discover/lists" + (q.isEmpty ? "" : "?city=\(encoded)"))
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct DiscoverRow: View {
    let list: DiscoverList

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(list.title).font(.headline).foregroundStyle(Theme.green)
            HStack(spacing: 12) {
                Text(list.city)
                if let handle = list.ownerHandle { Text("@\(handle)") }
                Text("\(list.itemCount) yer")
                if let stars = list.avgStars {
                    Label(String(format: "%.1f", stars), systemImage: "star.fill")
                        .foregroundStyle(Theme.orange)
                }
            }
            .font(.footnote).foregroundStyle(.secondary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.greenLight, in: RoundedRectangle(cornerRadius: 18))
    }
}

struct PublicListView: View {
    let listID: Int
    let title: String
    @State private var list: RemoteList?
    @State private var error: String?

    var body: some View {
        List {
            if let list {
                ForEach(list.items) { item in
                    NavigationLink {
                        PlaceReviewsView(placeID: item.placeId, name: item.name, category: item.placeCategory)
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: item.placeCategory.symbol)
                                .foregroundStyle(item.placeCategory.color)
                                .frame(width: 34, height: 34)
                                .background(item.placeCategory.tint, in: Circle())
                            VStack(alignment: .leading) {
                                Text(item.name)
                                if !item.note.isEmpty {
                                    Text(item.note).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                }
                            }
                        }
                    }
                }
            } else if let error {
                Text(error).foregroundStyle(.secondary)
            } else {
                ProgressView()
            }
        }
        .listStyle(.plain)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            do { list = try await APIClient.shared.send("GET", "/lists/\(listID)") }
            catch { self.error = error.localizedDescription }
        }
    }
}
