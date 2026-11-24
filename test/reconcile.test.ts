// Reconciler tests against saved, unedited Open Food Facts responses
// (test/fixtures/off/<barcode>.json, fetched 2026-11-24, ODbL).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { reconcile } from '../src/core/reconcile.ts';
import { getPack, sortParts, coverageOf } from '../src/core/rules.ts';
import type { OffProduct } from '../src/core/types.ts';

const fixture = (code: string): OffProduct =>
  JSON.parse(readFileSync(new URL(`./fixtures/off/${code}.json`, import.meta.url), 'utf8'));
const summary = (code: string) =>
  reconcile(fixture(code)).parts.map((p) => `${p.shape}/${p.material}/${p.confidence}${p.doubt ? '/doubt' : ''}`);

describe('reconcile real products', () => {
  it('Nutella 400 g: text and structured list disagree, the phantom bottle is flagged', () => {
    // Structured list says "plastic bottle x6" and a jar with no material;
    // the packaging text says glass jar, plastic lid, aluminium seal.
    expect(summary('3017620422003')).toEqual([
      'bottle/plastic/low/doubt',
      'jar/glass/medium',
      'cap/plastic/medium',
      'seal/aluminium/medium',
    ]);
    const bottle = reconcile(fixture('3017620422003')).parts[0];
    expect(bottle.units).toBe(6);
    expect(bottle.reasons[0]).toMatch(/does not mention it/);
  });

  it('Amul butter: structured and text agree on box and film; the loose "paper" entry is the same box', () => {
    expect(summary('8901262010016')).toEqual(['box/cardboard/high', 'film/plastic/high']);
  });

  it('Coconut water: free text typed into the structured fields still resolves', () => {
    // packagings: "Juice Carton ( & Cap)" / "Tetra Prisma Aseptic: FSC Mix board"
    expect(summary('8850025000026')).toEqual(['box/beverage-carton/medium', 'cap/plastic/medium']);
  });

  it('Green tea bottle: bottle and cap from the structured list', () => {
    expect(summary('8888196173324')).toEqual(['bottle/plastic/medium', 'cap/plastic/medium']);
  });

  it('Barista oat milk: a carton brick is a drink carton', () => {
    expect(summary('9300652809770')).toEqual(['brick/beverage-carton/medium']);
  });

  it('Maggi chilli sauce: material only, shape unknown, low confidence', () => {
    expect(summary('9556001601001')).toEqual(['unknown/glass/low']);
  });

  it('Skim milk: shapes without materials need the user', () => {
    const parts = reconcile(fixture('9315090206968')).parts;
    expect(parts.every((p) => p.needsInput)).toBe(true);
  });

  it('Ritz box: composite wrapper is not guessed into a bin', () => {
    const sorted = sortParts(reconcile(fixture('8992760211036')).parts, getPack('my-act672'));
    const wrapper = sorted.find((s) => s.part.shape === 'film')!;
    expect(wrapper.verdict.kind).toBe('gap');
  });
});

describe('end to end: product to bins', () => {
  it('Nutella under Malaysia rules: jar and seal to Others, lid to Plastics', () => {
    const parts = reconcile(fixture('3017620422003')).parts.filter((p) => !p.doubt);
    const sorted = sortParts(parts, getPack('my-act672'));
    const bins = Object.fromEntries(sorted.map((s) => [s.part.shape, s.verdict.kind === 'rule' ? s.verdict.bin.id : s.verdict.kind]));
    expect(bins).toEqual({ jar: 'others', cap: 'plastic', seal: 'others' });
  });

  it('Nutella under Singapore rules: everything in the blue bin', () => {
    const parts = reconcile(fixture('3017620422003')).parts.filter((p) => !p.doubt);
    const sorted = sortParts(parts, getPack('sg-nea'));
    expect(sorted.every((s) => s.verdict.kind === 'rule' && s.verdict.bin.id === 'blue')).toBe(true);
  });

  it('a doubtful part keeps coverage at partial', () => {
    const sorted = sortParts(reconcile(fixture('3017620422003')).parts, getPack('my-act672'));
    expect(coverageOf(sorted)).toBe('partial');
  });
});
