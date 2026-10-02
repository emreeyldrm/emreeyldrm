import Foundation

enum APIError: LocalizedError {
    case notSignedIn
    case http(Int, String)

    var errorDescription: String? {
        switch self {
        case .notSignedIn: "Önce giriş yapmalısın."
        case .http(_, let message): message
        }
    }
}

private struct ErrorBody: Decodable { let error: String }

/// Voyage API'si (Cloudflare Worker) istemcisi.
struct APIClient {
    static let shared = APIClient()

    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        return d
    }()

    /// `path` sorgu dizesi içeriyorsa değerleri önceden yüzde-kodlanmış olmalı.
    func send<T: Decodable>(_ method: String, _ path: String,
                            body: (any Encodable)? = nil) async throws -> T {
        guard let url = URL(string: Config.apiBaseURL.absoluteString + path) else {
            throw APIError.http(0, "Geçersiz adres")
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        if let token = Keychain.token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            if status == 401 { throw APIError.notSignedIn }
            let message = (try? decoder.decode(ErrorBody.self, from: data))?.error ?? "Sunucu hatası (\(status))"
            throw APIError.http(status, message)
        }
        return try decoder.decode(T.self, from: data)
    }

    /// Yanıt gövdesi umursanmayan istekler için.
    func perform(_ method: String, _ path: String, body: (any Encodable)? = nil) async throws {
        let _: Ack = try await send(method, path, body: body)
    }
}
