#!/usr/bin/env bash
# Voyage için macOS geliştirme ortamını kurar: Homebrew, iTerm2, Zsh ve proje araçları.
# Tekrar çalıştırmak güvenlidir; kurulu olanları atlar.
set -euo pipefail

if [[ "$(uname)" != "Darwin" ]]; then
  echo "Bu betik yalnızca macOS içindir." >&2
  exit 1
fi

# 1. Xcode komut satırı araçları (git, derleyici). Tam Xcode'u App Store'dan ayrıca kur.
if ! xcode-select -p >/dev/null 2>&1; then
  echo "==> Xcode komut satırı araçları kuruluyor (açılan pencerede onayla, sonra betiği tekrar çalıştır)"
  xcode-select --install
  exit 0
fi

# 2. Homebrew
if ! command -v brew >/dev/null 2>&1; then
  echo "==> Homebrew kuruluyor"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi
# Apple Silicon (/opt/homebrew) ve Intel (/usr/local) yollarını oturuma ekle
if [[ -x /opt/homebrew/bin/brew ]]; then BREW=/opt/homebrew/bin/brew; else BREW=/usr/local/bin/brew; fi
eval "$("$BREW" shellenv)"

# 3. Brewfile'daki her şey
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
echo "==> Brewfile paketleri kuruluyor"
brew bundle --file="$REPO_ROOT/Brewfile"

# 4. Zsh ayarları: Homebrew yolu, node@22 ve eklentiler (bir kez eklenir)
ZSHRC="$HOME/.zshrc"
touch "$ZSHRC"
add_line() { grep -qxF "$1" "$ZSHRC" || echo "$1" >> "$ZSHRC"; }
add_line "# --- Voyage setup ---"
add_line "eval \"\$($BREW shellenv)\""
add_line "export PATH=\"\$(brew --prefix node@22)/bin:\$PATH\""
add_line "source \$(brew --prefix)/share/zsh-autosuggestions/zsh-autosuggestions.zsh"
add_line "source \$(brew --prefix)/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh"

# 5. Varsayılan kabuk zsh değilse değiştir (macOS'ta genelde zaten zsh)
if [[ "${SHELL:-}" != */zsh ]]; then
  echo "==> Varsayılan kabuk zsh yapılıyor"
  chsh -s /bin/zsh
fi

echo
echo "Tamam. iTerm'i aç ve yeni bir pencerede şunları dene:"
echo "  node -v && watchman -v && xcodegen --version && pod --version"
echo "Tam Xcode App Store'dan kurulmalı (iOS simülatörü için)."
