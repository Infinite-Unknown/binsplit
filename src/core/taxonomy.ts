// Resolves Open Food Facts packaging values (taxonomy ids, or free text in any
// language) to the canonical shape and material classes.

import tax from '../data/taxonomy.json' with { type: 'json' };
import { normalizeName } from './normalize.ts';
import type { MaterialClass, ResinCode, ShapeClass } from './types.ts';

type MaterialInfo = { c: MaterialClass; r?: ResinCode };
const materials = tax.materials as Record<string, MaterialInfo>;
const shapes = tax.shapes as Record<string, ShapeClass>;
const materialNames = tax.materialNames as Record<string, string>;
const shapeNames = tax.shapeNames as Record<string, string>;

// A few common English words the OFF taxonomies do not index (or index
// ambiguously). These are BinSplit's own additions, kept deliberately small.
const extraShapes: Record<string, ShapeClass> = {
  cap: 'cap',
  caps: 'cap',
  cup: 'cup',
  cups: 'cup',
  pouch: 'sachet',
  sachet: 'sachet',
  sachets: 'sachet',
  tub: 'pot',
  tin: 'can',
  carton: 'box',
  wrap: 'film',
  'plastic-film': 'film',
};
const extraMaterials: Record<string, MaterialInfo> = {
  tin: { c: 'steel' },
  styrofoam: { c: 'plastic-foam' },
  'polystyrene-foam': { c: 'plastic-foam' },
  eps: { c: 'plastic-foam' },
  tetrapak: { c: 'beverage-carton' },
  'beverage-carton': { c: 'beverage-carton' },
  'drink-carton': { c: 'beverage-carton' },
  'plastic-film': { c: 'plastic' },
};

export interface MaterialHit {
  material: MaterialClass;
  resin?: ResinCode;
  tag?: string;
}

export function resolveMaterial(raw: string | undefined): MaterialHit | undefined {
  if (!raw) return undefined;
  const direct = materials[raw];
  if (direct) return { material: direct.c, resin: direct.r, tag: raw };
  const key = normalizeName(raw);
  if (!key) return undefined;
  const extra = extraMaterials[key];
  if (extra) return { material: extra.c, resin: extra.r };
  const id = materialNames[key];
  if (id && materials[id]) return { material: materials[id].c, resin: materials[id].r, tag: id };
  // Resin codes written as "PET 1", "05 PP", "♷" etc.
  const code = key.match(/(?:^|-)0?([1-7])(?:-|$)/);
  if (code && /pet|pe|pp|ps|pvc|plastic|resin/.test(key)) {
    return { material: 'plastic', resin: Number(code[1]) as ResinCode };
  }
  return undefined;
}

export interface ShapeHit {
  shape: ShapeClass;
  tag?: string;
}

export function resolveShape(raw: string | undefined): ShapeHit | undefined {
  if (!raw) return undefined;
  const direct = shapes[raw];
  if (direct) return { shape: direct, tag: raw };
  const key = normalizeName(raw);
  if (!key) return undefined;
  const extra = extraShapes[key];
  if (extra) return { shape: extra };
  const id = shapeNames[key];
  if (id && shapes[id]) return { shape: shapes[id], tag: id };
  // Plurals: "bottles", "lids", "boxes"
  const singular = key.replace(/(es|s)$/, '');
  if (singular !== key) {
    const hit = extraShapes[singular] ?? (shapeNames[singular] ? shapes[shapeNames[singular]] : undefined);
    if (hit) return { shape: hit, tag: shapeNames[singular] };
  }
  return undefined;
}

export const SHAPE_LABELS: Record<ShapeClass, string> = {
  bottle: 'Bottle',
  jar: 'Jar',
  can: 'Can',
  'aerosol-can': 'Aerosol can',
  cap: 'Cap or lid',
  seal: 'Seal',
  label: 'Label or sleeve',
  box: 'Box',
  brick: 'Drink carton',
  tray: 'Tray',
  pot: 'Pot or tub',
  cup: 'Cup',
  bag: 'Bag',
  film: 'Film or wrapper',
  sachet: 'Sachet or pouch',
  blister: 'Blister pack',
  tube: 'Tube',
  capsule: 'Capsule',
  cutlery: 'Cutlery',
  straw: 'Straw',
  other: 'Other part',
  unknown: 'Unknown part',
};

export const MATERIAL_LABELS: Record<MaterialClass, string> = {
  paper: 'Paper',
  cardboard: 'Cardboard',
  'beverage-carton': 'Drink carton board',
  'paper-composite': 'Paper with plastic or foil layers',
  plastic: 'Plastic',
  'plastic-foam': 'Polystyrene foam',
  'biodegradable-plastic': 'Biodegradable plastic',
  'plastic-metal-laminate': 'Plastic with foil layer',
  glass: 'Glass',
  aluminium: 'Aluminium',
  steel: 'Steel / tin',
  metal: 'Metal',
  wood: 'Wood or cork',
  other: 'Other material',
  unknown: 'Unknown material',
};

export const RESIN_LABELS: Record<ResinCode, string> = {
  1: 'PET',
  2: 'HDPE',
  3: 'PVC',
  4: 'LDPE',
  5: 'PP',
  6: 'PS',
  7: 'Other plastic',
};
