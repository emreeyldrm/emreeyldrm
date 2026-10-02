import SwiftUI
import AuthenticationServices

struct ProfileView: View {
    @Environment(AuthStore.self) private var auth
    @State private var handle = ""
    @State private var confirmDelete = false

    var body: some View {
        NavigationStack {
            Form {
                if auth.isSignedIn {
                    Section("Kullanıcı adı") {
                        TextField("kullanici_adi", text: $handle)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        Button("Kaydet") { Task { await auth.saveHandle(handle) } }
                            .disabled(handle.count < 3)
                    }
                    Section {
                        Button("Çıkış yap") { auth.signOut() }
                        Button("Hesabı sil", role: .destructive) { confirmDelete = true }
                    }
                } else {
                    Section {
                        SignInWithAppleButton(.signIn,
                            onRequest: { auth.configure($0) },
                            onCompletion: { result in Task { await auth.complete(result) } })
                            .frame(height: 50)
                    } footer: {
                        Text("Giriş yapmadan listelerini cihazında kullanabilirsin. Paylaşmak, yorum yapmak ve puanlamak için giriş gerekir.")
                    }
                }
                if let message = auth.errorMessage {
                    Section { Text(message).foregroundStyle(.red).font(.footnote) }
                }
            }
            .navigationTitle("Profil")
            .task { await auth.refresh(); handle = auth.user?.handle ?? "" }
            .confirmationDialog("Hesabın ve paylaştığın her şey silinecek.", isPresented: $confirmDelete,
                                titleVisibility: .visible) {
                Button("Hesabı sil", role: .destructive) { Task { await auth.deleteAccount() } }
            }
        }
    }
}
