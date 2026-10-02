import SwiftUI

/// Şehir listesini buluta kaydeder ve görünürlüğünü ayarlar.
struct ShareCityView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AuthStore.self) private var auth
    let city: City
    @State private var makePublic: Bool
    @State private var busy = false
    @State private var message: String?

    init(city: City) {
        self.city = city
        _makePublic = State(initialValue: city.isPublic)
    }

    var body: some View {
        NavigationStack {
            Form {
                if auth.isSignedIn {
                    Section {
                        Toggle("Herkese açık", isOn: $makePublic)
                    } footer: {
                        Text(makePublic
                             ? "Liste Keşfet'te görünür; herkes puan ve yorum verebilir. Yer notların da görünür."
                             : "Liste yalnızca sende görünür (buluta yedeklenir).")
                    }
                    Section {
                        Button(busy ? "Kaydediliyor..." : "Buluta kaydet") { Task { await run() } }
                            .disabled(busy)
                    }
                } else {
                    Text("Paylaşmak için Profil sekmesinden giriş yap.")
                }
                if let message { Text(message).font(.footnote).foregroundStyle(.secondary) }
            }
            .navigationTitle("Paylaş")
            .toolbar { Button("Kapat") { dismiss() } }
        }
        .presentationDetents([.medium])
    }

    private func run() async {
        busy = true; defer { busy = false }
        do {
            try await SyncService.push(city: city, makePublic: makePublic)
            message = "Kaydedildi."
        } catch {
            message = error.localizedDescription
        }
    }
}
