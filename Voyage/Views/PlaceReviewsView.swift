import SwiftUI

private struct StarBody: Encodable { let stars: Int }
private struct CommentBody: Encodable { let body: String }
private struct ReportBody: Encodable { let targetType: String; let targetId: Int; let reason: String }

/// Bir yerin topluluk puanı ve yorumları.
struct PlaceReviewsView: View {
    let placeID: Int
    let name: String
    let category: PlaceCategory

    @State private var info: PlaceInfo?
    @State private var comments: [RemoteComment] = []
    @State private var draft = ""
    @State private var error: String?

    var body: some View {
        List {
            Section {
                HStack(alignment: .firstTextBaseline) {
                    Text(info?.rating.avg.map { String(format: "%.1f", $0) } ?? "–")
                        .font(.system(size: 44, weight: .heavy))
                    VStack(alignment: .leading) {
                        stars(Int((info?.rating.avg ?? 0).rounded()))
                        Text("\(info?.rating.count ?? 0) puan").font(.caption).foregroundStyle(.secondary)
                    }
                }
                HStack {
                    Text("Senin puanın").font(.subheadline.bold()).foregroundStyle(Theme.green)
                    Spacer()
                    ForEach(1...5, id: \.self) { n in
                        Button { Task { await rate(n) } } label: {
                            Image(systemName: n <= (info?.rating.mine ?? 0) ? "star.fill" : "star")
                                .foregroundStyle(Theme.orange).font(.title2)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("\(n) yıldız")
                    }
                }
            }
            Section("Yorumlar") {
                ForEach(comments) { comment in
                    VStack(alignment: .leading, spacing: 4) {
                        Text("@\(comment.author ?? "?")").font(.footnote.bold())
                        Text(comment.body)
                    }
                    .swipeActions {
                        Button("Şikayet") { Task { await report(comment) } }.tint(Theme.orange)
                        Button("Engelle") { Task { await block(comment) } }.tint(.red)
                    }
                }
                if comments.isEmpty { Text("Henüz yorum yok.").foregroundStyle(.secondary) }
            }
            if let error { Section { Text(error).foregroundStyle(.red).font(.footnote) } }
        }
        .navigationTitle(name)
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) {
            HStack {
                TextField("Yorum yaz...", text: $draft)
                    .padding(.horizontal, 14).frame(height: 44)
                    .background(Theme.greenLight, in: Capsule())
                Button { Task { await send() } } label: {
                    Image(systemName: "arrow.up.circle.fill").font(.system(size: 36))
                }
                .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .padding(.horizontal).padding(.vertical, 8).background(.bar)
        }
        .task { await load() }
    }

    private func stars(_ filled: Int) -> some View {
        HStack(spacing: 2) {
            ForEach(1...5, id: \.self) { n in
                Image(systemName: n <= filled ? "star.fill" : "star").foregroundStyle(Theme.orange)
            }
        }
    }

    private func load() async {
        do {
            info = try await APIClient.shared.send("GET", "/places/\(placeID)")
            comments = try await APIClient.shared.send("GET", "/places/\(placeID)/comments")
            error = nil
        } catch { self.error = error.localizedDescription }
    }

    private func rate(_ n: Int) async {
        do {
            try await APIClient.shared.perform("PUT", "/places/\(placeID)/rating", body: StarBody(stars: n))
            await load()
        } catch { self.error = error.localizedDescription }
    }

    private func send() async {
        do {
            try await APIClient.shared.perform("POST", "/places/\(placeID)/comments", body: CommentBody(body: draft))
            draft = ""
            await load()
        } catch { self.error = error.localizedDescription }
    }

    private func report(_ c: RemoteComment) async {
        do {
            try await APIClient.shared.perform("POST", "/reports",
                body: ReportBody(targetType: "comment", targetId: c.id, reason: "uygunsuz"))
            comments.removeAll { $0.id == c.id }
        } catch { self.error = error.localizedDescription }
    }

    private func block(_ c: RemoteComment) async {
        do {
            try await APIClient.shared.perform("POST", "/blocks/\(c.authorId)")
            comments.removeAll { $0.authorId == c.authorId }
        } catch { self.error = error.localizedDescription }
    }
}
