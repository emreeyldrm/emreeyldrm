import SwiftUI
import SwiftData

struct PlaceDetailView: View {
    @Bindable var place: Place
    @Environment(\.openURL) private var openURL

    var body: some View {
        Form {
            Section {
                TextField("İsim", text: $place.name)
                Picker("Kategori", selection: $place.category) {
                    ForEach(PlaceCategory.allCases) { Label($0.title, systemImage: $0.symbol).tag($0) }
                }
                Toggle("Gidildi", isOn: $place.visited)
            }
            Section("Not") {
                TextField("Ne sipariş edilir, ipucu...", text: $place.note, axis: .vertical)
                    .lineLimit(3...8)
            }
            Section {
                Button("Google Maps'te aç", systemImage: "map") {
                    if let url = place.mapsLink { openURL(url) }
                }
            }
        }
        .navigationTitle(place.name)
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct AddPlaceView: View {
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    let city: City
    @State private var name = ""
    @State private var category: PlaceCategory = .food
    @State private var note = ""

    var body: some View {
        NavigationStack {
            Form {
                TextField("Yer adı", text: $name)
                Picker("Kategori", selection: $category) {
                    ForEach(PlaceCategory.allCases) { Label($0.title, systemImage: $0.symbol).tag($0) }
                }
                TextField("Not", text: $note, axis: .vertical)
            }
            .navigationTitle("Yeni yer")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("İptal") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Kaydet") {
                        let p = Place(name: name, category: category, note: note)
                        p.city = city
                        context.insert(p)
                        dismiss()
                    }.disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }
}
