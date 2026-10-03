import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';

export interface PickedText { name: string; text: string }

/**
 * Takeout dosyalarını seçer (birden çok) ve metin olarak okur (AC-MOB-31). iOS/Android'de dosya önbelleğe kopyalanır
 * ve expo-file-system `File.text()` ile okunur. Vazgeçilirse null.
 */
export async function pickTextFiles(): Promise<PickedText[] | null> {
  const r = await DocumentPicker.getDocumentAsync({ multiple: true, type: '*/*', copyToCacheDirectory: true });
  if (r.canceled || !r.assets?.length) return null;
  return Promise.all(r.assets.map(async (a) => ({ name: a.name, text: await new File(a.uri).text() })));
}
