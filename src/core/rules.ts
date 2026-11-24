// Applies a rule pack to reconciled parts.
//
// Matching order, most specific first:
//   1. a rule or gap that names this material AND this shape
//   2. a rule or gap that names this material for any shape
// A rule beats a gap at the same level. When the shape is unknown, the engine
// only answers if the shape could not change the answer; otherwise it asks.

import type { Part, Rule, RulePack, SortedPart, Verdict, MaterialClass, ShapeClass } from './types.ts';
import myPack from '../packs/my-act672.json' with { type: 'json' };
import sgPack from '../packs/sg-nea.json' with { type: 'json' };

export const PACKS: RulePack[] = [myPack as RulePack, sgPack as RulePack];

export function getPack(id: string): RulePack {
  return PACKS.find((p) => p.id === id) ?? PACKS[0];
}

interface Hit {
  level: 1 | 2;
  verdict: Verdict;
}

function materialHits(pack: RulePack, material: MaterialClass, shape: ShapeClass | undefined): Hit[] {
  const hits: Hit[] = [];
  for (const rule of pack.rules) {
    if (!rule.match.materials.includes(material)) continue;
    if (rule.match.shapes) {
      if (shape && rule.match.shapes.includes(shape)) hits.push({ level: 1, verdict: ruleVerdict(pack, rule) });
    } else {
      hits.push({ level: 2, verdict: ruleVerdict(pack, rule) });
    }
  }
  for (const gap of pack.gaps) {
    if (!gap.materials.includes(material)) continue;
    if (gap.shapes) {
      if (shape && gap.shapes.includes(shape)) hits.push({ level: 1, verdict: { kind: 'gap', reason: gap.reason } });
    } else {
      hits.push({ level: 2, verdict: { kind: 'gap', reason: gap.reason } });
    }
  }
  return hits;
}

function ruleVerdict(pack: RulePack, rule: Rule): Verdict {
  const bin = pack.bins.find((b) => b.id === rule.bin);
  if (!bin) throw new Error(`Rule ${rule.id} in pack ${pack.id} points at unknown bin ${rule.bin}`);
  return { kind: 'rule', rule, bin };
}

function best(hits: Hit[]): Verdict | undefined {
  // Rules are pushed before gaps, so a stable sort by level keeps rule-over-gap at each level.
  return [...hits].sort((a, b) => a.level - b.level)[0]?.verdict;
}

function outcomeKey(v: Verdict | undefined): string {
  if (!v) return 'none';
  return v.kind === 'rule' ? `bin:${v.bin.id}` : v.kind;
}

export function sortPart(part: Part, pack: RulePack): Verdict {
  const material = part.material;
  if (material === 'unknown') return { kind: 'needs-input', missing: part.shape === 'unknown' ? ['material', 'shape'] : ['material'] };

  if (part.shape === 'unknown' || part.shape === 'other') {
    const anyShape = best(materialHits(pack, material, undefined));
    // Would any specific shape give a different answer? Then ask for the shape.
    const shapesInPack = new Set<ShapeClass>();
    for (const r of pack.rules) if (r.match.materials.includes(material)) r.match.shapes?.forEach((s) => shapesInPack.add(s));
    for (const g of pack.gaps) if (g.materials.includes(material)) g.shapes?.forEach((s) => shapesInPack.add(s));
    const differs = [...shapesInPack].some((s) => outcomeKey(best(materialHits(pack, material, s))) !== outcomeKey(anyShape));
    if (differs || !anyShape) {
      if (part.shape === 'other' && anyShape) return anyShape;
      return { kind: 'needs-input', missing: ['shape'] };
    }
    return anyShape;
  }

  return (
    best(materialHits(pack, material, part.shape)) ?? {
      kind: 'gap',
      reason: `${pack.shortName} sources do not mention this kind of item.`,
    }
  );
}

export function sortParts(parts: Part[], pack: RulePack): SortedPart[] {
  return parts.map((part) => ({ part, verdict: sortPart(part, pack) }));
}

export type Coverage = 'full' | 'partial' | 'none';

/**
 * full: every part gets a bin from a sourced rule, and no part is low confidence.
 * partial: at least one part gets a bin, but not all, or some are low confidence.
 * none: no part gets a bin (no data, all gaps, or all need input).
 */
export function coverageOf(sorted: SortedPart[]): Coverage {
  const withBin = sorted.filter((s) => s.verdict.kind === 'rule');
  if (withBin.length === 0) return 'none';
  const allBinned = withBin.length === sorted.length;
  const anyLow = sorted.some((s) => s.part.confidence === 'low');
  return allBinned && !anyLow ? 'full' : 'partial';
}
