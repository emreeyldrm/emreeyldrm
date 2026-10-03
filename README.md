# Voyage

Voyage, gezdiğin ve gezmek istediğin şehirlerdeki yerleri (restoran, kahve, müze, plaj…) listeler halinde
kaydetmeni, haritada görmeni, gün gün plan yapmanı ve arkadaşlarınla paylaşmanı sağlayan bir seyahat
uygulamasıdır. Yerlere puan ve yorum verilir, herkese açık listeler Keşfet'te görünür, Google Haritalar'daki
kayıtlı listeler içe aktarılabilir. Arayüz Türkçedir; tema yeşil `#2E7D5B`, turuncu `#F28C28`, beyaz.

## Depo düzeni

| Klasör | İçerik |
|---|---|
| `mobile/` | iOS / Android uygulaması (Expo, React Native, TypeScript, expo-router). Ayrıntı: [`mobile/README.md`](mobile/README.md) |
| `backend/` | Canlı API: Cloudflare Worker (Hono) + D1 + R2 |
| `server/` | Aynı API sözleşmesinin NestJS başvuru uygulaması (testler ve web istemcisi için) |
| `web/` | React + Vite web istemcisi. Ayrıntı: [`web/README.md`](web/README.md) |
| `docs/` | Kabul kriterleri ve API sözleşmesi, tasarım notları, ekran tasarımları |
| `scripts/` | Mac kurulumu, telefonda çalıştırma, yayınlama, simge üretimi |
| `.github/workflows/ci.yml` | Her push/PR'da tüm testler (AC-INF-1) |

## Hızlı başlangıç (macOS)

```bash
./scripts/setup-mac.sh     # Homebrew, Node 22, watchman, CocoaPods, Android Studio, iTerm2 + zsh
./scripts/run-phone.sh     # yerel Worker + Expo; telefondaki Expo Go ile QR kodu okut
./scripts/deploy.sh        # Worker'ı Cloudflare hesabına yayınla (D1, R2, gizli anahtar dahil)
./scripts/run-phone.sh --canli   # uygulamayı yayındaki sunucuyla aç
```

TestFlight / EAS derlemeleri ve Google Haritalar anahtarları: [`mobile/README.md` → TestFlight / EAS](mobile/README.md#testflight--eas-ac-inf-2).
Uygulama simgesi ve açılış ekranı: `node scripts/generate-app-icons.mjs`.

## Testler

Her klasörde önce `npm ci` (ya da `npm install`).

```bash
cd server  && npm run test:unit && npm run test:e2e        # NestJS birim + e2e (Jest)
cd backend && npm run typecheck && npm run test:contract   # server/test e2e'leri Worker'a karşı (server'da da npm ci gerekir)
cd mobile  && npm run typecheck && npm run test:unit && npm run e2e:workers   # Playwright, Expo web çıktısı + Worker
cd web     && npm run typecheck && npm run build && npm run e2e               # Playwright, web + NestJS
```

Playwright tarayıcısı: `npx playwright install chromium` (CI'da `--with-deps`). Test adları kabul kriteri
kimliğiyle başlar (ör. `AC-MOB-3: …`).

## Belgeler

- [`docs/ACCEPTANCE.md`](docs/ACCEPTANCE.md): API sözleşmesi ve kabul kriterleri (tek kaynak)
- [`docs/TOPLULUK.md`](docs/TOPLULUK.md): topluluk özellikleri ve Cloudflare mimarisi
- [`docs/TASARIM.md`](docs/TASARIM.md): tasarım notları; ekran tasarımları `docs/design/*.dc.html`
- [`server/README.md`](server/README.md), [`web/README.md`](web/README.md), [`mobile/README.md`](mobile/README.md)
