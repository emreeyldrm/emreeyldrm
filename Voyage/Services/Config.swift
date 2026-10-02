import Foundation

enum Config {
    /// `wrangler deploy` sonrası çıkan adresle değiştir. Yerelde: http://localhost:8787
    static let apiBaseURL = URL(string: "https://voyage-api.example.workers.dev")!
}
