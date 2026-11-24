import { describe, expect, it } from 'vitest';
import { resolveMaterial, resolveShape } from '../src/core/taxonomy.ts';
import { cleanBarcode, validCheckDigit } from '../src/core/off.ts';

describe('material resolution', () => {
  it('maps taxonomy ids through their parents', () => {
    expect(resolveMaterial('en:clear-glass')?.material).toBe('glass');
    expect(resolveMaterial('en:pet-1-polyethylene-terephthalate')).toMatchObject({ material: 'plastic', resin: 1 });
    expect(resolveMaterial('en:pp-5-polypropylene')).toMatchObject({ material: 'plastic', resin: 5 });
    expect(resolveMaterial('en:tetra-pak')?.material).toBe('beverage-carton');
    expect(resolveMaterial('en:plastic-aluminium')?.material).toBe('plastic-metal-laminate');
    expect(resolveMaterial('en:corrugated-cardboard')?.material).toBe('cardboard');
  });
  it('understands free text in other languages', () => {
    expect(resolveMaterial('carta')?.material).toBe('paper'); // Italian
    expect(resolveMaterial('Verre')?.material).toBe('glass'); // French
    expect(resolveMaterial('fr:plastique')?.material).toBe('plastic');
  });
  it('reads resin codes written by hand', () => {
    expect(resolveMaterial('PP 5')).toMatchObject({ material: 'plastic', resin: 5 });
  });
  it('returns undefined for nonsense', () => {
    expect(resolveMaterial('zzzz')).toBeUndefined();
  });
});

describe('shape resolution', () => {
  it('maps shapes and synonyms', () => {
    expect(resolveShape('en:screw-cap')?.shape).toBe('cap');
    expect(resolveShape('bouteille')?.shape).toBe('bottle');
    expect(resolveShape('en:drink-can')?.shape).toBe('can');
    expect(resolveShape('lids')?.shape).toBe('cap');
    expect(resolveShape('pouch')?.shape).toBe('sachet');
  });
});

describe('barcodes', () => {
  it('accepts 8, 12, 13 and 14 digit codes', () => {
    expect(cleanBarcode(' 3017 6204 22003 ')).toBe('3017620422003');
    expect(cleanBarcode('12345')).toBeNull();
  });
  it('checks the GS1 check digit', () => {
    expect(validCheckDigit('3017620422003')).toBe(true);
    expect(validCheckDigit('3017620422004')).toBe(false);
    expect(validCheckDigit('96385074')).toBe(true); // EAN-8
  });
});
