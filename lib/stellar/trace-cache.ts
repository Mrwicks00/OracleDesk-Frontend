export interface TraceCacheEntry {
  hash: string;
  bytes: ArrayBuffer;
  size: number;
  contentKind: "json" | "text";
  cid: string;
  storedAt: number;
  lastUsed: number;
}

export interface TraceCache {
  get(hash: string): Promise<{ bytes: Uint8Array; contentKind: "json" | "text" } | null>;
  put(hash: string, bytes: Uint8Array, meta: { cid: string; contentKind: "json" | "text" }): Promise<void>;
  delete(hash: string): Promise<void>;
  clear(): Promise<void>;
  stats(): Promise<{ entries: number; bytes: number }>;
}

interface TraceCacheOptions {
  budgetBytes: number;
  maxEntryBytes: number;
  enabled: () => boolean;
}

const DB_NAME = "oracledesk-traces";
const STORE_NAME = "blobs";

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB unavailable"));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "hash" });
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function broadcast(message: "cleared" | "evicted", hashes: string[] = []) {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel("oracledesk-trace-cache");
  channel.postMessage({ type: message, hashes });
  channel.close();
}

export function openTraceCache(options: TraceCacheOptions): TraceCache {
  if (typeof indexedDB === "undefined") {
    return {
      get: async () => null,
      put: async () => {},
      delete: async () => {},
      clear: async () => {},
      stats: async () => ({ entries: 0, bytes: 0 }),
    };
  }

  const dbPromise = openDatabase();

  return {
    async get(hash) {
      if (!options.enabled()) return null;
      const db = await dbPromise;
      const entry = await new Promise<TraceCacheEntry | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const request = tx.objectStore(STORE_NAME).get(hash.toLowerCase());
        request.onsuccess = () => resolve(request.result as TraceCacheEntry | undefined);
        request.onerror = () => reject(request.error);
      });
      if (!entry) return null;
      const bytes = new Uint8Array(entry.bytes);
      if ((await sha256Hex(bytes)) !== hash.toLowerCase()) {
        await this.delete(hash);
        return null;
      }
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put({ ...entry, lastUsed: Date.now() });
      return { bytes, contentKind: entry.contentKind };
    },

    async put(hash, bytes, meta) {
      if (!options.enabled() || bytes.byteLength > options.maxEntryBytes) return;
      const normalized = hash.toLowerCase();
      if ((await sha256Hex(bytes)) !== normalized) throw new Error("Trace bytes do not match the cache key");
      const db = await dbPromise;
      let evicted: string[] = [];
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const entries = store.getAll();
        entries.onsuccess = async () => {
          const all = (entries.result as TraceCacheEntry[])
            .sort((a, b) => a.lastUsed - b.lastUsed);
          let total = all.reduce((sum, entry) => sum + entry.size, 0);
          if (total + bytes.byteLength > options.budgetBytes) {
            for (const entry of all) {
              if (total + bytes.byteLength <= options.budgetBytes) break;
              store.delete(entry.hash);
              evicted.push(entry.hash);
              total -= entry.size;
            }
          }
          const now = Date.now();
          store.put({
            hash: normalized,
            bytes: bytes.slice().buffer as ArrayBuffer,
            size: bytes.byteLength,
            contentKind: meta.contentKind,
            cid: meta.cid,
            storedAt: now,
            lastUsed: now,
          } satisfies TraceCacheEntry);
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      if (evicted.length) broadcast("evicted", evicted);
    },

    async delete(hash) {
      const db = await dbPromise;
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).delete(hash.toLowerCase());
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },

    async clear() {
      const db = await dbPromise;
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      broadcast("cleared");
    },

    async stats() {
      const db = await dbPromise;
      const entries = await new Promise<TraceCacheEntry[]>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const request = tx.objectStore(STORE_NAME).getAll();
        request.onsuccess = () => resolve(request.result as TraceCacheEntry[]);
        request.onerror = () => reject(request.error);
      });
      return { entries: entries.length, bytes: entries.reduce((sum, entry) => sum + entry.size, 0) };
    },
  };
}
