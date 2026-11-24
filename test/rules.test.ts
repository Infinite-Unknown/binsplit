import { describe, expect, it } from 'vitest';
import { PACKS, getPack, sortPart, coverageOf, sortParts } from '../src/core/rules.ts';
import type { MaterialClass, Part, ShapeClass } from '../src/core/types.ts';

const part = (shape: ShapeClass, material: MaterialClass, extra: Partial<Part> = {}): Part => ({
  id: `${shape}-${material}`,
  shape,
  material,
  confidence: 'high',
  reasons: [],
  evidence: [],
  needsInput: material === 'unknown',
  ...extra,
});

const my = getPack('my-act672');
const sg = getPack('sg-nea');

function binOf(p: Part, pack = my) {
  const v = sortPart(p, pack);
  return v.kind === 'rule' ? v.bin.id : v.kind;
}

describe('rule packs are well formed', () => {
  for (const pack of PACKS) {
    it(`${pack.id}: every rule points at a real bin and a real source`, () => {
      for (const r of pack.rules) {
        expect(pack.bins.some((b) => b.id === r.bin), r.id).toBe(true);
        expect(pack.sources.some((s) => s.id === r.source), r.id).toBe(true);
        expect(r.ref.length, r.id).toBeGreaterThan(3);
        expect(r.prep.length, r.id).toBeGreaterThan(0);
      }
      for (const g of pack.generalRules) expect(pack.sources.some((s) => s.id === g.source)).toBe(true);
      for (const g of pack.gaps) if (g.source) expect(pack.sources.some((s) => s.id === g.source), g.reason).toBe(true);
    });
    it(`${pack.id}: every source has an https URL and a fetch date`, () => {
      for (const s of pack.sources) {
        expect(s.url).toMatch(/^https:\/\//);
        expect(s.fetched).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });
  }
});

describe('Malaysia (SWCorp) pack', () => {
  it('sorts a jar of spread into three bins the way the leaflet lists them', () => {
    expect(binOf(part('jar', 'glass'))).toBe('others'); // "Jam Containers" under Others
    expect(binOf(part('cap', 'plastic'))).toBe('plastic');
    expect(binOf(part('seal', 'aluminium'))).toBe('others');
  });
  it('puts drink cartons with paper', () => {
    expect(binOf(part('brick', 'beverage-carton'))).toBe('paper');
    expect(binOf(part('brick', 'paper-composite'))).toBe('paper');
  });
  it('puts cans in Others', () => {
    expect(binOf(part('can', 'aluminium'))).toBe('others');
    expect(binOf(part('can', 'steel'))).toBe('others');
  });
  it('gives no bin for things the leaflet does not mention', () => {
    expect(binOf(part('bag', 'plastic-metal-laminate'))).toBe('gap');
    expect(binOf(part('tray', 'plastic-foam'))).toBe('gap');
    expect(binOf(part('sachet', 'plastic'))).toBe('gap');
  });
  it('marks item-level rules as listed and fallbacks as category', () => {
    const listed = sortPart(part('bottle', 'plastic'), my);
    const category = sortPart(part('label', 'plastic'), my);
    expect(listed.kind === 'rule' && listed.rule.specificity).toBe('listed');
    expect(category.kind === 'rule' && category.rule.specificity).toBe('category');
  });
});

describe('Singapore (NEA) pack', () => {
  it('puts clean recyclables in the one blue bin', () => {
    for (const p of [part('jar', 'glass'), part('cap', 'plastic'), part('cap', 'steel'), part('brick', 'beverage-carton'), part('can', 'aluminium')]) {
      expect(binOf(p, sg)).toBe('blue');
    }
  });
  it('sends foil-lined plastic, foam and cutlery to general waste (S/N 40-42)', () => {
    expect(binOf(part('bag', 'plastic-metal-laminate'), sg)).toBe('general');
    expect(binOf(part('pot', 'plastic-foam'), sg)).toBe('general');
    expect(binOf(part('cutlery', 'plastic'), sg)).toBe('general');
  });
  it('cites the summary table row', () => {
    const v = sortPart(part('brick', 'beverage-carton'), sg);
    expect(v.kind === 'rule' && v.rule.ref).toBe('Summary table, S/N 20');
  });
});

describe('unknown shape or material', () => {
  it('asks for the material when it is unknown', () => {
    expect(sortPart(part('bottle', 'unknown'), my)).toEqual({ kind: 'needs-input', missing: ['material'] });
  });
  it('answers without the shape when the shape cannot change the answer', () => {
    // Every glass item goes to Others in the Malaysia pack.
    expect(binOf(part('unknown', 'glass'))).toBe('others');
  });
  it('asks for the shape when the shape changes the answer', () => {
    // Plastic sachets are a gap, plastic bottles are not.
    expect(sortPart(part('unknown', 'plastic'), my)).toEqual({ kind: 'needs-input', missing: ['shape'] });
  });
});

describe('coverage classification', () => {
  it('is full only when every part has a bin and none is low confidence', () => {
    expect(coverageOf(sortParts([part('jar', 'glass'), part('cap', 'plastic')], my))).toBe('full');
    expect(coverageOf(sortParts([part('jar', 'glass', { confidence: 'low' })], my))).toBe('partial');
    expect(coverageOf(sortParts([part('jar', 'glass'), part('bag', 'plastic-foam')], my))).toBe('partial');
    expect(coverageOf(sortParts([part('bag', 'plastic-foam')], my))).toBe('none');
    expect(coverageOf([])).toBe('none');
  });
});
