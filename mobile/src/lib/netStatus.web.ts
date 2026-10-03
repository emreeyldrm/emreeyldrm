/** Web: `navigator.onLine` ve `online` / `offline` olayları. */
export function watchDeviceOnline(cb: (online: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const on = () => cb(true);
  const off = () => cb(false);
  window.addEventListener('online', on);
  window.addEventListener('offline', off);
  return () => {
    window.removeEventListener('online', on);
    window.removeEventListener('offline', off);
  };
}

export function initialDeviceOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}
