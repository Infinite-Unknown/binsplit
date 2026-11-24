// Reconciles the packaging fields of an Open Food Facts product into one list
// of physical parts, each with a confidence level.
//
// Open Food Facts stores packaging in several crowd-sourced fields that often
// disagree:
//   - packagings:        structured components {shape, material, units}
//   - packaging_text:    free text, any language ("pot: verre, couvercle: PP")
//   - packaging_tags:    parsed text ("en:lid: plastic (recycle)") or bare tags
//   - packaging_shapes_tags / packaging_materials_tags: flat, unpaired lists
//
// Strategy: structured components first, then text components matched to them
// by shape. Agreement raises confidence, disagreement lowers it and keeps the
// alternative so the user can settle it in one tap. Flat tags are used only
// when nothing better exists.

import { resolveMaterial, resolveShape, MATERIAL_LABELS, SHAPE_LABELS } from './taxonomy.ts';
import { normalizeName } from './normalize.ts';
import type {
  Confidence,
  Evidence,
  EvidenceSource,
  MaterialClass,
  OffProduct,
  Part,
  Reconciled,
  ResinCode,
  ShapeClass,
} from './types.ts';

interface Candidate {
  shape?: ShapeClass;
  shapeTag?: string;
  material?: MaterialClass;
  materialTag?: string;
  resin?: ResinCode;
  units?: number;
  evidence: Evidence;
  /** Other container names the text used for this same part (e.g. "pot" and "jar"). */
  aliases?: ShapeClass[];
  /** Built by joining a shape-only and a material-only structured component. */
  joined?: boolean;
}

/** Shapes that describe the main container. Sources often name it differently. */
const CONTAINER: ShapeClass[] = ['bottle', 'jar', 'pot', 'cup', 'tray', 'box', 'can', 'brick', 'tube'];

const GENERIC_MATERIALS: MaterialClass[] = ['unknown', 'other'];

function isKnownMaterial(m?: MaterialClass): m is MaterialClass {
  return !!m && !GENERIC_MATERIALS.includes(m);
}
function isKnownShape(s?: ShapeClass): s is ShapeClass {
  return !!s && s !== 'unknown' && s !== 'other';
}

/** Is material `a` a more specific statement of material `b` (or equal)? */
function sameMaterial(a: MaterialClass, b: MaterialClass): boolean {
  if (a === b) return true;
  const pair = (x: MaterialClass, y: MaterialClass) => (a === x && b === y) || (a === y && b === x);
  return pair('paper', 'cardboard') || pair('metal', 'aluminium') || pair('metal', 'steel');
}

// ---------- Parsing ----------

function fromPackagings(p: OffProduct): Candidate[] {
  return (p.packagings ?? [])
    .map((c): Candidate | undefined => {
      // Contributors sometimes type free text into these fields ("Juice Carton (& Cap)",
      // "Tetra Prisma Aseptic: FSC Mix board"), so fall back to scanning the words.
      const s = resolveShape(c.shape) ?? (c.shape ? scanSegment(c.shape).shape : undefined);
      const m = resolveMaterial(c.material) ?? (c.material ? scanSegment(c.material).material : undefined);
      if (!s && !m) return undefined;
      const raw = [c.shape, c.material].filter(Boolean).join(' / ');
      return {
        shape: s?.shape,
        shapeTag: s?.tag ?? c.shape,
        material: m?.material,
        materialTag: m?.tag ?? c.material,
        resin: m?.resin,
        units: c.number_of_units && c.number_of_units > 0 ? c.number_of_units : undefined,
        evidence: { source: 'packagings', raw, shape: s?.shape, material: m?.material },
      };
    })
    .filter((c): c is Candidate => !!c);
}

/** Find the first shape and the first material named in a free-text segment. */
function scanSegment(segment: string): { shape?: ReturnType<typeof resolveShape>; material?: ReturnType<typeof resolveMaterial> } {
  const words = normalizeName(segment).split('-').filter(Boolean);
  let shape: ReturnType<typeof resolveShape>;
  let material: ReturnType<typeof resolveMaterial>;
  // Longest spans first so "aluminium foil" beats "aluminium".
  for (let len = Math.min(4, words.length); len >= 1; len--) {
    for (let i = 0; i + len <= words.length; i++) {
      const span = words.slice(i, i + len).join('-');
      if (!shape) shape = resolveShape(span);
      if (!material) {
        const m = resolveMaterial(span);
        if (m && (len > 1 || span.length > 2 || /^[1-7]$/.test(span) === false)) material = m;
      }
    }
  }
  return { shape, material };
}

function parseSegment(segment: string, source: EvidenceSource): Candidate | undefined {
  const cleaned = segment.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return undefined;
  let shape: ReturnType<typeof resolveShape>;
  let material: ReturnType<typeof resolveMaterial>;
  const colon = cleaned.indexOf(':');
  if (colon > 0) {
    const left = cleaned.slice(0, colon);
    const right = cleaned.slice(colon + 1);
    shape = resolveShape(left) ?? scanSegment(left).shape;
    material = resolveMaterial(right) ?? scanSegment(right).material;
    if (!shape && !material) ({ shape, material } = scanSegment(cleaned));
  } else {
    ({ shape, material } = scanSegment(cleaned));
  }
  if (!shape && !material) return undefined;
  return {
    shape: shape?.shape,
    shapeTag: shape?.tag,
    material: material?.material,
    materialTag: material?.tag,
    resin: material?.resin,
    evidence: { source, raw: segment.trim(), shape: shape?.shape, material: material?.material },
  };
}

function fromText(p: OffProduct): Candidate[] {
  const out: Candidate[] = [];
  if (p.packaging_text) {
    for (const seg of p.packaging_text.split(/[,;\n]|\s\/\s|\s\+\s/)) {
      const c = parseSegment(seg, 'packaging_text');
      if (c) out.push(c);
    }
  }
  // Tags of the form "en:jar: clear glass (recycle)" are parsed text too.
  for (const tag of p.packaging_tags ?? []) {
    const body = tag.replace(/^[a-z]{2}:/, '');
    if (!body.includes(':')) continue;
    const c = parseSegment(body, 'packaging_tags');
    if (c) out.push(c);
  }
  return dedupeText(out);
}

/** Drop repeats (same shape and material) and merge container synonyms of the same material. */
function dedupeText(cands: Candidate[]): Candidate[] {
  const out: Candidate[] = [];
  for (const c of cands) {
    const dup = out.find(
      (o) =>
        (o.shape === c.shape || (o.shape && c.shape && CONTAINER.includes(o.shape) && CONTAINER.includes(c.shape) && o.material === c.material && isKnownMaterial(c.material))) &&
        (o.material === c.material || !c.material || !o.material),
    );
    if (dup) {
      if (c.shape && c.shape !== dup.shape) (dup.aliases ??= []).push(c.shape);
      dup.material ??= c.material;
      dup.materialTag ??= c.materialTag;
      dup.shape ??= c.shape;
      continue;
    }
    out.push({ ...c });
  }
  return out;
}

/** Bare tags: legacy packaging_tags without a colon, plus the flat shape and material lists. */
function fromFlatTags(p: OffProduct): { shapes: Candidate[]; materials: Candidate[] } {
  const shapes: Candidate[] = [];
  const materials: Candidate[] = [];
  const seenS = new Set<string>();
  const seenM = new Set<string>();
  const visit = (raw: string, source: EvidenceSource) => {
    const m = resolveMaterial(raw);
    const s = m ? undefined : resolveShape(raw);
    if (m && isKnownMaterial(m.material) && !seenM.has(m.material)) {
      seenM.add(m.material);
      materials.push({ material: m.material, materialTag: m.tag ?? raw, resin: m.resin, evidence: { source, raw, material: m.material } });
    } else if (s && isKnownShape(s.shape) && !seenS.has(s.shape)) {
      seenS.add(s.shape);
      shapes.push({ shape: s.shape, shapeTag: s.tag ?? raw, evidence: { source, raw, shape: s.shape } });
    }
  };
  for (const t of p.packaging_shapes_tags ?? []) visit(t, 'shape_material_tags');
  for (const t of p.packaging_materials_tags ?? []) visit(t, 'shape_material_tags');
  for (const t of p.packaging_tags ?? []) if (!t.replace(/^[a-z]{2}:/, '').includes(':')) visit(t, 'packaging_tags');
  // Drop generic parents when a more specific material is present (plastic vs PET is fine; metal vs aluminium).
  const specific = materials.filter((m) => !(m.material === 'metal' && materials.some((o) => o.material === 'aluminium' || o.material === 'steel')));
  const noPaperDup = specific.filter((m) => !(m.material === 'paper' && specific.some((o) => o.material === 'cardboard')));
  return { shapes, materials: noPaperDup };
}

// Typical pairings, used only to pair flat shape and material tags when the
// record never says which material belongs to which shape. Pairings made this
// way are always marked low confidence.
const AFFINITY: Partial<Record<ShapeClass, MaterialClass[]>> = {
  can: ['aluminium', 'steel', 'metal'],
  'aerosol-can': ['aluminium', 'steel', 'metal'],
  brick: ['beverage-carton', 'paper-composite'],
  box: ['cardboard', 'paper'],
  bottle: ['plastic', 'glass'],
  jar: ['glass', 'plastic'],
  cap: ['plastic', 'metal', 'aluminium', 'steel'],
  film: ['plastic', 'plastic-metal-laminate'],
  bag: ['plastic', 'plastic-metal-laminate', 'paper'],
  sachet: ['plastic-metal-laminate', 'plastic'],
  tray: ['plastic', 'aluminium', 'cardboard', 'plastic-foam'],
  pot: ['plastic', 'glass'],
  label: ['paper', 'plastic'],
  seal: ['aluminium', 'plastic', 'plastic-metal-laminate'],
};

// ---------- Merge ----------

let counter = 0;
function makePart(c: Candidate, confidence: Confidence, reasons: string[], extraEvidence: Evidence[] = []): Part {
  const shape = c.shape ?? 'unknown';
  const material = c.material ?? 'unknown';
  return {
    id: `p${counter++}`,
    shape,
    material,
    resin: c.resin,
    shapeTag: c.shapeTag,
    materialTag: c.materialTag,
    units: c.units,
    confidence,
    reasons,
    evidence: [c.evidence, ...extraEvidence],
    needsInput: !isKnownMaterial(material),
  };
}

function label(c: Candidate): string {
  return `${c.material ? MATERIAL_LABELS[c.material].toLowerCase() : 'unknown material'} ${c.shape ? SHAPE_LABELS[c.shape].toLowerCase() : 'part'}`;
}

export function reconcile(product: OffProduct): Reconciled {
  counter = 0;
  const notes: string[] = [];
  const structured = joinSplitComponents(mergeDuplicates(fromPackagings(product)));
  const text = fromText(product);
  const parts: Part[] = [];
  const usedText = new Set<number>();
  const matchOf = new Map<Candidate, number>();
  const sameShape = (t: Candidate, s: Candidate) => !!s.shape && (t.shape === s.shape || !!t.aliases?.includes(s.shape));

  // Pass 1: exact shape matches. Pass 2: a lone unmatched container matches a lone unmatched container.
  for (const s of structured) {
    const ti = text.findIndex((t, i) => !usedText.has(i) && sameShape(t, s));
    if (ti >= 0) {
      usedText.add(ti);
      matchOf.set(s, ti);
    }
  }
  const lonelyS = structured.filter((s) => !matchOf.has(s) && s.shape && CONTAINER.includes(s.shape));
  const lonelyT = text.map((t, i) => ({ t, i })).filter(({ t, i }) => !usedText.has(i) && t.shape && CONTAINER.includes(t.shape));
  if (lonelyS.length === 1 && lonelyT.length === 1) {
    usedText.add(lonelyT[0].i);
    matchOf.set(lonelyS[0], lonelyT[0].i);
  }
  // A full text description (two or more parts) that never mentions a structured part casts doubt on it.
  const textIsFull = text.filter((t) => isKnownShape(t.shape)).length >= 2;

  for (const s of structured) {
    const ti = matchOf.get(s);
    if (ti === undefined) {
      const complete = isKnownShape(s.shape) && isKnownMaterial(s.material);
      const part = makePart(
        s,
        complete && !textIsFull && !s.joined ? 'medium' : 'low',
        s.joined
          ? ['The structured list gives this shape and this material as two separate entries; they were joined because each was the only one of its kind. Please check.']
          : complete
          ? textIsFull
            ? [`The structured packaging list has a ${label(s)}, but the packaging text, which lists the other parts, does not mention it.`]
            : ['Only the structured packaging list describes this part.']
          : [`The structured packaging list gives ${s.shape ? 'no material' : 'no shape'} for this part.`],
      );
      if (complete && textIsFull) part.doubt = 'existence';
      parts.push(part);
      continue;
    }
    const t = text[ti];
    const merged: Candidate = {
      ...s,
      shape: s.shape ?? t.shape,
      shapeTag: s.shapeTag ?? t.shapeTag,
      material: isKnownMaterial(s.material) ? s.material : t.material,
      materialTag: isKnownMaterial(s.material) ? s.materialTag : t.materialTag,
      resin: s.resin ?? t.resin,
    };
    if (isKnownMaterial(s.material) && isKnownMaterial(t.material) && !sameMaterial(s.material, t.material)) {
      const part = makePart(
        merged,
        'low',
        [`Sources disagree: the structured list says ${label(s)}, the packaging text says ${label(t)}.`],
        [t.evidence],
      );
      part.alternatives = [
        { material: s.material, source: 'packagings', raw: s.evidence.raw },
        { material: t.material, source: t.evidence.source, raw: t.evidence.raw },
      ];
      parts.push(part);
    } else if (isKnownMaterial(s.material) && isKnownMaterial(t.material)) {
      if (s.material === 'metal' && t.material !== 'metal') {
        merged.material = t.material;
        merged.materialTag = t.materialTag;
      }
      parts.push(makePart(merged, 'high', ['The structured packaging list and the packaging text agree.'], [t.evidence]));
    } else {
      const complete = isKnownShape(merged.shape) && isKnownMaterial(merged.material);
      parts.push(
        makePart(
          merged,
          complete ? 'medium' : 'low',
          [complete ? 'The structured list gives the shape and the packaging text gives the material; they do not contradict each other.' : 'The material of this part is not recorded.'],
          [t.evidence],
        ),
      );
    }
  }

  text.forEach((t, i) => {
    if (usedText.has(i)) return;
    const complete = isKnownShape(t.shape) && isKnownMaterial(t.material);
    parts.push(makePart(t, complete ? 'medium' : 'low', [complete ? 'Only the packaging text describes this part.' : `The packaging text does not say the ${t.shape ? 'material' : 'shape'} of this part.`]));
  });

  if (parts.length === 0) {
    parts.push(...pairFlatTags(product));
    if (parts.length) notes.push('Only unpaired shape and material tags were recorded, so parts were paired by typical use.');
  }

  for (const p of parts) applyCartonRule(p);

  const hasData = parts.length > 0;
  if (!hasData) notes.push('This product has no packaging information in Open Food Facts yet.');
  return { parts: dropContainedDuplicates(parts), notes, hasData };
}

/** Structured components that repeat the same shape and material are one part with more units. */
function mergeDuplicates(cands: Candidate[]): Candidate[] {
  const out: Candidate[] = [];
  for (const c of cands) {
    const d = out.find((o) => o.shape === c.shape && o.material === c.material);
    if (d) {
      d.units = (d.units ?? 1) + (c.units ?? 1);
      continue;
    }
    out.push({ ...c });
  }
  return out;
}

function pairFlatTags(product: OffProduct): Part[] {
  const { shapes, materials } = fromFlatTags(product);
  const parts: Part[] = [];
  if (shapes.length === 0 && materials.length === 0) return parts;
  if (shapes.length <= 1 && materials.length === 1) {
    const c: Candidate = { ...materials[0], shape: shapes[0]?.shape, shapeTag: shapes[0]?.shapeTag };
    const ev = shapes[0] ? [shapes[0].evidence] : [];
    parts.push(
      makePart(c, shapes[0] ? 'medium' : 'low', [shapes[0] ? 'One shape and one material were tagged, so they belong together.' : 'Only the material was tagged; the shape is not recorded.'], ev),
    );
    return parts;
  }
  const freeMaterials = [...materials];
  for (const s of shapes) {
    const fits = freeMaterials.filter((m) => AFFINITY[s.shape!]?.includes(m.material!));
    if (fits.length === 1) {
      freeMaterials.splice(freeMaterials.indexOf(fits[0]), 1);
      parts.push(
        makePart({ ...fits[0], shape: s.shape, shapeTag: s.shapeTag }, 'low', [
          `Paired by typical use: a ${SHAPE_LABELS[s.shape!].toLowerCase()} is usually ${MATERIAL_LABELS[fits[0].material!].toLowerCase()}. Please check.`,
        ], [s.evidence]),
      );
    } else {
      parts.push(makePart(s, 'low', ['The record tags this shape but not which material it is made of.']));
    }
  }
  for (const m of freeMaterials) {
    parts.push(makePart(m, 'low', ['The record tags this material but not which part it belongs to.']));
  }
  return parts;
}

/** A brick-shaped part made of paper-based or composite board is a drink carton. */
function applyCartonRule(p: Part) {
  if (p.shape === 'brick' && (p.material === 'paper-composite' || p.material === 'other' || p.material === 'unknown')) {
    p.material = 'beverage-carton';
    p.needsInput = false;
    p.reasons.push('A brick-shaped carton is treated as a drink carton (Open Food Facts uses "brick" for Tetra Brik style cartons).');
  }
}

/** If an unknown-shape part has the same material as a known-shape part, it is the same part. */
function dropContainedDuplicates(parts: Part[]): Part[] {
  return parts.filter(
    (p) =>
      !(p.shape === 'unknown' && parts.some((o) => o !== p && o.shape !== 'unknown' && o.material !== 'unknown' && sameMaterial(o.material, p.material))),
  );
}

/**
 * The structured list sometimes splits one part in two: a shape with no material
 * and a material with no shape. When exactly one of each is left, they are the same part.
 */
function joinSplitComponents(cands: Candidate[]): Candidate[] {
  const shapeOnly = cands.filter((c) => c.shape && isKnownShape(c.shape) && !isKnownMaterial(c.material));
  const materialOnly = cands.filter((c) => !c.shape && isKnownMaterial(c.material));
  if (shapeOnly.length !== 1 || materialOnly.length !== 1) return cands;
  const [s] = shapeOnly;
  const [m] = materialOnly;
  const joined: Candidate = {
    ...s,
    material: m.material,
    materialTag: m.materialTag,
    resin: m.resin,
    joined: true,
    evidence: { source: 'packagings', raw: `${s.evidence.raw} + ${m.evidence.raw}`, shape: s.shape, material: m.material },
  };
  return cands.filter((c) => c !== s && c !== m).concat(joined);
}
