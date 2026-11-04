// 用户字体：元数据 + IndexedDB 持久化（db `framed` / store `fonts`）。
// IndexedDB 不可用时静默降级：上传后的字体在本次会话仍可使用，只是刷新后不保留。

export const FONT_MAX_BYTES = 8 * 1024 * 1024;
export const FONT_NAME_MAX = 24;

export interface CustomFontMeta {
  id: string;
  name: string;
  size: number;
  addedAt: string;
}

export interface StoredFontRecord extends CustomFontMeta {
  bytes: ArrayBuffer;
}

const DB_NAME = 'framed';
const DB_VERSION = 1;
const STORE_NAME = 'fonts';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDatabase(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        console.warn('[framed] 打开字体数据库失败', request.error);
        resolve(null);
      };
      request.onblocked = () => {
        console.warn('[framed] 字体数据库被其他窗口占用');
      };
    } catch (error) {
      console.warn('[framed] 无法使用 IndexedDB', error);
      resolve(null);
    }
  });
  return dbPromise;
}

function transactionDone(transaction: IDBTransaction): Promise<boolean> {
  return new Promise((resolve) => {
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => {
      console.warn('[framed] 字体数据库事务失败', transaction.error);
      resolve(false);
    };
    transaction.onabort = () => {
      console.warn('[framed] 字体数据库事务中止', transaction.error);
      resolve(false);
    };
  });
}

function normalizeStoredFont(value: unknown): StoredFontRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || !record.id) return null;
  if (typeof record.name !== 'string' || !record.name) return null;
  if (typeof record.size !== 'number' || !Number.isFinite(record.size)) return null;
  if (typeof record.addedAt !== 'string') return null;
  let bytes: ArrayBuffer | null = null;
  if (record.bytes instanceof ArrayBuffer) {
    bytes = record.bytes;
  } else if (ArrayBuffer.isView(record.bytes)) {
    const view = record.bytes;
    bytes = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
  }
  if (!bytes || bytes.byteLength === 0) return null;
  return {
    id: record.id,
    name: record.name.slice(0, FONT_NAME_MAX),
    size: record.size,
    addedAt: record.addedAt,
    bytes,
  };
}

export async function loadFontRecords(): Promise<StoredFontRecord[]> {
  const database = await openDatabase();
  if (!database) return [];
  try {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    const raw = await new Promise<unknown[]>((resolve, reject) => {
      request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
      request.onerror = () => reject(request.error);
    });
    await transactionDone(transaction);
    return raw
      .map((value) => normalizeStoredFont(value))
      .filter((record): record is StoredFontRecord => record !== null);
  } catch (error) {
    console.warn('[framed] 读取字体数据库失败', error);
    return [];
  }
}

export async function saveFontRecord(record: StoredFontRecord): Promise<boolean> {
  const database = await openDatabase();
  if (!database) return false;
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(record);
    return await transactionDone(transaction);
  } catch (error) {
    console.warn('[framed] 写入字体数据库失败', error);
    return false;
  }
}

export async function deleteFontRecord(id: string): Promise<boolean> {
  const database = await openDatabase();
  if (!database) return false;
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(id);
    return await transactionDone(transaction);
  } catch (error) {
    console.warn('[framed] 删除字体数据库记录失败', error);
    return false;
  }
}

export function nextFontId(): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `font-${Date.now().toString(36)}-${random}`;
}

export function isFontFile(file: File): boolean {
  return /\.(ttf|otf)$/i.test(file.name);
}

export function fontNameFromFile(fileName: string): string {
  const base = fileName
    .replace(/\.[a-zA-Z0-9]+$/, '')
    .replace(/[\u0000-\u001f\\/:*?"<>|]/g, '-')
    .trim()
    .slice(0, FONT_NAME_MAX);
  return base || '自定义字体';
}

export function uniqueFontName(name: string, existing: readonly string[]): string {
  const used = new Set(existing.map((item) => item.toLocaleLowerCase()));
  const base = name.trim().slice(0, FONT_NAME_MAX) || '自定义字体';
  if (!used.has(base.toLocaleLowerCase())) return base;
  for (let index = 2; index < 100; index += 1) {
    const suffix = ` ${index}`;
    const candidate = `${base.slice(0, FONT_NAME_MAX - suffix.length)}${suffix}`;
    if (!used.has(candidate.toLocaleLowerCase())) return candidate;
  }
  return `字体 ${Date.now().toString(36).slice(-5)}`;
}

export function formatFontSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function formatFontDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
}
