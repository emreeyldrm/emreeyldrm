import SwiftUI
import SwiftData
import MapKit

/// Gün gün gezi planı: yerleri günlere ata, sürükleyerek sırala
/// ya da "Sırala" ile en yakın komşu sırasına diz.
struct PlanView: View {
    let city: City
    @State private var dayCount = 3

    private var unplanned: [Place] { city.places.filter { $0.planDay == nil } }

    private func items(day: Int) -> [Place] {
        city.places.filter { $0.planDay == day }.sorted { $0.planOrder < $1.planOrder }
    }

    var body: some View {
        List {
            ForEach(1...dayCount, id: \.self) { day in
                let dayItems = items(day: day)
                Section {
                    ForEach(Array(dayItems.enumerated()), id: \.element.persistentModelID) { index, place in
                        HStack {
                            Text("\(index + 1)").font(.caption.bold())
                                .frame(width: 22, height: 22)
                                .background(Theme.orange, in: Circle()).foregroundStyle(.white)
                            PlaceRow(place: place)
                        }
                        .swipeActions { Button("Çıkar") { place.planDay = nil; renumber(items(day: day)) } }
                    }
                    .onMove { from, to in
                        var list = dayItems
                        list.move(fromOffsets: from, toOffset: to)
                        renumber(list)
                    }
                    Menu("Yer ekle", systemImage: "plus.circle") {
                        ForEach(unplanned) { p in
                            Button(p.name) { p.planDay = day; p.planOrder = dayItems.count }
                        }
                    }.disabled(unplanned.isEmpty)
                } header: {
                    DayHeader(day: day, places: dayItems) {
                        renumber(RoutePlanner.nearestNeighborOrder(dayItems))
                    }
                }
            }
            Section {
                Stepper("Gün sayısı: \(dayCount)", value: $dayCount, in: 1...14)
            }
        }
        .toolbar { EditButton() }
    }

    private func renumber(_ list: [Place]) {
        for (i, p) in list.enumerated() { p.planOrder = i }
    }
}

private struct DayHeader: View {
    let day: Int
    let places: [Place]
    let sort: () -> Void

    var body: some View {
        HStack {
            VStack(alignment: .leading) {
                Text("Gün \(day)").font(.headline).foregroundStyle(Theme.green)
                if places.count > 1 {
                    Text(Measurement(value: RoutePlanner.totalDistance(places), unit: UnitLength.meters)
                        .formatted(.measurement(width: .abbreviated, usage: .road)) + " · kuş uçuşu")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer()
            if places.count > 1 {
                Button("Sırala", systemImage: "arrow.triangle.swap", action: sort)
                NavigationLink {
                    DayMapView(day: day, places: places)
                } label: { Image(systemName: "map") }
            }
        }
        .textCase(nil)
        .font(.subheadline)
    }
}

/// Günün durakları numaralı pinler ve rota çizgisiyle.
struct DayMapView: View {
    let day: Int
    let places: [Place]

    private var located: [(Int, Place, CLLocationCoordinate2D)] {
        places.enumerated().compactMap { i, p in p.coordinate.map { (i + 1, p, $0) } }
    }

    var body: some View {
        Map {
            MapPolyline(coordinates: located.map { $0.2 })
                .stroke(Theme.orange, lineWidth: 4)
            ForEach(located, id: \.1.persistentModelID) { n, place, coord in
                Marker("\(n). \(place.name)", systemImage: place.category.symbol, coordinate: coord)
                    .tint(place.category.color)
            }
        }
        .navigationTitle("Gün \(day)")
        .navigationBarTitleDisplayMode(.inline)
    }
}
