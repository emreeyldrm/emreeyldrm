import { expect, test } from '@playwright/test';
import {
  addMemberError, copyAction, friendSuggestions, listActionError, listRole, memberCountLabel, OFFLINE_COLLAB_MSG, permissions, summaryRole,
} from '../src/lib/collabCore';

// Node-only: src/lib/collabCore.ts — roller, izinler, arkadaş önerileri ve hata metinleri (AC-MOB-37..39).

class HttpError extends Error {
  constructor(readonly status: number, msg: string) { super(msg); }
}

test('AC-MOB-39: rol myRole alanından, yoksa (eski önbellek / çevrimdışı liste) sahiplikten belirlenir', () => {
  expect(listRole({ ownerId: 1, myRole: 'editor' }, 2)).toBe('editor');
  expect(listRole({ ownerId: 1, myRole: null }, 2)).toBeNull();
  expect(listRole({ ownerId: 1, myRole: 'owner' }, 1)).toBe('owner');
  expect(listRole({ ownerId: 7 }, '7')).toBe('owner');
  expect(listRole({ ownerId: 7 }, 8)).toBeNull();
  expect(listRole({ ownerId: 7 }, null)).toBeNull();
  expect(summaryRole({})).toBe('owner');
  expect(summaryRole({ role: 'editor' })).toBe('editor');
});

test('AC-MOB-39: izinler — üye düzenler ve ayrılır, sahip denetimlerini görmez; üye olmayan salt okur', () => {
  expect(permissions('owner')).toEqual({ canEdit: true, isOwner: true, canLeave: false, canSeeMembers: true });
  expect(permissions('editor')).toEqual({ canEdit: true, isOwner: false, canLeave: true, canSeeMembers: true });
  expect(permissions(null)).toEqual({ canEdit: false, isOwner: false, canLeave: false, canSeeMembers: false });
});

test('AC-MOB-37: kopyalama düğmesi — sahip her zaman, diğerleri yalnızca allowCopy açıkken', () => {
  expect(copyAction('owner', false)).toEqual({ label: 'Kopyasını oluştur' });
  expect(copyAction('owner', true)).toEqual({ label: 'Kopyasını oluştur' });
  expect(copyAction(null, true)).toEqual({ label: 'Listeyi kopyala' });
  expect(copyAction('editor', true)).toEqual({ label: 'Listeyi kopyala' });
  expect(copyAction(null, false)).toBeNull();
  expect(copyAction('editor', false)).toBeNull();
});

test('AC-MOB-38: yalnızca karşılıklı takip edilenler önerilir, üyeler hariç, aramaya göre süzülür', () => {
  const people = [
    { id: 1, handle: 'zeynep', following: true, followsMe: true },
    { id: 2, handle: 'ali', following: true, followsMe: false },
    { id: 3, handle: 'ayse', following: true, followsMe: true },
    { id: 4, handle: 'mert', following: false, followsMe: true },
    { id: 5, handle: 'kaya', following: true, followsMe: true },
    { id: 3, handle: 'ayse', following: true, followsMe: true },
  ];
  expect(friendSuggestions(people, [], '').map((p) => p.handle)).toEqual(['ayse', 'kaya', 'zeynep']);
  expect(friendSuggestions(people, ['5'], '').map((p) => p.handle)).toEqual(['ayse', 'zeynep']);
  expect(friendSuggestions(people, [], '@A').map((p) => p.handle)).toEqual(['ayse', 'kaya']); // önek önce
  expect(friendSuggestions(people, [], 'ali')).toEqual([]);
  expect(friendSuggestions(people, [], 'mert')).toEqual([]);
});

test('AC-MOB-38: üye ekleme hataları Türkçe (arkadaş değil, engel, sınır, sahip, yok, çevrimdışı)', () => {
  expect(addMemberError(new HttpError(403, 'Yalnızca arkadaşların (karşılıklı takip) eklenebilir'), 'veli')).toMatch(/^@veli arkadaşın değil/);
  expect(addMemberError(new HttpError(403, 'Bu kullanıcı eklenemez'), '@veli')).toMatch(/^@veli eklenemez: aranızda engelleme var/);
  expect(addMemberError(new HttpError(403, 'Bunu yalnızca listenin sahibi yapabilir'), 'veli')).toMatch(/yalnızca liste sahibi/);
  expect(addMemberError(new HttpError(400, 'Bir listede en çok 20 üye olabilir'), 'veli')).toMatch(/en çok 20 üye/);
  expect(addMemberError(new HttpError(400, 'Liste sahibi zaten listede'), 'veli')).toBe('Liste sahibi zaten listede.');
  expect(addMemberError(new HttpError(404, 'Kullanıcı bulunamadı'), 'yok')).toBe('@yok adında bir kullanıcı bulunamadı.');
  expect(addMemberError(new HttpError(0, 'Çevrimdışısın'), 'veli')).toBe(OFFLINE_COLLAB_MSG);
});

test('AC-MOB-37/38: çıkarma, ayrılma ve kopyalama hataları', () => {
  expect(listActionError(new HttpError(403, 'Bu liste kopyalanamaz'), 'copy')).toMatch(/kopyalanmasına izin verilmiyor/);
  expect(listActionError(new HttpError(404, 'Liste bulunamadı'), 'leave')).toMatch(/erişimin yok/);
  expect(listActionError(new HttpError(403, 'Bunu yalnızca listenin sahibi yapabilir'), 'remove')).toMatch(/yalnızca liste sahibi/);
  expect(listActionError(new HttpError(400, 'Liste sahibi listeden çıkarılamaz'), 'remove')).toMatch(/çıkarılamaz/);
  expect(listActionError(new HttpError(0, ''), 'copy')).toBe(OFFLINE_COLLAB_MSG);
  expect(memberCountLabel(3)).toBe('3 üye');
});
