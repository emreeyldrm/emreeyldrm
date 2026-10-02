import AuthenticationServices
import Observation

@Observable @MainActor
final class AuthStore {
    var user: RemoteUser?
    var isSignedIn: Bool
    var errorMessage: String?

    init() {
        isSignedIn = Keychain.token != nil
    }

    func configure(_ request: ASAuthorizationAppleIDRequest) {
        request.requestedScopes = [.fullName]
    }

    func complete(_ result: Result<ASAuthorization, Error>) async {
        switch result {
        case .failure(let error):
            if (error as? ASAuthorizationError)?.code != .canceled {
                errorMessage = error.localizedDescription
            }
        case .success(let auth):
            guard let credential = auth.credential as? ASAuthorizationAppleIDCredential,
                  let data = credential.identityToken,
                  let jwt = String(data: data, encoding: .utf8) else {
                errorMessage = "Apple jetonu okunamadı."
                return
            }
            do {
                let r: AuthResponse = try await APIClient.shared.send(
                    "POST", "/auth/apple", body: ["identityToken": jwt])
                Keychain.token = r.token
                user = r.user
                isSignedIn = true
                errorMessage = nil
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    func refresh() async {
        guard isSignedIn else { return }
        do {
            user = try await APIClient.shared.send("GET", "/me")
        } catch APIError.notSignedIn {
            signOut()
        } catch {}
    }

    func saveHandle(_ handle: String) async {
        do {
            try await APIClient.shared.perform("PUT", "/me", body: ["handle": handle])
            errorMessage = nil
            await refresh()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func signOut() {
        Keychain.token = nil
        user = nil
        isSignedIn = false
    }

    /// Hesabı ve sunucudaki tüm verisini siler (App Store zorunluluğu).
    func deleteAccount() async {
        do {
            try await APIClient.shared.perform("DELETE", "/me")
            signOut()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
