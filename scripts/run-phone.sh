#!/usr/bin/env bash
# Voyage'ı telefonda denemek için: yerel sunucuyu (Cloudflare Worker) ve Expo'yu birlikte başlatır.
# Kullanım (repo kökünde):  ./scripts/run-phone.sh
# Durdurmak için: Ctrl+C (ikisini birden kapatır). Veriler kapatınca silinmez.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT=8787

command -v node >/dev/null || { echo "Node bulunamadı. Önce ./scripts/setup-mac.sh çalıştır."; exit 1; }

# Mac'in yerel ağdaki IP adresi (telefon sunucuya bununla ulaşır)
IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
if [[ -z "$IP" ]]; then
  echo "Wi-Fi IP adresi bulunamadı. Mac ve telefon aynı Wi-Fi ağında olmalı."
  exit 1
fi

# 1. Sunucu
cd "$ROOT/backend"
[[ -d node_modules ]] || { echo "==> Sunucu paketleri kuruluyor"; npm install; }
if [[ ! -f .dev.vars ]]; then
  echo "SESSION_SECRET=$(openssl rand -hex 32)" > .dev.vars
fi
echo "==> Veritabanı hazırlanıyor"
npx wrangler d1 migrations apply voyage --local >/dev/null
echo "==> Sunucu başlatılıyor: http://$IP:$PORT"
WRANGLER_SEND_METRICS=false npx wrangler dev --ip 0.0.0.0 --port "$PORT" > "$ROOT/backend/.wrangler-phone.log" 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT

for _ in $(seq 1 60); do
  curl -s -o /dev/null "http://$IP:$PORT/me" && break
  sleep 1
done
curl -s -o /dev/null "http://$IP:$PORT/me" || { echo "Sunucu açılmadı, kayıt: backend/.wrangler-phone.log"; exit 1; }

# 2. Uygulama
cd "$ROOT/mobile"
[[ -d node_modules ]] || { echo "==> Uygulama paketleri kuruluyor"; npm install; }
echo
echo "==> Telefonda Expo Go uygulamasını aç ve çıkan QR kodu okut (iPhone'da Kamera ile)."
echo
EXPO_PUBLIC_API_URL="http://$IP:$PORT" npx expo start
