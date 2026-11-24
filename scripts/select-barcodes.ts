// Builds the fixed evaluation list in data/eval/barcodes.json.
//
// Selection does NOT look at packaging data, so the coverage figure is not
// inflated by picking well-documented products. The rule is:
//   the most-scanned products in Open Food Facts that are sold in Malaysia
//   (first 150) and in Singapore (first 100), duplicates removed.
//
// Run once: node scripts/select-barcodes.ts

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'BinSplit/0.1 (open-source recycling helper; evaluation script)';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Hit {
  code: string;
  product_name?: string;
  brands?: string;
}

async function search(country: string, want: number): Promise<Hit[]> {
  const out: Hit[] = [];
  for (let page = 1; out.length < want; page++) {
    const url =
      `https://world.openfoodfacts.org/api/v2/search?countries_tags_en=${country}` +
      `&sort_by=unique_scans_n&page_size=50&page=${page}&fields=code,product_name,brands`;
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.ok) {
        const body = (await res.json()) as { products: Hit[] };
        if (!body.products.length) return out;
        out.push(...body.products);
        break;
      }
      if (attempt >= 8) throw new Error(`search ${country} page ${page}: HTTP ${res.status}`);
      console.log(`  HTTP ${res.status}, waiting before retry`);
      await sleep(15000 * (attempt + 1));
    }
    // The search API allows about 10 requests per minute.
    await sleep(7000);
  }
  return out.slice(0, want);
}

const my = await search('malaysia', 150);
console.log(`malaysia: ${my.length}`);
const sg = await search('singapore', 100);
console.log(`singapore: ${sg.length}`);

const seen = new Set<string>();
const items: Array<Hit & { list: string }> = [];
for (const [list, hits] of [['malaysia', my], ['singapore', sg]] as const) {
  for (const h of hits) {
    if (!h.code || seen.has(h.code)) continue;
    seen.add(h.code);
    items.push({ code: h.code, product_name: h.product_name, brands: h.brands, list });
  }
}

writeFileSync(
  join(root, 'data/eval/barcodes.json'),
  JSON.stringify(
    {
      selected: new Date().toISOString(),
      rule:
        'Most-scanned Open Food Facts products (sort_by=unique_scans_n) tagged as sold in Malaysia (top 150) ' +
        'and in Singapore (top 100), duplicates removed. Packaging data was not looked at when selecting.',
      count: items.length,
      items,
    },
    null,
    1,
  ) + '\n',
);
console.log(`wrote ${items.length} barcodes`);
