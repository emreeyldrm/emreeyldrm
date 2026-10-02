// Place details, media uploads and comment photos (docs/ACCEPTANCE.md, "Yer detayları ve fotoğraflar (DET)").
//
// THIS FILE IS SHARED VERBATIM between server/src/lists/details-core.ts (NestJS) and
// backend/src/details-core.ts (Cloudflare Worker). Edit one, then copy it over the other:
//   cp server/src/lists/details-core.ts backend/src/details-core.ts
// server/test/unit/details-core.spec.ts fails if the two copies differ.
//
// Pure functions only: no framework, database or runtime dependencies (randomness is passed in).

export const WAIT_RANGES = ['0-10', '10-20', '20-30', '30-45', '45+'] as const
export type WaitRange = (typeof WAIT_RANGES)[number]
export const RECOMMENDATIONS = ['dine_in', 'takeout', 'either'] as const
export type Recommendation = (typeof RECOMMENDATIONS)[number]

export const MAX_FAVORITES = 10
export const MAX_FAVORITE_LENGTH = 60
export const MAX_PHOTOS = 6
export const MAX_COMMENT_PHOTOS = 4
export const MAX_SPEND = 100_000
export const MAX_COMMENT_LENGTH = 1000

export interface PlaceDetails {
  dineIn?: boolean
  takeout?: boolean
  waitDineIn?: WaitRange
  waitTakeout?: WaitRange
  recommendation?: Recommendation
  spendPerPerson?: number
  currency?: string
  favorites?: string[]
  photos?: string[]
}

/** Invalid input: always mapped to HTTP 400 `{error}` (415/413 for uploads, see checkUpload). */
export class DetailsError extends Error {
  constructor(message: string, public status: 400 | 413 | 415 = 400) { super(message) }
}

const absent = (v: unknown) => v === undefined || v === null
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

// ---------- Media ----------
export const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const MEDIA_MAX_BYTES = 5 * 1024 * 1024
/** 128 random bits, lowercase hex. */
export const MEDIA_ID_RE = /^[0-9a-f]{32}$/
export const MEDIA_CACHE_CONTROL = 'public, max-age=31536000, immutable'

export const isMediaId = (v: unknown): v is string => typeof v === 'string' && MEDIA_ID_RE.test(v)

/** Media id from 16 random bytes (crypto.getRandomValues on the Worker, crypto.randomBytes on Node). */
export function mediaIdFromBytes(bytes: Uint8Array): string {
  if (bytes.length < 16) throw new Error('media id needs at least 16 random bytes')
  return Array.from(bytes.subarray(0, 16), (b) => b.toString(16).padStart(2, '0')).join('')
}

export const mediaUrl = (id: string) => `/media/${id}`

/** `image/png; charset=x` -> `image/png`; null when the type is not an accepted image type. */
export function mediaType(contentType: unknown): (typeof MEDIA_TYPES)[number] | null {
  if (typeof contentType !== 'string') return null
  const t = contentType.split(';')[0].trim().toLowerCase()
  return (MEDIA_TYPES as readonly string[]).includes(t) ? (t as (typeof MEDIA_TYPES)[number]) : null
}

/**
 * Upload checks in contract order: wrong type 415, over 5 MB 413, empty 400.
 * `size` may be the declared Content-Length (to reject early) or the received byte count.
 */
export function checkUpload(contentType: unknown, size: number): (typeof MEDIA_TYPES)[number] {
  const type = mediaType(contentType)
  if (!type) throw new DetailsError('Yalnızca JPEG, PNG veya WebP resim yüklenebilir', 415)
  if (size > MEDIA_MAX_BYTES) throw new DetailsError('Resim en çok 5 MB olabilir', 413)
  if (size <= 0) throw new DetailsError('Boş dosya yüklenemez', 400)
  return type
}

// ---------- Photo id lists ----------
function parsePhotoIds(v: unknown, max: number, field: string): string[] {
  if (absent(v)) return []
  if (!Array.isArray(v)) throw new DetailsError(`${field} bir dizi olmalı`)
  if (!v.every(isMediaId)) throw new DetailsError(`${field} geçerli medya kimlikleri olmalı`)
  const ids = [...new Set(v as string[])]
  if (ids.length > max) throw new DetailsError(`En çok ${max} fotoğraf eklenebilir`)
  return ids
}

// ---------- List item details ----------
/**
 * Validates and normalises `details` of a list item. Missing/null -> `{}`. Unknown keys are dropped.
 * Favorites are trimmed and empty ones dropped; empty arrays are omitted. Currency is upper-cased.
 */
export function parseDetails(input: unknown): PlaceDetails {
  if (absent(input)) return {}
  if (!isObject(input)) throw new DetailsError('details bir nesne olmalı')
  const d = input
  const out: PlaceDetails = {}

  for (const k of ['dineIn', 'takeout'] as const) {
    if (absent(d[k])) continue
    if (typeof d[k] !== 'boolean') throw new DetailsError(`${k} true/false olmalı`)
    out[k] = d[k] as boolean
  }
  for (const k of ['waitDineIn', 'waitTakeout'] as const) {
    if (absent(d[k])) continue
    if (!(WAIT_RANGES as readonly unknown[]).includes(d[k])) throw new DetailsError(`${k}: ${WAIT_RANGES.join(' | ')}`)
    out[k] = d[k] as WaitRange
  }
  if (!absent(d.recommendation)) {
    if (!(RECOMMENDATIONS as readonly unknown[]).includes(d.recommendation))
      throw new DetailsError(`recommendation: ${RECOMMENDATIONS.join(' | ')}`)
    out.recommendation = d.recommendation as Recommendation
  }
  if (!absent(d.spendPerPerson)) {
    const n = d.spendPerPerson
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > MAX_SPEND)
      throw new DetailsError(`spendPerPerson 0-${MAX_SPEND} arası bir sayı olmalı`)
    out.spendPerPerson = n
  }
  if (!absent(d.currency)) {
    const c = typeof d.currency === 'string' ? d.currency.trim() : ''
    if (!/^[A-Za-z]{3}$/.test(c)) throw new DetailsError('currency 3 harfli ISO 4217 kodu olmalı')
    out.currency = c.toUpperCase()
  }
  if (!absent(d.favorites)) {
    if (!Array.isArray(d.favorites) || !d.favorites.every((f) => typeof f === 'string'))
      throw new DetailsError('favorites metin dizisi olmalı')
    const favs = (d.favorites as string[]).map((f) => f.trim()).filter((f) => f.length > 0)
    if (favs.length > MAX_FAVORITES) throw new DetailsError(`En çok ${MAX_FAVORITES} favori eklenebilir`)
    if (favs.some((f) => f.length > MAX_FAVORITE_LENGTH))
      throw new DetailsError(`Favoriler en çok ${MAX_FAVORITE_LENGTH} karakter olabilir`)
    if (favs.length) out.favorites = favs
  }
  const photos = parsePhotoIds(d.photos, MAX_PHOTOS, 'photos')
  if (photos.length) out.photos = photos
  return out
}

/** Stored JSON text -> details (`{}` for anything unreadable). */
export function readStoredDetails(text: unknown): PlaceDetails {
  if (typeof text !== 'string' || !text) return {}
  try {
    const v = JSON.parse(text)
    return isObject(v) ? (v as PlaceDetails) : {}
  } catch { return {} }
}

/** Stored JSON text -> photo id list (`[]` for anything unreadable). */
export function readStoredPhotos(text: unknown): string[] {
  if (typeof text !== 'string' || !text) return []
  try {
    const v = JSON.parse(text)
    return Array.isArray(v) ? v.filter(isMediaId) : []
  } catch { return [] }
}

/** Unique photo ids referenced by a set of details (to check that the requester uploaded them all). */
export const photoIdsOf = (all: PlaceDetails[]): string[] => [...new Set(all.flatMap((d) => d.photos ?? []))]

// ---------- Comments ----------
export interface CommentInput { body: string; photos: string[] }

/** Comment text (trimmed, 0-1000) and up to 4 photos; text or at least one photo is required. */
export function parseCommentInput(body: unknown, photos: unknown): CommentInput {
  if (!absent(body) && typeof body !== 'string') throw new DetailsError('body metin olmalı')
  const text = typeof body === 'string' ? body.trim() : ''
  if (text.length > MAX_COMMENT_LENGTH) throw new DetailsError('Yorum 1-1000 karakter olmalı')
  const ids = parsePhotoIds(photos, MAX_COMMENT_PHOTOS, 'photos')
  if (!text && !ids.length) throw new DetailsError('Yorum metni ya da en az bir fotoğraf gerekli')
  return { body: text, photos: ids }
}
