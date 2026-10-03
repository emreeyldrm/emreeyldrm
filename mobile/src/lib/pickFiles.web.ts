import * as DocumentPicker from 'expo-document-picker';

export interface PickedText { name: string; text: string }

/** Web: gizli `<input type="file" multiple>` (expo-document-picker) ve tarayıcının `File.text()`'i (AC-MOB-31). */
export async function pickTextFiles(): Promise<PickedText[] | null> {
  const r = await DocumentPicker.getDocumentAsync({
    multiple: true, base64: false,
    type: ['.csv', '.json', '.geojson', 'text/csv', 'application/json', 'application/geo+json'],
  });
  if (r.canceled || !r.assets?.length) return null;
  return Promise.all(r.assets.map(async (a) => ({
    name: a.name,
    text: a.file ? await a.file.text() : await (await fetch(a.uri)).text(),
  })));
}
