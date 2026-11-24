// Open Food Facts product lookup. Data: Open Food Facts contributors, ODbL.

import type { OffProduct } from './types.ts';

export const OFF_FIELDS = [
  'code',
  'product_name',
  'brands',
  'image_front_small_url',
  'categories_tags',
  'packagings',
  'packaging_tags',
  'packaging_text',
  'packaging_materials_tags',
  'packaging_shapes_tags',
  'packaging_recycling_tags',
  'packagings_complete',
].join(',');

export type LookupResult =
  | { status: 'found'; product: OffProduct; fromCache: boolean }
  | { status: 'not-found'; code: string }
  | { status: 'error'; code: string; message: string };

export interface ProductCache {
  get(code: string): OffProduct | null | undefined;
  set(code: string, product: OffProduct | null): void;
}

/** Keep digits only. Accepts EAN-8, UPC-A (12), EAN-13 and GTIN-14. */
export function cleanBarcode(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  if (![8, 12, 13, 14].includes(digits.length)) return null;
  return digits;
}

/** GS1 check digit test, used to warn about typos before calling the API. */
export function validCheckDigit(code: string): boolean {
  const digits = code.split('').map(Number);
  const check = digits.pop()!;
  const sum = digits
    .reverse()
    .reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

export async function lookupProduct(
  code: string,
  opts: { fetchImpl?: typeof fetch; cache?: ProductCache; headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<LookupResult> {
  const cached = opts.cache?.get(code);
  if (cached) return { status: 'found', product: cached, fromCache: true };
  if (cached === null) return { status: 'not-found', code };
  const f = opts.fetchImpl ?? fetch;
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${OFF_FIELDS}`;
  let res: Response;
  try {
    res = await f(url, { headers: opts.headers, signal: AbortSignal.timeout(opts.timeoutMs ?? 15000) });
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return { status: 'error', code, message: timedOut ? 'Open Food Facts did not answer in time' : e instanceof Error ? e.message : String(e) };
  }
  if (res.status === 404) {
    opts.cache?.set(code, null);
    return { status: 'not-found', code };
  }
  if (res.status === 429) return { status: 'error', code, message: 'Open Food Facts answered HTTP 429 (too many requests)' };
  if (!res.ok) return { status: 'error', code, message: `Open Food Facts answered HTTP ${res.status}` };
  const body = (await res.json()) as { status?: number; product?: OffProduct };
  if (body.status !== 1 || !body.product) {
    opts.cache?.set(code, null);
    return { status: 'not-found', code };
  }
  const product = { ...body.product, code: body.product.code ?? code };
  opts.cache?.set(code, product);
  return { status: 'found', product, fromCache: false };
}
