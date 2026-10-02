import SwiftUI
import SwiftData
import MapKit

struct CityDetailView: View {
    @Environment(\.modelContext) private var context
    let city: City

    enum Mode: String, CaseIterable { case list = "Liste", map = "Harita", plan = "Plan" }
    @State private var mode: Mode = .list
    @State private var filter: PlaceCategory?
    @State private var showingAdd = false
    @State private var showingImport = false

    private var filtered: [Place] {
        city.places
            .filter { filter == nil || $0.category == filter }
            .sorted { $0.name < $1.name }
    }

    var body: some View {
        VStack(spacing: 0) {
            Picker("Görünüm", selection: $mode) {
                ForEach(Mode.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented).padding(.horizontal).padding(.top, 8)

            if mode != .plan { CategoryFilterBar(selection: $filter) }

            switch mode {
            case .list: PlaceListView(places: filtered)
            case .map: PlaceMapView(places: filtered)
            case .plan: PlanView(city: city)
            }
        }
        .navigationTitle(city.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            Menu("Ekle", systemImage: "plus") {
                Button("Yer ekle", systemImage: "mappin.and.ellipse") { showingAdd = true }
                Button("Google'dan içe aktar", systemImage: "square.and.arrow.down") { showingImport = true }
            }
        }
        .sheet(isPresented: $showingAdd) { AddPlaceView(city: city) }
        .sheet(isPresented: $showingImport) { ImportView(city: city) }
    }
}

struct CategoryFilterBar: View {
    @Binding var selection: PlaceCategory?

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack {
                chip("Hepsi", symbol: "square.grid.2x2", color: Theme.green, active: selection == nil) { selection = nil }
                ForEach(PlaceCategory.allCases) { c in
                    chip(c.title, symbol: c.symbol, color: c.color, active: selection == c) { selection = c }
                }
            }
            .padding(.horizontal).padding(.vertical, 8)
        }
    }

    private func chip(_ title: String, symbol: String, color: Color, active: Bool,
                      action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .font(.subheadline)
                .padding(.horizontal, 12).padding(.vertical, 6)
                .background(active ? color : color.opacity(0.15), in: Capsule())
                .foregroundStyle(active ? .white : color)
        }
    }
}

struct PlaceListView: View {
    @Environment(\.modelContext) private var context
    let places: [Place]

    var body: some View {
        List {
            ForEach(places) { place in
                NavigationLink(value: place) { PlaceRow(place: place) }
            }
            .onDelete { offsets in offsets.map { places[$0] }.forEach(context.delete) }
        }
        .listStyle(.plain)
        .navigationDestination(for: Place.self) { PlaceDetailView(place: $0) }
        .overlay {
            if places.isEmpty {
                ContentUnavailableView("Yer yok", systemImage: "mappin.slash")
            }
        }
    }
}

struct PlaceRow: View {
    let place: Place

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: place.category.symbol)
                .foregroundStyle(.white)
                .frame(width: 34, height: 34)
                .background(place.category.color, in: Circle())
            VStack(alignment: .leading) {
                Text(place.name).font(.body)
                if !place.note.isEmpty {
                    Text(place.note).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            Spacer()
            if place.visited { Image(systemName: "checkmark.circle.fill").foregroundStyle(.green) }
        }
    }
}

struct PlaceMapView: View {
    let places: [Place]

    var body: some View {
        Map {
            ForEach(places) { place in
                if let coordinate = place.coordinate {
                    Marker(place.name, systemImage: place.category.symbol, coordinate: coordinate)
                        .tint(place.category.color)
                }
            }
        }
        .mapControls { MapUserLocationButton(); MapCompass() }
    }
}
