import SwiftUI
import SwiftData

struct CitiesView: View {
    @Environment(\.modelContext) private var context
    @Query(sort: \City.createdAt, order: .reverse) private var cities: [City]
    @State private var showingAdd = false

    var body: some View {
        NavigationStack {
            List {
                ForEach(cities) { city in
                    NavigationLink(value: city) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(city.name).font(.headline).foregroundStyle(Theme.green)
                            Text("\(city.places.count) yer" + (city.country.isEmpty ? "" : " · \(city.country)"))
                                .font(.subheadline).foregroundStyle(.secondary)
                        }
                    }
                }
                .onDelete { offsets in offsets.map { cities[$0] }.forEach(context.delete) }
            }
            .overlay {
                if cities.isEmpty {
                    ContentUnavailableView("Henüz şehir yok", systemImage: "airplane",
                        description: Text("Sağ üstten bir şehir ekle."))
                }
            }
            .listStyle(.plain)
            .navigationTitle("Şehirlerim")
            .navigationDestination(for: City.self) { CityDetailView(city: $0) }
            .toolbar {
                Button("Ekle", systemImage: "plus") { showingAdd = true }
                    .tint(Theme.orange)
            }
            .sheet(isPresented: $showingAdd) { AddCityView() }
        }
    }
}

struct AddCityView: View {
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var country = ""

    var body: some View {
        NavigationStack {
            Form {
                TextField("Şehir", text: $name)
                TextField("Ülke (isteğe bağlı)", text: $country)
            }
            .navigationTitle("Yeni şehir")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("İptal") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Kaydet") {
                        context.insert(City(name: name, country: country))
                        dismiss()
                    }.disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .presentationDetents([.medium])
    }
}
