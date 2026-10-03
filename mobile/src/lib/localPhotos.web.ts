/**
 * Web: seçilen fotoğrafın `blob:` adresi sayfa yenilenince geçersiz olur; bu yüzden yüklenene kadar `data:` adresi
 * olarak (kuyrukla birlikte localStorage'da) saklanır. Küçültülmüş JPEG genelde birkaç yüz KB'dir.
 */
export async function persistPhoto(uri: string, _ref: string): Promise<string> {
  if (uri.startsWith('data:')) return uri;
  try {
    const blob = await (await fetch(uri)).blob();
    return await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  } catch {
    return uri;
  }
}

export function discardPhoto(_uri: string): void { /* data: adresi kuyrukla birlikte silinir */ }
export function discardAllPhotos(): void { /* aynı */ }
