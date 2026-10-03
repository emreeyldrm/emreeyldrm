import { Directory, File, Paths } from 'expo-file-system';

/**
 * Çevrimdışı seçilen fotoğrafı (AC-OFF-3) yüklenene kadar kalıcı bir yere kopyalar: önbellek klasörü işletim
 * sistemince boşaltılabilir, belge klasörü kalır. Kopyalanamazsa özgün adres kullanılır.
 */
export async function persistPhoto(uri: string, ref: string): Promise<string> {
  try {
    const dir = new Directory(Paths.document, 'offline-photos');
    if (!dir.exists) dir.create({ idempotent: true, intermediates: true });
    const ext = /\.(png|webp|jpe?g)$/i.exec(uri)?.[0] ?? '.jpg';
    const dest = new File(dir, `${ref.replace(/[^A-Za-z0-9_-]/g, '')}${ext}`);
    await new File(uri).copy(dest);
    return dest.uri;
  } catch {
    return uri;
  }
}

/** Yüklendikten / çıkış yapıldıktan sonra yerel kopya silinir. */
export function discardPhoto(uri: string): void {
  try {
    if (uri.includes('/offline-photos/')) {
      const f = new File(uri);
      if (f.exists) f.delete();
    }
  } catch { /* yok say */ }
}

export function discardAllPhotos(): void {
  try {
    const dir = new Directory(Paths.document, 'offline-photos');
    if (dir.exists) dir.delete();
  } catch { /* yok say */ }
}
