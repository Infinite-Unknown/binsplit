# BinSplit: design

## World: "Dieline"

A packaging dieline is the flat technical drawing a box or label is cut from: dashed cut lines, fold marks, registration crosses, process-colour swatches on unbleached board. BinSplit is about taking packaging apart, so the interface borrows that language. The product appears on a "board" with a dashed cut line; when it splits, each part is a die-cut piece that drops into its bin. Bins are printed swatches with their local names.

Not a dashboard, not a gradient "eco" app, no leaf icons, no green-everything.

## Theme tokens

Light only. The use scene is a bright kitchen or bin room; a dark theme would be unfinished, so there is none.

| Role | Token | Value |
|---|---|---|
| Board (page) | `--board` | `#F3EFE6` unbleached board |
| Sheet (raised surface) | `--sheet` | `#FBF9F4` |
| Ink (text, strokes) | `--ink` | `#17201C` |
| Ink soft (secondary text) | `--ink-2` | `#4C5650` (7.1:1 on board) |
| Ink faint (hints, rules) | `--ink-3` | `#6F7872` (4.6:1 on board) |
| Cut line | `--cut` | `#17201C` at 35%, dashed 6/5 |
| Accent / primary action | `--signal` | `#D2462A` press red (registration-mark red) |
| Bin: paper / Kertas | `--bin-paper` | `#2A5C9E` |
| Bin: plastic / Plastik | `--bin-plastic` | `#D9951E` |
| Bin: others / Lain-lain | `--bin-others` | `#2F7A58` |
| Bin: residual / general | `--bin-residual` | `#3B403D` |
| Bin: blue bin (SG) | `--bin-blue` | `#1E62C8` |
| Bin: e-waste | `--bin-ewaste` | `#6E4BAE` |
| Confidence high / medium / low | `--ok`, `--warn`, `--signal` | `#2F7A58`, `#B7791F`, `#D2462A` |

Bin colours are BinSplit's own swatches for telling bins apart on screen. They are not official bin colours, and the About screen says so.

## Type

- Display: **Bricolage Grotesque** (variable, self-hosted via Fontsource). Weight 700-800, tracking -0.03em. Headlines, product name, bin names.
- Text: **Instrument Sans** (variable, self-hosted). 400 / 500 / 600. Everything else.
- Numerals: tabular figures for barcodes and counts.
- Scale (px): 12, 14, 16, 18, 22, 28, 40, 56. Display clamps 40 to 56 on the first screen.
- Body measure max 62ch.

## Spacing, radius, depth

- Spacing scale (px): 4, 8, 12, 16, 24, 32, 48, 64, 96. Tokens `--s1` to `--s9`. Nothing else is used.
- Gutter: 16 px at 375 px wide, 32 px from 768 px. Content max width 1080 px.
- Radius: 8 (chips, inputs), 14 (cards, pieces), 22 (stage).
- Depth: one paper-lift shadow, `0 1px 0 rgb(23 32 28 / .06), 0 10px 24px -14px rgb(23 32 28 / .35)`. Pieces being moved get a stronger lift.

## Screens: hero and primary action

1. **Start (empty).** Hero: the headline "Every part. The right bin." with the dieline board drawing a sample product splitting (static illustration made of the same piece components). Primary action: **Scan barcode** (press-red button). Secondary, quieter: type a barcode, use a photo, sample products, area switch.
2. **Result.** Hero: the stage, the product on its board, then its parts sitting in their bins. Primary action: **Scan next** (sticky at the bottom on phones). Secondary: area switch, part details.
3. **Part detail (sheet).** Hero: the bin answer for that part. Then preparation steps, the rule, and the official source link; the evidence from the product data below, quieter.
4. **Two-tap path (no data).** Hero: the question ("What shape is it?"), big tappable shape tiles; then material tiles. Primary action: the tile itself.
5. **About.** Hero: the measured coverage figure. Then sources and method.

## Motion plan

Easing tokens: `--ease-out: cubic-bezier(.23, 1, .32, 1)`, `--ease-move: cubic-bezier(.65, 0, .35, 1)`. Transform, opacity and clip-path only.

| What | How | Duration |
|---|---|---|
| First load | headline lines and the start card rise 8 px + fade, staggered 60 ms | 320 ms |
| Button press | scale .97 | 120 ms |
| Hover (pointer devices only) | piece lifts 2 px, shadow deepens | 160 ms |
| Loading (lookup) | the board's cut line marches (dash offset), product name skeleton | until done |
| Loading to result | board crossfades in, no layout jump (reserved height) | 240 ms |
| **Signature: the split** | the product tile is cut along its dashed line: each part piece is revealed out of the product tile (clip-path from the tile's box, scale .92 to 1), the pieces fan out in a row, hold 250 ms, then each arcs into its bin (FLIP, translate with a lifted midpoint), staggered 70 ms. The bin swatch gives a 1.04 "catch" pulse as its piece lands and its count ticks. | 380 ms split + 560 ms per arc |
| Area switch | the same pieces arc from their old bin to the new one (FLIP); bins that change name cross-fade | 520 ms |
| Answer a question | the asked piece arcs from "Needs your answer" into its bin | 520 ms |
| Sheet open / close | rises from the bottom 24 px + fade; close faster | 260 / 180 ms |
| Errors / not found | message fades in, no shake | 200 ms |

Reduced motion: no movement. Pieces appear in their bins with a 150 ms opacity fade; the cut line does not march; the sheet fades only.

## Icons

One authored line set (24 px grid, 1.6 stroke, round caps) for packaging shapes, drawn in `src/ui/icons.ts`. No emoji, no icon fonts.

## Browser surfaces

Selection colour is press red at 20%; focus ring 2 px ink with 2 px board offset; caret press red; scrollbar thin, ink at 30%.
