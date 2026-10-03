import { expect, test } from '@playwright/test';
import {
  attachmentHref, badgeText, bubbleTime, dayLabel, friendsOf, lastMessageId, listTime, mergeMessages, needsDaySeparator,
  previewText, totalUnread, type ChatMessage, type Conversation,
} from '../src/lib/chatCore';

// Node-only: src/lib/chatCore.ts — sohbet listesi metinleri, birleştirme ve saatler (AC-MOB-40..42).

const msg = (id: number, createdAt = '2026-10-03T10:00:00', senderId = 1): ChatMessage => ({ id, senderId, body: `m${id}`, attachment: null, createdAt });
const conv = (last: Conversation['lastMessage'], unread = 0): Conversation => ({ id: 1, other: { id: 2, handle: 'kerem' }, lastMessage: last, unread });

test('AC-MOB-41: yoklama ve gönderme yanıtı kimliğe göre tekilleştirilip artan sırada birleşir; `after` en büyük kimlik', () => {
  const merged = mergeMessages([msg(1), msg(3)], [msg(3), msg(2), msg(5)]);
  expect(merged.map((m) => m.id)).toEqual([1, 2, 3, 5]);
  expect(lastMessageId(merged)).toBe(5);
  expect(lastMessageId([])).toBeNull();
});

test('AC-MOB-40: toplam okunmamış ve rozet metni', () => {
  expect(totalUnread([conv(null, 2), conv(null, 0), conv(null, 5)])).toBe(7);
  expect(badgeText(7)).toBe('7');
  expect(badgeText(140)).toBe('99+');
});

test('AC-MOB-40: son mesaj önizlemesi (kendi mesajın "Sen:", yalnızca ek)', () => {
  const at = '2026-10-03T10:00:00';
  expect(previewText(conv(null), 1)).toBe('Henüz mesaj yok');
  expect(previewText(conv({ body: 'Selam', attachmentType: null, createdAt: at, senderId: 2 }), 1)).toBe('Selam');
  expect(previewText(conv({ body: 'Selam', attachmentType: null, createdAt: at, senderId: 1 }), 1)).toBe('Sen: Selam');
  expect(previewText(conv({ body: '', attachmentType: 'place', createdAt: at, senderId: 2 }), 1)).toBe('Bir yer gönderdi');
  expect(previewText(conv({ body: '', attachmentType: 'list', createdAt: at, senderId: '1' }), 1)).toBe('Bir liste gönderdin');
});

test('AC-MOB-40: liste saati bugün ss:dd, dün "Dün", bu hafta gün adı, daha eskisi tarih', () => {
  const now = new Date(2026, 9, 3, 18, 0); // 3 Ekim 2026 Cumartesi
  expect(listTime(new Date(2026, 9, 3, 9, 5).toISOString(), now)).toBe('09:05');
  expect(listTime(new Date(2026, 9, 2, 23, 0).toISOString(), now)).toBe('Dün');
  expect(listTime(new Date(2026, 8, 29, 12, 0).toISOString(), now)).toBe('Salı');
  expect(listTime(new Date(2026, 7, 1, 12, 0).toISOString(), now)).toBe('01.08.2026');
  expect(listTime('bozuk', now)).toBe('');
  expect(bubbleTime(new Date(2026, 9, 3, 14, 32).toISOString())).toBe('14:32');
});

test('AC-MOB-41: gün ayırıcıları', () => {
  const now = new Date(2026, 9, 3, 18, 0);
  expect(dayLabel(new Date(2026, 9, 3, 8).toISOString(), now)).toBe('Bugün');
  expect(dayLabel(new Date(2026, 9, 2, 8).toISOString(), now)).toBe('Dün');
  expect(dayLabel(new Date(2026, 8, 20, 8).toISOString(), now)).toBe('20 Eylül');
  expect(dayLabel(new Date(2025, 0, 5, 8).toISOString(), now)).toBe('5 Ocak 2025');
  const a = msg(1, new Date(2026, 9, 2, 22).toISOString());
  const b = msg(2, new Date(2026, 9, 2, 23).toISOString());
  const c = msg(3, new Date(2026, 9, 3, 1).toISOString());
  expect(needsDaySeparator(undefined, a)).toBe(true);
  expect(needsDaySeparator(a, b)).toBe(false);
  expect(needsDaySeparator(b, c)).toBe(true);
});

test('AC-MOB-41/42: ekler doğru ekrana gider; seçicide yalnızca arkadaşlar (karşılıklı takip)', () => {
  expect(attachmentHref({ type: 'place', id: 12 })).toBe('/places/12');
  expect(attachmentHref({ type: 'list', id: '7' })).toBe('/lists/7');
  const users = [
    { id: 1, handle: 'zeynep', following: true, followsMe: true },
    { id: 2, handle: 'ali', following: true, followsMe: false },
    { id: 3, handle: 'can', following: true, followsMe: true },
  ];
  expect(friendsOf(users).map((u) => u.handle)).toEqual(['can', 'zeynep']);
});
