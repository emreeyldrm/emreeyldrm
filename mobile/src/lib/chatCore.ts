/**
 * Mesajlaşma (MSG, AC-MOB-40..42) için saf yardımcılar: tipler, birleştirme, saat ve önizleme metinleri.
 * React/Expo bağımlılığı yok (unit/chat.spec.ts Node'da çalıştırır). Ağ işleri src/lib/chat.ts'te.
 */
export type AttachmentType = 'place' | 'list';

export interface ChatAttachment {
  type: AttachmentType;
  id: number | string;
  title: string;
  subtitle: string | null;
  /** Yer kategorisi (simge için); listede null. */
  category?: string | null;
}

export interface ChatMessage {
  id: number;
  senderId: number | string;
  body: string;
  attachment: ChatAttachment | null;
  createdAt: string;
}

export interface Conversation {
  id: number;
  other: { id: number | string; handle: string | null };
  lastMessage: { body: string; attachmentType: AttachmentType | null; createdAt: string; senderId: number | string } | null;
  unread: number;
}

export interface ConversationInfo { id: number; other: { id: number | string; handle: string | null }; canSend: boolean }

/** Sohbet ekranı açıkken yoklama aralığı (gerçek zaman yok; sözleşme kısa aralıklı yoklama der). */
export const CHAT_POLL_MS = 3000;
/** Sohbet listesi ve sekme rozeti için yoklama aralığı. */
export const LIST_POLL_MS = 15000;
export const MAX_BODY = 2000;
export const PRIVATE_LIST_TITLE = 'Özel liste';

/** Kimliğe göre tekilleştirip artan sırada birleştirir (yoklama ve gönderme yanıtı aynı mesajı getirebilir). */
export function mergeMessages(current: readonly ChatMessage[], incoming: readonly ChatMessage[]): ChatMessage[] {
  const byId = new Map<number, ChatMessage>();
  for (const m of current) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

/** `after` imleci: eldeki en büyük mesaj kimliği (yoksa null → son 50). */
export const lastMessageId = (messages: readonly ChatMessage[]): number | null =>
  messages.length ? messages.reduce((m, x) => Math.max(m, x.id), 0) : null;

export const totalUnread = (list: readonly Conversation[]): number => list.reduce((n, c) => n + (c.unread || 0), 0);

/** Rozet metni: 1..99, üstü "99+". */
export const badgeText = (n: number): string => (n > 99 ? '99+' : String(n));

const pad = (n: number) => String(n).padStart(2, '0');
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Sohbet listesindeki saat: bugün "14:32", dün "Dün", bu hafta gün adı, daha eski "03.10.2026". */
export function listTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (sameDay(d, now)) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return 'Dün';
  const days = (now.getTime() - d.getTime()) / 86_400_000;
  if (days > 0 && days < 7) return ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'][d.getDay()];
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** Baloncuk altındaki saat: "14:32". */
export function bubbleTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Gün ayırıcı: "Bugün", "Dün" ya da "3 Ekim". */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (sameDay(d, now)) return 'Bugün';
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return 'Dün';
  const months = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  return `${d.getDate()} ${months[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : ''}`;
}

/** Mesajlar arasına gün ayırıcı gerekiyor mu (ilk mesaj ya da gün değişti). */
export function needsDaySeparator(prev: ChatMessage | undefined, cur: ChatMessage): boolean {
  if (!prev) return true;
  return !sameDay(new Date(prev.createdAt), new Date(cur.createdAt));
}

/** Sohbet listesindeki son mesaj önizlemesi: kendi mesajında "Sen: …"; yalnızca ek varsa "Bir yer gönderdi(n)". */
export function previewText(c: Conversation, me: number | string | null | undefined): string {
  const m = c.lastMessage;
  if (!m) return 'Henüz mesaj yok';
  const mine = me !== null && me !== undefined && String(m.senderId) === String(me);
  const body = m.body?.trim() ?? '';
  if (body) return mine ? `Sen: ${body}` : body;
  const what = m.attachmentType === 'list' ? 'Bir liste' : 'Bir yer';
  return `${what} gönderdi${mine ? 'n' : ''}`;
}

/** Ekin dokununca açılacağı uygulama yolu. */
export function attachmentHref(a: Pick<ChatAttachment, 'type' | 'id'>): string {
  return a.type === 'place' ? `/places/${a.id}` : `/lists/${a.id}`;
}

/** Yalnızca karşılıklı takip (arkadaş) edilenler, handle sırasıyla. */
export function friendsOf<T extends { handle: string; following: boolean; followsMe: boolean }>(following: readonly T[]): T[] {
  return following.filter((u) => u.following && u.followsMe).sort((a, b) => a.handle.localeCompare(b.handle));
}
