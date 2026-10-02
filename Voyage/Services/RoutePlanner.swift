import CoreLocation

/// Gün içi sıralama ve mesafe hesabı. Düz çizgi (kuş uçuşu) mesafe kullanır.
enum RoutePlanner {
    /// Yakın komşu yöntemi: otel varsa ondan, yoksa mevcut ilk yerden başlar.
    /// Koordinatı olmayan yerler sona, mevcut sırasıyla eklenir.
    static func nearestNeighborOrder(_ places: [Place]) -> [Place] {
        let located = places.filter { $0.coordinate != nil }
        let unlocated = places.filter { $0.coordinate == nil }
        guard var current = located.first(where: { $0.category == .hotel }) ?? located.first else {
            return places
        }
        var remaining = located.filter { $0 !== current }
        var ordered = [current]
        while !remaining.isEmpty {
            let next = remaining.min { distance(current, $0) < distance(current, $1) }!
            ordered.append(next)
            remaining.removeAll { $0 === next }
            current = next
        }
        return ordered + unlocated
    }

    /// Verilen sırayla ardışık yerler arası toplam mesafe (metre).
    static func totalDistance(_ places: [Place]) -> CLLocationDistance {
        zip(places, places.dropFirst()).reduce(0) { $0 + distance($1.0, $1.1) }
    }

    private static func distance(_ a: Place, _ b: Place) -> CLLocationDistance {
        guard let ca = a.coordinate, let cb = b.coordinate else { return 0 }
        return CLLocation(latitude: ca.latitude, longitude: ca.longitude)
            .distance(from: CLLocation(latitude: cb.latitude, longitude: cb.longitude))
    }
}
