/** Web: expo-secure-store is not available, so the token is kept in localStorage. */
const KEY = 'voyage.token';

export async function readToken(): Promise<string | null> {
  try {
    return globalThis.localStorage?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
}

export async function writeToken(token: string): Promise<void> {
  try {
    globalThis.localStorage?.setItem(KEY, token);
  } catch {
    /* ignore */
  }
}

export async function deleteToken(): Promise<void> {
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
