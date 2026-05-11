/**
 * Browser storage helpers.
 *
 * By default Chrome treats IndexedDB on a website as "best-effort" storage —
 * meaning Android can evict it whenever it wants to free space, especially
 * after the tab has been idle for a while. That's the root cause of the
 * "I came back hours later and my photos were corrupted" bug. Asking for
 * persistent storage tells the browser to keep our data sticky.
 *
 * Chrome usually grants the request silently if the site has been used a few
 * times. No permission prompt for the user.
 */

export interface PersistenceStatus {
  supported: boolean;
  persisted: boolean;
  requested: boolean;
}

export async function ensurePersistentStorage(): Promise<PersistenceStatus> {
  if (typeof navigator === "undefined" || !navigator.storage || !navigator.storage.persist) {
    return { supported: false, persisted: false, requested: false };
  }
  try {
    const already = await navigator.storage.persisted();
    if (already) {
      return { supported: true, persisted: true, requested: false };
    }
    const granted = await navigator.storage.persist();
    return { supported: true, persisted: granted, requested: true };
  } catch {
    return { supported: true, persisted: false, requested: true };
  }
}

export interface StorageEstimate {
  usageBytes: number;
  quotaBytes: number;
  usagePct: number;
}

export async function getStorageEstimate(): Promise<StorageEstimate | null> {
  if (typeof navigator === "undefined" || !navigator.storage || !navigator.storage.estimate) {
    return null;
  }
  try {
    const est = await navigator.storage.estimate();
    const usage = est.usage ?? 0;
    const quota = est.quota ?? 0;
    return {
      usageBytes: usage,
      quotaBytes: quota,
      usagePct: quota > 0 ? (usage / quota) * 100 : 0,
    };
  } catch {
    return null;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
