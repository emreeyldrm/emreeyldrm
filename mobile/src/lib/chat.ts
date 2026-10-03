import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { apiCachedGet, apiRequest, type Id } from './api';
import { isOnline, onOnlineChange, writeCache } from './offlineStore';
import { LIST_POLL_MS, type AttachmentType, type ChatMessage, type Conversation, type ConversationInfo } from './chatCore';

export * from './chatCore';

/**
 * Mesajlaşma (MSG, AC-MOB-40..42). Yalnızca çevrimiçi: gönderimler sıraya alınmaz (çevrimdışıyken düğmeler kapalı ve
 * OFFLINE_MSG gösterilir). Sohbet listesi ve son mesajlar okuma önbelleğinden (AC-OFF-1) çevrimdışı da görünür.
 * Gerçek zaman yok: açık ekranlar kısa aralıklarla yoklar (chatCore CHAT_POLL_MS / LIST_POLL_MS).
 */
export const chatApi = {
  conversations: () => apiCachedGet<Conversation[]>('/conversations'),
  unread: () => apiRequest<{ count: number }>('GET', '/conversations/unread'),
  open: (handle: string) => apiRequest<{ id: number }>('POST', '/conversations', { handle }),
  info: (id: Id) => apiCachedGet<ConversationInfo>(`/conversations/${id}`),
  /** Son 50 mesaj (önbellekli: çevrimdışı son görülen hâli). */
  latest: (id: Id) => apiCachedGet<ChatMessage[]>(`/conversations/${id}/messages`),
  /** `after` kimliğinden sonraki yeni mesajlar (yoklama). */
  after: (id: Id, after: number) => apiRequest<ChatMessage[]>('GET', `/conversations/${id}/messages?after=${after}`),
  send: (id: Id, body: string, attachment?: { type: AttachmentType; id: Id } | null) =>
    apiRequest<ChatMessage>('POST', `/conversations/${id}/messages`, {
      ...(body.trim() ? { body: body.trim() } : {}),
      ...(attachment ? { attachment: { type: attachment.type, id: Number(attachment.id) } } : {}),
    }),
  read: (id: Id) => apiRequest<{ ok: true }>('POST', `/conversations/${id}/read`),
  /** Yoklamayla gelen mesajlarla birlikte son hâli önbelleğe yazar (çevrimdışı açılış için). */
  remember: (id: Id, messages: ChatMessage[]) => writeCache(`/conversations/${id}/messages`, messages.slice(-50)),
};

/** Arkadaşa yer ya da liste gönder (AC-MOB-42): sohbeti açar (varsa aynısı) ve eki, isteğe bağlı notla gönderir. */
export async function sendToFriend(handle: string, attachment: { type: AttachmentType; id: Id }, note = ''): Promise<number> {
  const { id } = await chatApi.open(handle);
  await chatApi.send(id, note, attachment);
  void refreshUnread();
  return id;
}

// ---- Toplam okunmamış (sekme rozeti, AC-MOB-40) -------------------------------------------------------------
let unreadCount = 0;
const listeners = new Set<() => void>();
const setUnread = (n: number) => {
  if (n === unreadCount) return;
  unreadCount = n;
  listeners.forEach((f) => f());
};

/** Sunucudan yeniden okur; çevrimdışıyken ya da hata olunca son değer kalır. */
export async function refreshUnread(): Promise<void> {
  if (!isOnline()) return;
  try { setUnread((await chatApi.unread()).count); } catch { /* son değer kalsın */ }
}

/** Sohbet listesi geldiğinde rozeti hemen eşitle (ayrı istek beklemeden). */
export const setUnreadFromList = (list: Conversation[]): void => setUnread(list.reduce((n, c) => n + (c.unread || 0), 0));

/** Toplam okunmamış; bağlıyken LIST_POLL_MS'de bir, uygulama öne gelince ve bağlantı dönünce yenilenir. */
export function useUnreadCount(): number {
  useEffect(() => {
    void refreshUnread();
    const timer = setInterval(() => { void refreshUnread(); }, LIST_POLL_MS);
    const offOnline = onOnlineChange((on) => { if (on) void refreshUnread(); });
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void refreshUnread(); });
    return () => { clearInterval(timer); offOnline(); sub.remove(); unreadCount = 0; };
  }, []);
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    () => unreadCount, () => unreadCount,
  );
}
