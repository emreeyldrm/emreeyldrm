/**
 * Ortak listeler ve kopyalama (AC-MOB-37..39): rol, izinler, arkadaş süzme ve Türkçe hata metinleri.
 * Saf işlevler (Node birim testleri `unit/collab.spec.ts` doğrudan içe aktarır); ağ çağrıları `api.ts` → `collabApi`.
 */

export type Role = 'owner' | 'editor' | null;

type IdLike = string | number;

/**
 * İsteği yapanın listedeki rolü. Sunucu `myRole` döner (COL-3); eski önbellekte ya da çevrimdışı oluşturulan
 * (henüz sunucuda olmayan) listede alan yoksa sahiplik `ownerId` ile anlaşılır.
 */
export function listRole(list: { ownerId: IdLike; myRole?: Role }, userId: IdLike | null | undefined): Role {
  if (list.myRole !== undefined) return list.myRole;
  return userId !== null && userId !== undefined && String(list.ownerId) === String(userId) ? 'owner' : null;
}

/** Listelerim kartındaki rol (`role` yoksa sahip). */
export const summaryRole = (l: { role?: 'owner' | 'editor' }): 'owner' | 'editor' => l.role ?? 'owner';

export interface Permissions {
  /** Yer ekleme / düzenleme / çıkarma (sahip ve üye). */
  canEdit: boolean;
  /** Silme, görünürlük, kopyalama/yorum izni, üye ekleme/çıkarma (yalnızca sahip). */
  isOwner: boolean;
  /** Üye, kendini "Listeden ayrıl" ile çıkarabilir. */
  canLeave: boolean;
  /** Paylaşım ekranı (üyeler) sahip ve üyeye açık. */
  canSeeMembers: boolean;
}

export function permissions(role: Role): Permissions {
  return {
    canEdit: role === 'owner' || role === 'editor',
    isOwner: role === 'owner',
    canLeave: role === 'editor',
    canSeeMembers: role === 'owner' || role === 'editor',
  };
}

/**
 * Kopyalama düğmesi (CPY-1/2): sahibi kendi listesini her zaman ("Kopyasını oluştur"); diğerleri (üye ya da
 * herkese açık listeyi gören) yalnızca `allowCopy` açıksa ("Listeyi kopyala"). Görülemeyen liste zaten açılamaz.
 */
export function copyAction(role: Role, allowCopy: boolean): { label: string } | null {
  if (role === 'owner') return { label: 'Kopyasını oluştur' };
  return allowCopy ? { label: 'Listeyi kopyala' } : null;
}

export interface FriendLike { id: IdLike; handle: string; following: boolean; followsMe: boolean }

/**
 * Üye olarak önerilecek arkadaşlar: yalnızca karşılıklı takip (followsMe && following), zaten üye olanlar hariç,
 * handle önekine (yoksa içerdiğine) göre süzülür; tekrarlar atılır, alfabetik.
 */
export function friendSuggestions<T extends FriendLike>(people: T[], memberIds: IdLike[], query: string): T[] {
  const members = new Set(memberIds.map(String));
  const q = query.trim().replace(/^@/, '').toLowerCase();
  const seen = new Set<string>();
  const out: T[] = [];
  for (const p of people) {
    const id = String(p.id);
    if (!p.following || !p.followsMe || members.has(id) || seen.has(id)) continue;
    if (q && !p.handle.toLowerCase().includes(q)) continue;
    seen.add(id);
    out.push(p);
  }
  return out.sort((a, b) => {
    const pa = q && a.handle.toLowerCase().startsWith(q) ? 0 : 1;
    const pb = q && b.handle.toLowerCase().startsWith(q) ? 0 : 1;
    return pa - pb || a.handle.localeCompare(b.handle);
  });
}

export const OFFLINE_COLLAB_MSG = 'Çevrimdışısın. Üye ekleme, çıkarma ve kopyalama için internet bağlantısı gerekli.';
export const MAX_MEMBERS = 20;

type ErrLike = { status?: number; message?: string } | null | undefined;
const statusOf = (e: unknown): number => (typeof (e as ErrLike)?.status === 'number' ? (e as { status: number }).status : -1);
const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e ?? ''));

/** Üye ekleme hatası (COL-1 sırası: 403 arkadaş değil / engel, 400 sahip ya da 20 sınırı, 404 kullanıcı yok). */
export function addMemberError(e: unknown, handle: string): string {
  const s = statusOf(e);
  const msg = messageOf(e).toLocaleLowerCase('tr');
  const who = `@${handle.replace(/^@/, '')}`;
  if (s === 0) return OFFLINE_COLLAB_MSG;
  if (s === 403) {
    if (msg.includes('arkadaş') || msg.includes('takip')) return `${who} arkadaşın değil. Yalnızca karşılıklı takipleştiğin kişileri ekleyebilirsin.`;
    if (msg.includes('sahib')) return 'Üye eklemeyi yalnızca liste sahibi yapabilir.';
    return `${who} eklenemez: aranızda engelleme var.`;
  }
  if (s === 400) {
    if (msg.includes('en çok') || msg.includes('sınır') || msg.includes(String(MAX_MEMBERS))) return `Bir listede en çok ${MAX_MEMBERS} üye olabilir. Sınıra ulaşıldı.`;
    if (msg.includes('sahib')) return 'Liste sahibi zaten listede.';
    if (msg.includes('handle')) return 'Eklemek için bir kullanıcı adı yaz.';
    return messageOf(e);
  }
  if (s === 404) return `${who} adında bir kullanıcı bulunamadı.`;
  return messageOf(e) || 'Üye eklenemedi.';
}

/** Üye çıkarma / listeden ayrılma ve kopyalama gibi liste işlemlerinin hatası. */
export function listActionError(e: unknown, action: 'remove' | 'leave' | 'copy'): string {
  const s = statusOf(e);
  if (s === 0) return OFFLINE_COLLAB_MSG;
  if (s === 404) return 'Liste bulunamadı ya da artık erişimin yok.';
  if (s === 403) {
    if (action === 'copy') return 'Bu listenin kopyalanmasına izin verilmiyor.';
    if (action === 'remove') return 'Üyeleri yalnızca liste sahibi çıkarabilir.';
    return 'Bu işlem için yetkin yok.';
  }
  if (s === 400 && action !== 'copy') return 'Liste sahibi listeden çıkarılamaz.';
  return messageOf(e) || 'İşlem tamamlanamadı.';
}

/** "1 üye", "3 üye" (sahip hariç). */
export const memberCountLabel = (n: number): string => `${n} üye`;
