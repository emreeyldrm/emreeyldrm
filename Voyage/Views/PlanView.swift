import SwiftUI
import SwiftData

/// Gün gün gezi planı. İlk sürümde yerler günlere elle atanır;
/// mesafeye göre otomatik sıralama sonraki adım.
struct PlanView: View {
    let city: City
    @State private var dayCount = 3

    private var unplanned: [Place] { city.places.filter { $0.planDay == nil } }

    var body: some View {
        List {
            ForEach(1...dayCount, id: \.self) { day in
                Section("Gün \(day)") {
                    let items = city.places.filter { $0.planDay == day }
                    ForEach(items) { place in
                        PlaceRow(place: place)
                            .swipeActions { Button("Çıkar") { place.planDay = nil } }
                    }
                    Menu("Yer ekle", systemImage: "plus.circle") {
                        ForEach(unplanned) { p in Button(p.name) { p.planDay = day } }
                    }.disabled(unplanned.isEmpty)
                }
            }
            Section {
                Stepper("Gün sayısı: \(dayCount)", value: $dayCount, in: 1...14)
            }
        }
    }
}
