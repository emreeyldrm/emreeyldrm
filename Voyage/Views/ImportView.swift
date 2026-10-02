import SwiftUI
import SwiftData
import UniformTypeIdentifiers

/// Google Takeout'tan alınan liste CSV'sini içe aktarır.
struct ImportView: View {
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    let city: City
    @State private var category: PlaceCategory = .food
    @State private var picking = false
    @State private var busy = false
    @State private var message: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Nasıl?") {
                    Text("takeout.google.com → \"Kayıtlı\" (Saved) seç → indir. İçindeki liste CSV'sini buradan seç. Her liste bir kategoriye aktarılır.")
                        .font(.footnote)
                }
                Picker("Bu liste hangi kategori?", selection: $category) {
                    ForEach(PlaceCategory.allCases) { Label($0.title, systemImage: $0.symbol).tag($0) }
                }
                Button(busy ? "Aktarılıyor..." : "CSV seç", systemImage: "doc") { picking = true }
                    .disabled(busy)
                if let message { Text(message).font(.footnote).foregroundStyle(.secondary) }
            }
            .navigationTitle("İçe aktar")
            .toolbar { Button("Kapat") { dismiss() } }
            .fileImporter(isPresented: $picking, allowedContentTypes: [.commaSeparatedText]) { result in
                guard case .success(let url) = result else { return }
                Task { await run(url) }
            }
        }
    }

    private func run(_ url: URL) async {
        busy = true; defer { busy = false }
        guard url.startAccessingSecurityScopedResource() else { message = "Dosyaya erişilemedi."; return }
        defer { url.stopAccessingSecurityScopedResource() }
        guard let text = try? String(contentsOf: url, encoding: .utf8) else { message = "Dosya okunamadı."; return }
        let rows = TakeoutImporter.parse(csv: text)
        let places = await TakeoutImporter.makePlaces(from: rows, cityName: city.name, category: category)
        for p in places { p.city = city; context.insert(p) }
        message = "\(places.count) yer eklendi."
    }
}
