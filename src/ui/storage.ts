// Browser storage helpers. Storage can be missing or throw (private mode,
// blocked site data), so every access is guarded and the app works without it.

import type { OffProduct } from '../core/types.ts';
import type { ProductCache } from '../core/off.ts';

const PREFIX = 'binsplit:';

function read<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? undefined : (JSON.parse(raw) as T);
  } catch {
    return undefined;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: carry on without it */
  }
}

export const productCache: ProductCache = {
  get(code) {
    return read<OffProduct | null>(`product:${code}`);
  },
  set(code, product) {
    write(`product:${code}`, product);
  },
};

export const prefs = {
  get pack(): string | undefined {
    return read<string>('pack');
  },
  set pack(v: string | undefined) {
    write('pack', v);
  },
};
