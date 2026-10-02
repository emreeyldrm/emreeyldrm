#!/usr/bin/env bash
# Voyage sunucusunu (Cloudflare Worker + D1 veritabanı + R2 fotoğraf deposu) senin Cloudflare hesabına yayınlar.
# Kullanım (repo kökünde):  ./scripts/deploy.sh
# Tekrar çalıştırmak güvenlidir: var olan veritabanı ve depo yeniden oluşturulmaz, sadece kod ve şema güncellenir.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/backend"
CONFIG="wrangler.production.toml"   # senin hesabına özel; Git'e girmez
STATE=".deploy.env"                 # yayın adresi; Git'e girmez
DB_NAME="voyage"
BUCKET="voyage-media"
W="npx wrangler"
export WRANGLER_SEND_METRICS=false

say() { printf '\n==> %s\n' "$*"; }
die() { printf '\nHATA: %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null || die "Node bulunamadı. Önce ./scripts/setup-mac.sh çalıştır."
[[ -d node_modules ]] || { say "Sunucu paketleri kuruluyor"; npm install; }

# 1. Cloudflare girişi (tarayıcı açılır, hesabınla onayla)
if ! $W whoami 2>/dev/null | grep -qi "associated with the email\|account id"; then
  say "Cloudflare'e giriş: tarayıcıda açılan sayfada 'Allow' de"
  $W login
fi
$W whoami | grep -i "email" || true

# 2. D1 veritabanı
db_id() { $W d1 list --json 2>/dev/null | node -e '
  let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const l=JSON.parse(s);const d=l.find(x=>x.name===process.argv[1]);if(d)console.log(d.uuid)}catch{}})' "$DB_NAME"; }
DB_ID="$(db_id)"
if [[ -z "$DB_ID" ]]; then
  say "Veritabanı oluşturuluyor ($DB_NAME)"
  $W d1 create "$DB_NAME"
  DB_ID="$(db_id)"
fi
[[ -n "$DB_ID" ]] || die "Veritabanı kimliği alınamadı. 'npx wrangler d1 list' çıktısına bak."
say "Veritabanı: $DB_NAME ($DB_ID)"

# 3. R2 fotoğraf deposu
if ! $W r2 bucket list 2>/dev/null | grep -q "$BUCKET"; then
  say "Fotoğraf deposu oluşturuluyor ($BUCKET)"
  $W r2 bucket create "$BUCKET" || die "R2 deposu oluşturulamadı. Cloudflare panelinde R2'yi bir kez etkinleştirmen gerekebilir (dash.cloudflare.com → R2), sonra betiği tekrar çalıştır."
fi

# 4. Hesaba özel ayar dosyası (wrangler.toml'dan, gerçek veritabanı kimliğiyle)
sed "s/^database_id = .*/database_id = \"$DB_ID\"/" wrangler.toml > "$CONFIG"

# 5. Şema (migrations) — mevcut veriler korunur, sadece eksik adımlar uygulanır
say "Veritabanı şeması güncelleniyor"
$W d1 migrations apply "$DB_NAME" --remote --config "$CONFIG"

# 6. Yayın
say "Sunucu yayınlanıyor"
OUT="$($W deploy --config "$CONFIG" 2>&1 | tee /dev/stderr)"
URL="$(printf '%s' "$OUT" | grep -oE 'https://[a-zA-Z0-9.-]+\.workers\.dev' | head -1 || true)"
[[ -n "$URL" ]] || die "Yayın adresi bulunamadı. Yukarıdaki çıktıya bak (workers.dev alt alan adı ilk seferde soruluyor olabilir)."

# 7. Gizli oturum anahtarı (yalnızca ilk seferde; değiştirmek tüm oturumları kapatır)
if ! $W secret list --config "$CONFIG" 2>/dev/null | grep -q "SESSION_SECRET"; then
  say "Oturum anahtarı tanımlanıyor"
  openssl rand -hex 32 | $W secret put SESSION_SECRET --config "$CONFIG"
fi

echo "API_URL=$URL" > "$STATE"

# 8. Kontrol: oturumsuz istek 401 dönmeli
say "Kontrol ediliyor: $URL"
CODE=""
for _ in $(seq 1 20); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "$URL/me" || true)"
  [[ "$CODE" == "401" ]] && break
  sleep 2
done
[[ "$CODE" == "401" ]] || die "Sunucu beklenen yanıtı vermedi (HTTP $CODE). 'npx wrangler tail --config backend/$CONFIG' ile kayıtlara bak."

echo
echo "Tamam! Sunucun yayında: $URL"
echo "Telefonda bu sunucuyla denemek için:  ./scripts/run-phone.sh --canli"
