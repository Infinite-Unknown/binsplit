// Coverage evaluation: runs every barcode in data/eval/barcodes.json through
// lookup -> reconcile -> each rule pack, and reports how many products get
// full part-level instructions, partial instructions, or none.
//
//   node scripts/coverage.ts            fetch from Open Food Facts into data/eval/snapshot.json
//                                       (resumes: codes already fetched are skipped), then evaluate
//   node scripts/coverage.ts --refresh  start a fresh snapshot
//   node scripts/coverage.ts --offline  evaluate the committed snapshot only (no network)
//
// Writes data/eval/results.json (summary + per-product rows), which the app's
// About screen reads.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { lookupProduct, type ProductCache } from '../src/core/off.ts';
import { reconcile } from '../src/core/reconcile.ts';
import { PACKS, sortParts, coverageOf, type Coverage } from '../src/core/rules.ts';
import type { OffProduct } from '../src/core/types.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const offline = process.argv.includes('--offline');
const UA = 'BinSplit/0.1 (open-source recycling helper; evaluation script)';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const list = JSON.parse(readFileSync(join(root, 'data/eval/barcodes.json'), 'utf8')) as {
  rule: string;
  items: Array<{ code: string; list: string }>;
};
const snapshotPath = join(root, 'data/eval/snapshot.json');
type Snapshot = { started: string; finished?: string; source: string; products: Record<string, OffProduct | null> };
const refresh = process.argv.includes('--refresh');
const snap: Snapshot =
  existsSync(snapshotPath) && !refresh
    ? JSON.parse(readFileSync(snapshotPath, 'utf8'))
    : { started: new Date().toISOString(), source: 'Open Food Facts (ODbL), packaging fields only', products: {} };
const saveSnapshot = () => writeFileSync(snapshotPath, JSON.stringify(snap) + '\n');

// ---- Phase 1: fetch (live mode). Resumable: codes already in the snapshot are skipped. ----
let errors = 0;
if (!offline) {
  const cache: ProductCache = {
    get: () => undefined,
    set: (code, p) => {
      snap.products[code] = p;
    },
  };
  const todo = list.items.filter((it) => !(it.code in snap.products));
  console.log(`fetching ${todo.length} of ${list.items.length} (rest already in snapshot)`);
  for (const [i, item] of todo.entries()) {
    let result = await lookupProduct(item.code, { cache, headers: { 'User-Agent': UA } });
    for (let attempt = 0; result.status === 'error' && attempt < 6; attempt++) {
      const rateLimited = result.message.includes('429');
      console.log(`  ${item.code}: ${result.message}, retrying in ${rateLimited ? 60 : 10}s`);
      await sleep(rateLimited ? 60000 : 10000);
      result = await lookupProduct(item.code, { cache, headers: { 'User-Agent': UA } });
    }
    if (result.status === 'error') errors++;
    saveSnapshot();
    await sleep(1500); // about 40 requests a minute, well under the 100/min product limit
    if ((i + 1) % 20 === 0) console.log(`${i + 1}/${todo.length}`);
  }
  snap.finished = new Date().toISOString();
  saveSnapshot();
}

// ---- Phase 2: evaluate every barcode from the snapshot. ----
type Row = {
  code: string;
  list: string;
  name?: string;
  found: boolean;
  parts: number;
  confidence: Record<'high' | 'medium' | 'low', number>;
  coverage: Record<string, Coverage>;
};

const rows: Row[] = [];
let missing = 0;
for (const item of list.items) {
  if (!(item.code in snap.products)) missing++;
  const product = snap.products[item.code] ?? undefined;
  const rec = product ? reconcile(product) : { parts: [], notes: [], hasData: false };
  const coverage: Record<string, Coverage> = {};
  for (const pack of PACKS) coverage[pack.id] = product ? coverageOf(sortParts(rec.parts, pack)) : 'none';
  const confidence = { high: 0, medium: 0, low: 0 };
  for (const p of rec.parts) confidence[p.confidence]++;
  rows.push({ code: item.code, list: item.list, name: product?.product_name, found: !!product, parts: rec.parts.length, confidence, coverage });
}
errors = Math.max(errors, missing);

const total = rows.length;
const pct = (n: number) => Math.round((n / total) * 1000) / 10;
const summary = {
  evaluated: new Date().toISOString(),
  mode: 'barcodes fetched live from the Open Food Facts API into data/eval/snapshot.json, then evaluated',
  fetchedFrom: snap.started,
  fetchedTo: snap.finished ?? snap.started,
  selection: list.rule,
  total,
  lookupErrors: errors,
  found: rows.filter((r) => r.found).length,
  withPackagingData: rows.filter((r) => r.parts > 0).length,
  parts: rows.reduce((a, r) => a + r.parts, 0),
  partConfidence: {
    high: rows.reduce((a, r) => a + r.confidence.high, 0),
    medium: rows.reduce((a, r) => a + r.confidence.medium, 0),
    low: rows.reduce((a, r) => a + r.confidence.low, 0),
  },
  packs: Object.fromEntries(
    PACKS.map((pack) => {
      const c = (k: Coverage) => rows.filter((r) => r.coverage[pack.id] === k).length;
      return [pack.id, { name: pack.shortName, full: c('full'), partial: c('partial'), none: c('none'), fullPct: pct(c('full')), partialPct: pct(c('partial')), nonePct: pct(c('none')) }];
    }),
  ),
};

writeFileSync(join(root, 'data/eval/results.json'), JSON.stringify({ summary, rows }, null, 1) + '\n');
writeFileSync(join(root, 'data/eval/summary.json'), JSON.stringify(summary, null, 1) + '\n');

console.log(`\nBarcodes: ${total}  found: ${summary.found}  with packaging data: ${summary.withPackagingData}  lookup errors: ${errors}`);
console.log(`Parts: ${summary.parts}  confidence high/medium/low: ${summary.partConfidence.high}/${summary.partConfidence.medium}/${summary.partConfidence.low}`);
for (const p of Object.values(summary.packs)) {
  console.log(`${p.name.padEnd(20)} full ${p.full} (${p.fullPct}%)  partial ${p.partial} (${p.partialPct}%)  none ${p.none} (${p.nonePct}%)`);
}
