import SwiftUI

/// Yeşil, turuncu ve beyaz tema.
enum Theme {
    static let green = Color(red: 0.18, green: 0.49, blue: 0.36)       // ana renk
    static let greenLight = Color(red: 0.90, green: 0.96, blue: 0.92)  // yumuşak yeşil zemin
    static let orange = Color(red: 0.95, green: 0.55, blue: 0.16)      // vurgu
    static let background = Color.white
}

extension Color {
    /// 0xRRGGBB
    init(hex: UInt32) {
        self.init(red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255)
    }
}
