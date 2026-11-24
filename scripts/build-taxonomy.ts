// Derives src/data/taxonomy.json from the Open Food Facts packaging taxonomies
// in data/off-taxonomy/ (downloaded from static.openfoodfacts.org, ODbL).
//
// Every taxonomy entry is mapped to one canonical material or shape class by
// walking up its parents, and every name and synonym in every language is
// indexed so free-text values like "carta" or "Flasche" resolve too.
//
// Run: node scripts/build-taxonomy.ts

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalizeName } from '../src/core/normalize.ts';
import type { MaterialClass, ShapeClass, ResinCode } from '../src/core/types.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

interface Entry {
  parents?: string[];
  name?: Record<string, string>;
  synonyms?: Record<string, string[]>;
}
type Taxonomy = Record<string, Entry>;

const load = (f: string): Taxonomy =>
  JSON.parse(readFileSync(join(root, 'data/off-taxonomy', f), 'utf8'));

function ancestors(tax: Taxonomy, id: string): Set<string> {
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const p of tax[cur]?.parents ?? []) stack.push(p);
  }
  return seen;
}

const has = (anc: Set<string>, ...ids: string[]) => ids.some((i) => anc.has(i));
const hasPrefix = (anc: Set<string>, ...prefixes: string[]) =>
  [...anc].some((a) => prefixes.some((p) => a.startsWith(p)));

function materialClass(tax: Taxonomy, id: string): MaterialClass {
  const a = ancestors(tax, id);
  if (has(a, 'en:tetra-pak', 'en:elopak', 'en:sig', 'en:pure-pak', 'en:italpack')) return 'beverage-carton';
  if (has(a, 'en:eps-expanded-polystyrene')) return 'plastic-foam';
  if (has(a, 'en:biodegradable-plastic', 'en:pla-polylactic-acid', 'en:cpla-crystallized-polyactic-acid')) return 'biodegradable-plastic';
  if (
    has(a, 'en:plastic-aluminium', 'en:plastic-miscellaneous-metals', 'en:plastic-steelplate') ||
    hasPrefix(a, 'en:pemet', 'en:petmet')
  )
    return 'plastic-metal-laminate';
  if (hasPrefix(a, 'en:paper-and-')) return 'paper-composite';
  if (hasPrefix(a, 'en:glass-')) return 'other';
  if (has(a, 'en:composite-material')) return 'other';
  if (has(a, 'en:plastic')) return 'plastic';
  if (has(a, 'en:glass')) return 'glass';
  if (has(a, 'en:aluminium')) return 'aluminium';
  if (has(a, 'en:steel', 'en:tin-plated-steel')) return 'steel';
  if (has(a, 'en:metal')) return 'metal';
  if (has(a, 'en:cardboard')) return 'cardboard';
  if (has(a, 'en:paper-or-cardboard')) return 'paper';
  if (has(a, 'en:wood', 'en:cork')) return 'wood';
  if (has(a, 'en:unknown')) return 'unknown';
  return 'other';
}

function resinCode(id: string): ResinCode | undefined {
  const s = id.replace(/^[a-z]{2}:/, '');
  if (/^(r?pet|apet|bpet|petg)\b|^pet-/.test(s)) return 1;
  if (/^(bio)?hdpe/.test(s)) return 2;
  if (/^pvc-/.test(s)) return 3;
  if (/^(bio-)?l?ldpe|^lldpe/.test(s)) return 4;
  if (/^(c|o)?pp-|^opp-|^cpp-|^pp-/.test(s)) return 5;
  if (/^ps-6/.test(s)) return 6;
  if (/^o-7|^pc-|^pa-|^pmma/.test(s)) return 7;
  return undefined;
}

function shapeClass(tax: Taxonomy, id: string): ShapeClass {
  const a = ancestors(tax, id);
  if (has(a, 'en:aerosol-can')) return 'aerosol-can';
  if (has(a, 'en:can')) return 'can';
  if (has(a, 'en:pouch-flask', 'en:individual-dose', 'en:tea-bag')) return 'sachet';
  if (has(a, 'en:bottle-or-vial', 'en:pump-bottle', 'en:jug-or-canister', 'en:ball-flask', 'en:ampoule')) return 'bottle';
  if (has(a, 'en:jar')) return 'jar';
  if (has(a, 'en:lid-or-cap', 'en:tethered-cap', 'en:overcap', 'en:special-cap', 'en:pouring-cap', 'en:spout', 'en:reducer', 'en:valve'))
    return 'cap';
  if (has(a, 'en:seal', 'en:neck-seal', 'en:clamping-ring')) return 'seal';
  if (has(a, 'en:label', 'en:sleeve')) return 'label';
  if (has(a, 'en:brick', 'en:small-brick')) return 'brick';
  if (has(a, 'en:box', 'en:case', 'en:crate', 'en:bag-in-box')) return 'box';
  if (has(a, 'en:tray', 'en:inlay', 'en:mold', 'en:plate', 'en:wedge')) return 'tray';
  if (has(a, 'en:tumbler')) return 'cup';
  if (has(a, 'en:pot', 'en:dish', 'en:bucket', 'en:basket')) return 'pot';
  if (has(a, 'en:bag', 'en:packet', 'en:net', 'en:envelope')) return 'bag';
  if (has(a, 'en:film', 'en:wrapper', 'en:sheet', 'en:overpack', 'en:protection-cover', 'en:bubble-wrap', 'xx:cellophane'))
    return 'film';
  if (has(a, 'en:blister')) return 'blister';
  if (has(a, 'en:tube')) return 'tube';
  if (has(a, 'en:coffee-capsule', 'en:coffee-pad', 'en:tea-capsules', 'en:cartridge')) return 'capsule';
  if (has(a, 'en:eating-utensils')) return 'cutlery';
  if (has(a, 'en:drinking-straw')) return 'straw';
  if (has(a, 'en:unknown')) return 'unknown';
  return 'other';
}

function indexNames(tax: Taxonomy, out: Record<string, string>) {
  // Lower priority first, so canonical English names win collisions.
  const add = (name: string, id: string, force = false) => {
    const k = normalizeName(name);
    if (!k) return;
    if (force || !(k in out)) out[k] = id;
  };
  for (const [id, e] of Object.entries(tax)) {
    for (const list of Object.values(e.synonyms ?? {})) for (const s of list) add(s, id);
    for (const [lang, n] of Object.entries(e.name ?? {})) if (lang !== 'en') add(n, id);
  }
  for (const [id, e] of Object.entries(tax)) {
    add(id.replace(/^[a-z]{2}:/, ''), id, true);
    if (e.name?.en) add(e.name.en, id, true);
  }
}

const materials = load('packaging_materials.json');
const shapes = load('packaging_shapes.json');

const out = {
  generated: new Date().toISOString().slice(0, 10),
  source: 'Open Food Facts packaging taxonomies (ODbL), static.openfoodfacts.org/data/taxonomies/',
  materials: {} as Record<string, { c: MaterialClass; r?: ResinCode }>,
  shapes: {} as Record<string, ShapeClass>,
  materialNames: {} as Record<string, string>,
  shapeNames: {} as Record<string, string>,
};

for (const id of Object.keys(materials)) {
  const c = materialClass(materials, id);
  const r = c === 'plastic' || c === 'plastic-foam' ? resinCode(id) : undefined;
  out.materials[id] = r ? { c, r } : { c };
}
for (const id of Object.keys(shapes)) out.shapes[id] = shapeClass(shapes, id);
indexNames(materials, out.materialNames);
indexNames(shapes, out.shapeNames);

writeFileSync(join(root, 'src/data/taxonomy.json'), JSON.stringify(out));
const count = (o: Record<string, unknown>) => Object.keys(o).length;
console.log(
  `taxonomy.json: ${count(out.materials)} materials, ${count(out.shapes)} shapes, ` +
    `${count(out.materialNames)} material names, ${count(out.shapeNames)} shape names`,
);
