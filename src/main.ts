import './styles.css';
import { cleanBarcode, lookupProduct, validCheckDigit } from './core/off.ts';
import { reconcile } from './core/reconcile.ts';
import { PACKS, getPack, sortParts } from './core/rules.ts';
import { MATERIAL_LABELS, RESIN_LABELS, SHAPE_LABELS } from './core/taxonomy.ts';
import type { MaterialClass, OffProduct, Part, RulePack, ShapeClass, SortedPart } from './core/types.ts';
import { ICON_CLOSE, ICON_IMAGE, ICON_LINK, ICON_SCAN, shapeIcon } from './ui/icons.ts';
import { play, snapshot } from './ui/flip.ts';
import { prefs, productCache } from './ui/storage.ts';
import summary from '../data/eval/summary.json' with { type: 'json' };

// ---------- State ----------

type View = 'start' | 'loading' | 'result' | 'not-found' | 'error';

interface State {
  packId: string;
  view: View;
  code?: string;
  product?: OffProduct;
  parts: Part[];
  notes: string[];
  message?: string;
  /** Two-tap path: which step is open, and the chosen shape. */
  ask?: { step: 'shape' | 'material'; shape?: ShapeClass };
  fromCache?: boolean;
}

const initialPack = (() => {
  const fromUrl = new URLSearchParams(location.search).get('area');
  const id = fromUrl ?? prefs.pack;
  return PACKS.some((p) => p.id === id) ? id! : PACKS[0].id;
})();

const state: State = { packId: initialPack, view: 'start', parts: [], notes: [] };
const pack = (): RulePack => getPack(state.packId);
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Real products with packaging data in Open Food Facts, chosen to show the range of cases.
const SAMPLES: Array<{ code: string; label: string }> = [
  { code: '3017620422003', label: 'Nutella jar' },
  { code: '5449000000996', label: 'Coca-Cola can' },
  { code: '8888196173324', label: 'Green tea bottle' },
  { code: '9300652809770', label: 'Oat milk carton' },
  { code: '8801073113312', label: 'Spicy noodles' },
];

// ---------- Helpers ----------

const esc = (s: string | undefined) =>
  (s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function partTitle(p: Part): string {
  const material = p.material === 'unknown' ? '' : MATERIAL_LABELS[p.material];
  const shape = p.shape === 'unknown' ? 'part' : SHAPE_LABELS[p.shape].toLowerCase();
  const resin = p.resin ? ` (${RESIN_LABELS[p.resin]} ${p.resin})` : '';
  if (!material) return `${SHAPE_LABELS[p.shape]}${p.shape === 'unknown' ? '' : ', material unknown'}`;
  return `${material} ${shape}${resin}`;
}

const BRAND_MARK = `<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="3" width="26" height="26" rx="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 3v26" stroke="#d2462a" stroke-width="2" stroke-dasharray="3 3"/><path d="M8 12h4M8 17h4M20 12h4M20 17h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
const REG_MARK = `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M8 0v16M0 8h16" stroke="currentColor" stroke-width="1.2"/></svg>`;

function binTone(binId: string) {
  return ['paper', 'plastic', 'others', 'residual', 'blue', 'ewaste'].includes(binId) ? binId : 'residual';
}

// ---------- Rendering ----------

const app = document.getElementById('app')!;

function shell() {
  app.innerHTML = `
    <div class="shell">
      <header class="top">
        <a class="brand" href="./" data-home>${BRAND_MARK}<span>BinSplit</span></a>
        <div class="area" role="group" aria-label="Your area's sorting rules">
          ${PACKS.map(
            (p) =>
              `<button type="button" data-pack="${p.id}" aria-pressed="${p.id === state.packId}">${esc(p.region)}<span class="area-long"> (${p.id.startsWith('my') ? 'SWCorp' : 'NEA'})</span></button>`,
          ).join('')}
        </div>
        <button type="button" class="link-btn" data-about>About</button>
      </header>
      <main id="main"></main>
      <footer>
        <p>Product data from <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener">Open Food Facts</a>, available under the Open Database License. Sorting rules from SWCorp Malaysia and NEA Singapore; each answer links to its source.</p>
        <p>Bin colours on this page are for telling bins apart, not official colours.</p>
      </footer>
    </div>
    <div class="dock" id="dock" hidden><button type="button" class="btn btn--primary" data-scan>${ICON_SCAN}Scan next</button></div>
    <input type="file" accept="image/*" capture="environment" id="photo" class="visually-hidden" tabindex="-1" />
    <dialog id="sheet" aria-labelledby="sheet-title"></dialog>
    <dialog id="camera" class="camera" aria-label="Scan a barcode with the camera"></dialog>
  `;
}

function lookupForm(id: string, autofocus = false) {
  return `
    <form class="lookup" data-lookup novalidate>
      <label class="visually-hidden" for="${id}">Barcode number</label>
      <input id="${id}" name="code" inputmode="numeric" autocomplete="off" placeholder="Type a barcode number" value="${esc(state.view === 'start' ? '' : state.code)}" ${autofocus ? 'autofocus' : ''} />
      <button class="btn" type="submit">Look up</button>
    </form>`;
}

function renderStart() {
  const main = document.getElementById('main')!;
  main.innerHTML = `
    <section class="start">
      <div>
        <h1><span class="rise" style="--i:0">Every part.</span><span class="rise" style="--i:1">The right bin.</span></h1>
        <p class="lede rise" style="--i:2">Scan a product's barcode. BinSplit splits its packaging into parts and sorts each one under ${esc(pack().region === 'Malaysia' ? 'SWCorp' : 'NEA')} rules, with the official source for every answer.</p>
        <div class="actions rise" style="--i:3">
          <button type="button" class="btn btn--primary" data-scan>${ICON_SCAN}Scan barcode</button>
          <button type="button" class="btn btn--ghost" data-photo>${ICON_IMAGE}Use a photo</button>
        </div>
        <div class="rise" style="--i:4">
          ${lookupForm('code-start')}
          <p class="field-error" id="field-error" role="alert"></p>
          <div class="samples">
            <p class="samples-label">Or try a real product</p>
            <div class="chips">${SAMPLES.map((s) => `<button type="button" class="chip" data-sample="${s.code}">${esc(s.label)}</button>`).join('')}</div>
          </div>
        </div>
      </div>
      ${heroArt()}
    </section>`;
  document.getElementById('dock')!.hidden = true;
}

/** Hero: a rendered jar coming apart above three bins, with what the active rules say. */
function heroArt() {
  const p = pack();
  const caption =
    p.id === 'my-act672'
      ? `<div class="hero-bins">
          <span style="--tone: var(--bin-paper)"><b>Kertas</b>Papers</span>
          <span style="--tone: var(--bin-plastic)"><b>Plastik</b>the lid</span>
          <span style="--tone: var(--bin-others)"><b>Lain-lain</b>the jar and seal</span>
        </div>`
      : `<p class="hero-art-caption">Under NEA rules all three parts go in the blue recycling bin, once clean.</p>`;
  return `
    <figure class="hero-art rise" style="--i:2">
      <span class="reg tl" aria-hidden="true">${REG_MARK}</span><span class="reg br" aria-hidden="true">${REG_MARK}</span>
      <img class="hero-img" src="${heroImg}" width="1600" height="1000" alt="A jar of spread coming apart into its glass jar, aluminium seal and plastic lid, above three recycling bins." />
      <figcaption>${caption}</figcaption>
    </figure>`;
}
const heroImg = new URL('./hero-split.webp', import.meta.url).href;

function productHeader(loading = false) {
  const p = state.product;
  const img = p?.image_front_small_url
    ? `<img src="${esc(p.image_front_small_url)}" alt="" decoding="async" onerror="this.remove()" />`
    : shapeIcon('box');
  // No record: the barcode itself is the title, never an invented product name.
  const name = loading
    ? '<span class="skeleton" style="width: 14ch; height: 1.4em"></span>'
    : p
      ? esc(p.product_name || 'Unnamed product')
      : `<span class="code-title">${esc(state.code)}</span>`;
  const status = !p && !loading ? (state.view === 'not-found' ? 'Not in Open Food Facts' : 'Lookup did not finish') : '';
  return `
    <div class="product ${loading ? 'is-loading' : ''}" id="product">
      <div class="product-img">${loading ? '' : img}</div>
      <div class="product-meta">
        <h2 id="product-name">${name}</h2>
        <div class="product-sub">
          ${p?.brands ? `<span>${esc(p.brands.split(',')[0])}</span>` : ''}
          ${p || loading ? `<span>${esc(state.code)}</span>` : `<span>${status}</span>`}
          ${p ? `<a href="https://world.openfoodfacts.org/product/${esc(state.code)}" target="_blank" rel="noopener">Product data ${ICON_LINK}</a>` : ''}
          ${p && state.fromCache ? '<span>Saved on this device</span>' : ''}
        </div>
        ${loading ? '<p class="product-summary muted">Looking up packaging…</p>' : `<p class="product-summary" id="summary">${summaryLine()}</p>`}
      </div>
    </div>`;
}

function summaryLine(): string {
  const sorted = sortParts(state.parts, pack());
  if (!sorted.length) return state.product ? 'No packaging parts recorded yet.' : '';
  const n = sorted.length;
  const asks = sorted.filter((s) => needsAnswer(s)).length;
  const gaps = sorted.filter((s) => s.verdict.kind === 'gap').length;
  const bits = [`${n} part${n === 1 ? '' : 's'}`];
  if (asks) bits.push(`${asks} need${asks === 1 ? 's' : ''} your answer`);
  if (gaps) bits.push(`${gaps} not covered by ${pack().shortName} rules`);
  return bits.join(' · ');
}

/** A part goes to "Needs your answer" if the engine cannot place it, or its sources conflict. */
function needsAnswer(s: SortedPart): boolean {
  return s.verdict.kind === 'needs-input' || !!s.part.doubt || (!!s.part.alternatives?.length && s.part.confidence === 'low');
}

/** If every rule in the pack shares one preparation step, it is said once below the bins instead of on every piece. */
function pieceLine(pk: RulePack, v: Extract<SortedPart['verdict'], { kind: 'rule' }>): string {
  const firsts = new Set(pk.rules.map((r) => r.prep[0]));
  if (firsts.size > 1) return v.rule.prep[0] ?? '';
  return v.rule.specificity === 'listed' ? `Named in the ${pk.region === 'Malaysia' ? 'SWCorp' : 'NEA'} list` : 'Matched by material';
}

function pieceHtml(s: SortedPart): string {
  const p = s.part;
  const v = s.verdict;
  const tone = v.kind === 'rule' && !needsAnswer(s) ? `var(--bin-${binTone(v.bin.tone)})` : needsAnswer(s) ? 'var(--signal)' : 'var(--ink-3)';
  let prep = '';
  if (needsAnswer(s)) prep = p.doubt ? 'Only one record mentions this part.' : p.alternatives?.length ? 'The product records disagree.' : 'Tell us one thing to sort it.';
  else if (v.kind === 'rule') prep = pieceLine(pack(), v);
  else if (v.kind === 'gap') prep = 'No official rule for this here.';
  const units = p.units && p.units > 1 ? ` ×${p.units}` : '';
  let ask = '';
  if (needsAnswer(s)) {
    if (p.doubt) {
      ask = `<div class="piece-ask"><p>Does this pack really have a ${esc(partTitle(p).toLowerCase())}?</p>
        <div class="chips"><button type="button" class="chip" data-keep="${p.id}">Yes, keep it</button><button type="button" class="chip" data-drop="${p.id}">No, remove it</button></div></div>`;
    } else if (p.alternatives?.length) {
      const mats = [...new Set(p.alternatives.map((a) => a.material))];
      ask = `<div class="piece-ask"><p>Is the ${esc(SHAPE_LABELS[p.shape].toLowerCase())} ${mats.map((m) => esc(MATERIAL_LABELS[m].toLowerCase())).join(' or ')}?</p>
        <div class="chips">${mats.map((m) => `<button type="button" class="chip" data-resolve="${p.id}" data-material="${m}">${esc(MATERIAL_LABELS[m])}</button>`).join('')}</div></div>`;
    } else if (v.kind === 'needs-input') {
      ask = `<div class="piece-ask"><button type="button" class="chip" data-open="${p.id}">Answer ${v.missing.includes('shape') && !v.missing.includes('material') ? 'its shape' : 'its material'}</button></div>`;
    }
  }
  return `
    <article class="piece" data-flip="${p.id}" data-part="${p.id}" style="--tone:${tone}">
      <button type="button" class="piece-main" data-open="${p.id}" aria-label="${esc(partTitle(p))}: details">
        <span class="piece-icon">${shapeIcon(p.shape)}</span>
        <span><span class="piece-title">${esc(partTitle(p))}${units}</span><br><span class="piece-prep">${esc(prep)}</span></span>
        <span class="conf conf--${p.confidence}" title="${p.confidence} confidence"></span>
      </button>
      ${ask}
    </article>`;
}

/** Render bins with every sorted piece in its bin. */
function binsHtml(sorted: SortedPart[]): string {
  const pk = pack();
  const cols: Array<{ id: string; cls: string; name: string; local?: string; note?: string; items: SortedPart[] }> = [];
  const needs = sorted.filter(needsAnswer);
  if (needs.length) cols.push({ id: 'needs', cls: 'bin--needs', name: 'Needs your answer', note: 'One tap and it drops into its bin.', items: needs });
  for (const b of pk.bins) {
    cols.push({
      id: b.id,
      cls: `bin--${binTone(b.tone)}`,
      name: b.name,
      local: b.localName,
      items: sorted.filter((s) => !needsAnswer(s) && s.verdict.kind === 'rule' && s.verdict.bin.id === b.id),
    });
  }
  const gaps = sorted.filter((s) => !needsAnswer(s) && s.verdict.kind === 'gap');
  if (gaps.length) cols.push({ id: 'gap', cls: 'bin--gap', name: 'Not covered here', note: `${pk.shortName} sources give no rule. Ask your collector.`, items: gaps });

  return `
    <div class="bins-head">
      <h3>Where each part goes</h3>
      <p class="legend"><span><i class="conf conf--high"></i>Records agree</span><span><i class="conf conf--medium"></i>One record</span><span><i class="conf conf--low"></i>Check it</span></p>
    </div>
    <div class="bins" id="bins">
      ${cols
        .map(
          (c) => `
        <div class="bin ${c.cls}" data-bin="${c.id}" data-empty="${c.items.length === 0}">
          <div class="bin-head"><span class="swatch"></span><span class="bin-label"><span class="bin-name">${esc(c.name)}</span>${c.local ? `<span class="bin-local">${esc(c.local)}</span>` : ''}</span><span class="bin-count">${c.items.length}</span></div>
          ${c.note ? `<p class="bin-note">${esc(c.note)}</p>` : ''}
          <div class="slot">${c.items.map(pieceHtml).join('')}</div>
        </div>`,
        )
        .join('')}
    </div>`;
}

function notesHtml(): string {
  const pk = pack();
  const general = pk.generalRules
    .map((g) => {
      const src = pk.sources.find((s) => s.id === g.source)!;
      return `<p class="note"><strong>${esc(g.text)}</strong> <a href="${esc(src.url)}" target="_blank" rel="noopener">${esc(src.publisher)}</a>, ${esc(g.ref)}.</p>`;
    })
    .join('');
  const notes = state.notes.map((n) => `<p class="note">${esc(n)}</p>`).join('');
  return `<div class="notes">${general}${notes}
    <p class="note"><button type="button" class="link-btn" style="padding:0" data-add-part>Add a part the record is missing</button></p></div>`;
}

function askPanel(): string {
  if (!state.ask) return '';
  if (state.ask.step === 'shape') {
    const shapes: ShapeClass[] = ['bottle', 'jar', 'can', 'brick', 'box', 'pot', 'tray', 'cup', 'cap', 'bag', 'film', 'sachet', 'label', 'seal'];
    return `<div class="panel fade" id="ask">
      <h3>What shape is the part?</h3>
      <p>Pick the closest. Then its material, and it is sorted with the same rules.</p>
      <div class="tiles">${shapes.map((s) => `<button type="button" class="tile" data-ask-shape="${s}">${shapeIcon(s)}${esc(SHAPE_LABELS[s])}</button>`).join('')}</div>
      <div class="panel-foot"><button type="button" class="link-btn" data-ask-cancel>Cancel</button></div>
    </div>`;
  }
  const mats: Array<{ m: MaterialClass; hint: string }> = [
    { m: 'plastic', hint: 'Resin code 1 to 7 in a triangle' },
    { m: 'glass', hint: 'Hard, clear or coloured' },
    { m: 'aluminium', hint: 'Light metal, crushes easily' },
    { m: 'steel', hint: 'Heavier metal, a magnet sticks' },
    { m: 'cardboard', hint: 'Boxes and sleeves' },
    { m: 'paper', hint: 'Bags, labels, wraps' },
    { m: 'beverage-carton', hint: 'Juice or milk carton' },
    { m: 'plastic-metal-laminate', hint: 'Shiny inside, like crisp packets' },
    { m: 'plastic-foam', hint: 'Light white foam trays' },
  ];
  return `<div class="panel fade" id="ask">
    <h3>What is the ${esc(SHAPE_LABELS[state.ask.shape!].toLowerCase())} made of?</h3>
    <p>Check for a material mark or a recycling triangle on the part itself.</p>
    <div class="tiles">${mats.map((x) => `<button type="button" class="tile" data-ask-material="${x.m}">${esc(MATERIAL_LABELS[x.m])}<small>${esc(x.hint)}</small></button>`).join('')}</div>
    <div class="panel-foot"><button type="button" class="link-btn" data-ask-back>Back</button></div>
  </div>`;
}

function renderResultFrame(loading: boolean) {
  const main = document.getElementById('main')!;
  main.innerHTML = `
    <div class="searchbar">${lookupForm('code-result')}
      <button type="button" class="btn btn--primary" data-scan style="min-height:48px">${ICON_SCAN}Scan next</button>
    </div>
    <p class="field-error" id="field-error" role="alert"></p>
    <section class="stage" id="stage" aria-live="polite">
      ${productHeader(loading)}
      <div id="stage-body"></div>
    </section>`;
  document.getElementById('dock')!.hidden = false;
}

/** Re-render the bins and notes, animating every piece from where it was. */
function renderStageBody(opts: { flip?: boolean; newBins?: boolean } = {}) {
  const body = document.getElementById('stage-body');
  if (!body) return;
  const before = opts.flip ? snapshot(document.getElementById('stage')!) : new Map<string, DOMRect>();
  const sorted = sortParts(state.parts, pack());
  const empty = state.parts.length === 0;
  body.innerHTML = empty
    ? `${state.ask ? '' : noDataPanel()}${askPanel()}`
    : `${binsHtml(sorted)}${askPanel()}${notesHtml()}`;
  const summaryEl = document.getElementById('summary');
  if (summaryEl) summaryEl.textContent = summaryLine();
  // Another area's bins: their names cross-fade in while the pieces travel.
  if (opts.newBins) document.getElementById('bins')?.classList.add('bins--new');
  if (opts.flip) {
    play(document.getElementById('stage')!, before, { stagger: 70 });
    pulseBins(before);
  }
}

function noDataPanel(): string {
  const title =
    state.view === 'not-found'
      ? 'This barcode is not in Open Food Facts yet.'
      : state.view === 'error'
        ? esc(state.message ?? 'The lookup failed.')
        : 'No packaging details recorded for this product yet.';
  return `<div class="panel fade">
    <h3>${title}</h3>
    <p>You can still sort it. Describe each part in two taps: its shape, then its material.</p>
    <div class="panel-foot"><button type="button" class="btn btn--primary" data-add-part>Describe a part</button>
    ${state.view === 'not-found' ? '<button type="button" class="link-btn" data-retype>Check the number</button>' : ''}</div>
  </div>`;
}

/** Bins that received a piece give a small catch on their head when it lands. */
function pulseBins(before: Map<string, DOMRect>, duration = 520, stagger = 70) {
  if (reduceMotion()) return;
  const token = splitToken;
  const all = [...document.querySelectorAll<HTMLElement>('#stage [data-flip]')];
  document.querySelectorAll<HTMLElement>('.bin').forEach((bin) => {
    const pieces = [...bin.querySelectorAll<HTMLElement>('[data-flip]')];
    const arrived = pieces.filter((p) => {
      const prev = before.get(p.dataset.flip!);
      if (!prev) return false;
      const now = p.getBoundingClientRect();
      return Math.abs(prev.top - now.top) > 4 || Math.abs(prev.left - now.left) > 4;
    });
    if (!arrived.length) return;
    const order = Math.max(...arrived.map((p) => all.indexOf(p)), 0);
    setTimeout(() => token === splitToken && catchBin(bin), duration + order * stagger);
  });
}

/** The bin's swatch and count give a small catch when a piece lands; the count can tick up. */
function catchBin(bin: HTMLElement, count?: number) {
  const head = bin.querySelector<HTMLElement>('.bin-head');
  const countEl = bin.querySelector<HTMLElement>('.bin-count');
  if (count !== undefined && countEl) countEl.textContent = String(count);
  bin.dataset.waiting = 'false';
  if (reduceMotion()) return;
  head?.animate([{ transform: 'none' }, { transform: 'translateY(2px)' }, { transform: 'none' }], { duration: 260, easing: EASE_OUT });
  countEl?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.25)' }, { transform: 'scale(1)' }], { duration: 300, easing: EASE_OUT });
}

/** Wait until the product image can be shown, so the parts are cut from a real picture. */
async function productImageReady(maxMs = 600) {
  const img = document.querySelector<HTMLImageElement>('#product .product-img img');
  if (!img || img.complete) return;
  await Promise.race([img.decode().catch(() => undefined), wait(maxMs)]);
}

/**
 * Where each piece sits while it is held over the product card: a row when the
 * pieces fit at a readable size, otherwise a fanned hand (phones).
 */
function fanSlots(rects: DOMRect[], heights: number[], card: DOMRect) {
  const pad = 24;
  const gap = 12;
  const avail = card.width - pad * 2;
  const total = rects.reduce((a, r) => a + r.width, 0) + gap * (rects.length - 1);
  const cy = card.top + card.height / 2;
  const rowScale = Math.min(1, avail / total);
  if (rowScale >= 0.62) {
    let x = card.left + card.width / 2 - (total * rowScale) / 2;
    return rects.map((r, i) => {
      const slot = { cx: x + (r.width * rowScale) / 2, cy: cy + ((r.height - heights[i]) * rowScale) / 2, scale: rowScale, rot: 0 };
      x += (r.width + gap) * rowScale;
      return slot;
    });
  }
  // Phones: a spread deck over the card, each piece's title row showing under the next.
  const scale = Math.min(0.86, (card.width - 32) / Math.max(...rects.map((r) => r.width)));
  const n = rects.length;
  const tallest = Math.max(...heights) * scale;
  // The deck may hang a little below the card, into the gap above the bins.
  const room = card.height + 56;
  const step = n === 1 ? 0 : Math.max(12, Math.min(tallest * 0.7, (room - 24 - tallest) / (n - 1)));
  const top = cy + 28 - (tallest + step * (n - 1)) / 2;
  return rects.map((r, i) => ({
    cx: card.left + card.width / 2 + (i % 2 ? 6 : -6),
    cy: top + i * step + (heights[i] * scale) / 2 + ((r.height - heights[i]) * scale) / 2,
    scale,
    rot: i % 2 ? 1.5 : -1.5,
  }));
}

const EASE_OUT = 'cubic-bezier(.23,1,.32,1)';

/**
 * The signature moment, with no layout shift: every piece is rendered straight into
 * its bin, then moved with transforms. It is cut out of the product image, held in a
 * fan over the product card, then each arcs into its bin; the bin counts tick as they land.
 */
async function splitIntoBins() {
  const sorted = sortParts(state.parts, pack());
  const body = document.getElementById('stage-body')!;
  const token = ++splitToken;
  if (reduceMotion() || sorted.length === 0) {
    renderStageBody();
    body.classList.add('fade');
    return;
  }
  await productImageReady();
  if (token !== splitToken) return; // user moved on
  renderStageBody();
  const stage = document.getElementById('stage')!;
  const product = document.getElementById('product')!;
  const card = product.getBoundingClientRect();
  const origin = product.querySelector('.product-img')!.getBoundingClientRect();
  const pieces = [...stage.querySelectorAll<HTMLElement>('#bins [data-flip]')];
  const rects = pieces.map((p) => p.getBoundingClientRect());
  // While held, a piece shows only its main row; a question below it unfolds on landing.
  const mains = pieces.map((p) => p.querySelector<HTMLElement>('.piece-main')!.offsetHeight);
  const slots = fanSlots(rects, mains, card);

  const bins = [...stage.querySelectorAll<HTMLElement>('#bins .bin')];
  const landed = new Map<HTMLElement, number>();
  bins.forEach((b) => {
    if (b.querySelector('[data-flip]')) {
      b.dataset.waiting = 'true';
      b.querySelector('.bin-count')!.textContent = '0';
    }
  });

  const n = pieces.length;
  const CUT = 420;
  const CUT_STAGGER = 70;
  const HOLD = 320;
  const ARC = 620;
  const ARC_STAGGER = 90;
  const holdEnd = CUT + (n - 1) * CUT_STAGGER + HOLD;
  const end = holdEnd + (n - 1) * ARC_STAGGER + ARC;
  const ox = origin.left + origin.width / 2;
  const oy = origin.top + origin.height / 2;

  pieces.forEach((el, i) => {
    const r = rects[i];
    const s = slots[i];
    const fx = r.left + r.width / 2;
    const fy = r.top + r.height / 2;
    const hidden = r.height - mains[i];
    const d = holdEnd + i * ARC_STAGGER + ARC;
    const at = (ms: number) => Math.min(1, ms / d);
    const fanT = `translate(${s.cx - fx}px, ${s.cy - fy}px) rotate(${s.rot}deg) scale(${s.scale})`;
    const midX = (s.cx - fx) / 2;
    const midY = (s.cy - fy) / 2 - Math.min(64, 24 + Math.hypot(s.cx - fx, s.cy - fy) * 0.08);
    const cutClip = `inset(${r.height * 0.3}px ${r.width * 0.3}px ${hidden + mains[i] * 0.3}px ${r.width * 0.3}px round 14px)`;
    const heldClip = `inset(0px 0px ${hidden}px 0px round 14px)`;
    el.classList.add('is-flying');
    const anim = el.animate(
      [
        { offset: 0, opacity: 0, transform: `translate(${ox - fx}px, ${oy - fy}px) scale(.38)`, clipPath: cutClip },
        { offset: at(i * CUT_STAGGER), opacity: 0, transform: `translate(${ox - fx}px, ${oy - fy}px) scale(.38)`, clipPath: cutClip, easing: EASE_OUT },
        { offset: at(i * CUT_STAGGER + CUT), opacity: 1, transform: fanT, clipPath: heldClip },
        { offset: at(holdEnd + i * ARC_STAGGER), opacity: 1, transform: fanT, clipPath: heldClip, easing: 'cubic-bezier(.25,.6,.35,1)' },
        { offset: at(holdEnd + i * ARC_STAGGER + ARC * 0.5), opacity: 1, transform: `translate(${midX}px, ${midY}px) rotate(0deg) scale(1.03)`, clipPath: heldClip, easing: 'cubic-bezier(.5,0,.3,1)' },
        { offset: 1, opacity: 1, transform: 'translate(0px, 0px) rotate(0deg) scale(1)', clipPath: `inset(0px 0px 0px 0px round 14px)` },
      ],
      { duration: d, fill: 'backwards' },
    );
    anim.finished.then(
      () => {
        el.classList.remove('is-flying');
        if (token !== splitToken) return;
        const bin = el.closest<HTMLElement>('.bin');
        if (!bin) return;
        const c = (landed.get(bin) ?? 0) + 1;
        landed.set(bin, c);
        catchBin(bin, c);
      },
      () => el.classList.remove('is-flying'),
    );
  });

  // The product image presses in as its parts leave; its name steps back while they are held.
  const meta = product.querySelector<HTMLElement>('.product-meta');
  const img = product.querySelector<HTMLElement>('.product-img');
  splitAnims = [
    meta?.animate(
      [{ opacity: 1 }, { opacity: 0.18, offset: CUT / end }, { opacity: 0.18, offset: holdEnd / end }, { opacity: 1, offset: (holdEnd + ARC) / end }, { opacity: 1 }],
      { duration: end, easing: 'ease' },
    ),
    img?.animate([{ transform: 'scale(1)' }, { transform: 'scale(.92)', offset: 0.12 }, { transform: 'scale(1)', offset: 0.4 }, { transform: 'scale(1)' }], {
      duration: end,
      easing: EASE_OUT,
    }),
  ].filter((a): a is Animation => !!a);
}
let splitToken = 0;
let splitAnims: Animation[] = [];
/** Stop a split in progress (the user moved on); pieces keep their final place. */
function cancelSplit() {
  splitToken++;
  splitAnims.forEach((a) => a.cancel());
  splitAnims = [];
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- Part detail sheet ----------

function openSheet(partId: string) {
  const part = state.parts.find((p) => p.id === partId);
  if (!part) return;
  const pk = pack();
  const [s] = sortParts([part], pk);
  const v = s.verdict;
  let answer = '';
  if (v.kind === 'rule') {
    answer = `<div class="answer" style="--tone: var(--bin-${binTone(v.bin.tone)})"><span class="swatch"></span><h2 id="sheet-title">${esc(v.bin.name)}${v.bin.localName ? ` · ${esc(v.bin.localName)}` : ''}</h2></div>`;
  } else if (v.kind === 'gap') {
    answer = `<div class="answer"><span class="swatch" style="background:transparent;border:1.5px dashed var(--ink-3)"></span><h2 id="sheet-title">Not covered here</h2></div>`;
  } else {
    answer = `<div class="answer" style="--tone: var(--signal)"><span class="swatch"></span><h2 id="sheet-title">Needs your answer</h2></div>`;
  }
  const src = v.kind === 'rule' ? pk.sources.find((x) => x.id === v.rule.source) : v.kind === 'gap' && v.source ? pk.sources.find((x) => x.id === v.source) : undefined;
  const conflict = part.alternatives?.length && part.confidence === 'low';
  const evidence = part.evidence
    .map((e) => `<li><span class="muted">${esc(EVIDENCE_LABELS[e.source])}</span><code>${esc(e.raw)}</code></li>`)
    .join('');
  const shapes = Object.keys(SHAPE_LABELS) as ShapeClass[];
  const mats = Object.keys(MATERIAL_LABELS) as MaterialClass[];
  const dlg = document.getElementById('sheet') as HTMLDialogElement;
  dlg.innerHTML = `
    <div class="sheet">
      <button type="button" class="sheet-close" data-close aria-label="Close">${ICON_CLOSE}</button>
      ${answer}
      <p class="sheet-part">${esc(partTitle(part))}${part.units && part.units > 1 ? ` ×${part.units}` : ''}</p>
      ${
        v.kind === 'rule'
          ? `<section><h4>What to do</h4><ol class="steps">${v.rule.prep.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></section>
             <section><h4>The rule</h4><p class="quote">“${esc(v.rule.sourceItem)}”</p>
             <p class="source">${v.rule.specificity === 'listed' ? 'Named in the source.' : 'Matched by material: the source lists this material category, not this exact item.'}
             <a href="${esc(src!.url)}" target="_blank" rel="noopener">${esc(src!.publisher)} ${ICON_LINK}</a>, ${esc(v.rule.ref)}. Fetched ${esc(src!.fetched)}.</p></section>`
          : v.kind === 'gap'
            ? `<section><h4>Why there is no answer</h4><p>${esc(v.reason)}</p><p class="source">BinSplit only gives bins that an official source states. Ask your waste collector about this part.</p>${src ? `<p class="source">Checked against <a href="${esc(src.url)}" target="_blank" rel="noopener">${esc(src.publisher)} ${ICON_LINK}</a>, ${esc(src.title)}. Fetched ${esc(src.fetched)}.</p>` : ''}</section>`
            : `<section><h4>What we need</h4><p>The record does not say the ${esc(v.missing.join(' or '))} of this part. Set it below and it is sorted at once.</p></section>`
      }
      ${conflict ? `<section><h4>The records disagree</h4><div class="chips">${[...new Set(part.alternatives!.map((a) => a.material))].map((m) => `<button type="button" class="chip" data-resolve="${part.id}" data-material="${m}">It is ${esc(MATERIAL_LABELS[m].toLowerCase())}</button>`).join('')}</div></section>` : ''}
      ${part.doubt ? `<section><h4>Only one record mentions it</h4><div class="chips"><button type="button" class="chip" data-keep="${part.id}">Yes, it is there</button><button type="button" class="chip" data-drop="${part.id}">No, remove it</button></div></section>` : ''}
      <section><h4>Confidence: ${part.confidence}</h4>${part.reasons.map((r) => `<p class="muted">${esc(r)}</p>`).join('')}</section>
      <section><h4>From the product data</h4><ul class="evidence">${evidence}</ul></section>
      <section><h4>Not right? Correct it</h4>
        <div class="edit-row">
          <label class="visually-hidden" for="edit-shape">Shape</label>
          <select id="edit-shape" data-edit-shape="${part.id}">${shapes.map((x) => `<option value="${x}" ${x === part.shape ? 'selected' : ''}>${esc(SHAPE_LABELS[x])}</option>`).join('')}</select>
          <label class="visually-hidden" for="edit-material">Material</label>
          <select id="edit-material" data-edit-material="${part.id}">${mats.map((x) => `<option value="${x}" ${x === part.material ? 'selected' : ''}>${esc(MATERIAL_LABELS[x])}</option>`).join('')}</select>
        </div>
      </section>
    </div>`;
  dlg.classList.remove('closing');
  if (!dlg.open) dlg.showModal();
}

const EVIDENCE_LABELS = {
  packagings: 'Packaging list',
  packaging_text: 'Packaging text',
  packaging_tags: 'Packaging tags',
  shape_material_tags: 'Shape/material tags',
  user: 'You',
} as const;

function closeDialog(dlg: HTMLDialogElement) {
  if (!dlg.open) return;
  if (reduceMotion()) return dlg.close();
  dlg.classList.add('closing');
  setTimeout(() => {
    dlg.classList.remove('closing');
    dlg.close();
  }, 170);
}

// ---------- About ----------

function openAbout() {
  const dlg = document.getElementById('sheet') as HTMLDialogElement;
  const my = summary.packs['my-act672'];
  const sg = summary.packs['sg-nea'];
  dlg.innerHTML = `
    <div class="sheet">
      <button type="button" class="sheet-close" data-close aria-label="Close">${ICON_CLOSE}</button>
      <h2 id="sheet-title" style="font-size: var(--t28)">How well it covers real products</h2>
      <section>
        <p class="big-figure">${Math.round(((my.full + my.partial) / summary.withPackagingData) * 100)}%</p>
        <p class="figure-label">of the ${summary.withPackagingData} real products that have packaging data got a bin for at least one part under the Malaysia rules, and ${Math.round((my.full / summary.withPackagingData) * 100)}% got every part sorted with medium or high confidence. The other ${summary.total - summary.withPackagingData} of the ${summary.total} barcodes tested have no packaging data in Open Food Facts yet. Fetched live ${esc(summary.fetchedTo.slice(0, 10))}.</p>
      </section>
      <section>
        <table class="cov-table">
          <thead><tr><th>Rules</th><th>Every part</th><th>Some parts</th><th>None</th></tr></thead>
          <tbody>
            ${[my, sg].map((p) => `<tr><td>${esc(p.name)}</td><td>${p.fullPct}%</td><td>${p.partialPct}%</td><td>${p.nonePct}%</td></tr>`).join('')}
          </tbody>
        </table>
        <p class="muted" style="margin-top: var(--s3)">${esc(summary.selection)} ${summary.withPackagingData} of ${summary.total} had any packaging data. Products without data can still be sorted with the two-tap path.</p>
      </section>
      ${PACKS.map(
        (p) => `<section><h4>${esc(p.name)}</h4><p class="muted">${esc(p.scope)}${p.notCovered ? ` ${esc(p.notCovered)}` : ''}</p>
        <ul class="src-list" style="margin-top: var(--s3)">${p.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a><br><span class="muted">${esc(s.publisher)}, fetched ${esc(s.fetched)}</span></li>`).join('')}</ul></section>`,
      ).join('')}
      <section><h4>Data</h4><p class="muted">Product and packaging data: Open Food Facts contributors, Open Database License. Packaging shapes and materials are normalised with the Open Food Facts packaging taxonomies. Lookups are saved on this device so repeat scans work offline.</p></section>
    </div>`;
  dlg.classList.remove('closing');
  if (!dlg.open) dlg.showModal();
}

// ---------- Actions ----------

function setPack(id: string) {
  if (id === state.packId) return;
  state.packId = id;
  prefs.pack = id;
  syncUrl();
  document.querySelectorAll<HTMLButtonElement>('[data-pack]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.pack === id)));
  if (state.view === 'start') renderStart();
  else {
    cancelSplit();
    renderStageBody({ flip: true, newBins: true });
  }
  const dlg = document.getElementById('sheet') as HTMLDialogElement;
  if (dlg.open) closeDialog(dlg);
}

function syncUrl() {
  const u = new URL(location.href);
  if (state.code && state.view !== 'start') u.searchParams.set('code', state.code);
  else u.searchParams.delete('code');
  u.searchParams.set('area', state.packId);
  history.replaceState(null, '', u);
}

async function lookup(raw: string) {
  const err = document.getElementById('field-error');
  const code = cleanBarcode(raw);
  if (!code) {
    if (err) err.textContent = 'A barcode has 8, 12, 13 or 14 digits.';
    return;
  }
  if (!validCheckDigit(code) && err) {
    err.textContent = '';
  }
  state.code = code;
  state.product = undefined;
  state.fromCache = false;
  state.parts = [];
  state.notes = [];
  state.ask = undefined;
  state.view = 'loading';
  cancelSplit();
  renderResultFrame(true);
  syncUrl();
  const result = await lookupProduct(code, { cache: productCache });
  if (state.code !== code) return;
  if (result.status === 'found') {
    state.product = result.product;
    state.fromCache = result.fromCache;
    const rec = reconcile(result.product);
    state.parts = rec.parts;
    state.notes = rec.notes;
    state.view = 'result';
  } else if (result.status === 'not-found') {
    state.view = 'not-found';
    if (!validCheckDigit(code)) state.notes = ['The last digit does not match the rest, so the number may have a typo.'];
  } else {
    state.view = 'error';
    state.message = !navigator.onLine
      ? 'You are offline and this product has not been looked up on this device before.'
      : result.message.includes('429')
        ? 'Open Food Facts is busy right now. Try again in a minute.'
        : 'Open Food Facts did not answer. Try again in a moment.';
  }
  renderResultFrame(false);
  await splitIntoBins();
}

function resolvePart(partId: string, material: MaterialClass) {
  const part = state.parts.find((p) => p.id === partId);
  if (!part) return;
  part.material = material;
  part.confidence = 'high';
  part.alternatives = undefined;
  part.needsInput = false;
  part.reasons = ['You confirmed the material.'];
  part.evidence.push({ source: 'user', raw: MATERIAL_LABELS[material], material });
  const dlg = document.getElementById('sheet') as HTMLDialogElement;
  if (dlg.open) closeDialog(dlg);
  renderStageBody({ flip: true });
}

function keepPart(partId: string) {
  const part = state.parts.find((p) => p.id === partId);
  if (!part) return;
  part.doubt = undefined;
  part.confidence = 'high';
  part.reasons = ['You confirmed this part is there.'];
  part.evidence.push({ source: 'user', raw: 'Part confirmed' });
  const dlg = document.getElementById('sheet') as HTMLDialogElement;
  if (dlg.open) closeDialog(dlg);
  renderStageBody({ flip: true });
}

async function dropPart(partId: string) {
  const el = document.querySelector<HTMLElement>(`[data-part="${partId}"]`);
  if (el && !reduceMotion()) {
    await el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.94)' }], { duration: 180, easing: 'cubic-bezier(.23,1,.32,1)', fill: 'forwards' }).finished;
  }
  state.parts = state.parts.filter((p) => p.id !== partId);
  const dlg = document.getElementById('sheet') as HTMLDialogElement;
  if (dlg.open) closeDialog(dlg);
  renderStageBody({ flip: true });
}

function editPart(partId: string, field: 'shape' | 'material', value: string) {
  const part = state.parts.find((p) => p.id === partId);
  if (!part) return;
  if (field === 'shape') part.shape = value as ShapeClass;
  else {
    part.material = value as MaterialClass;
    part.resin = undefined;
  }
  part.alternatives = undefined;
  part.needsInput = part.material === 'unknown';
  part.confidence = 'high';
  part.reasons = ['You corrected this part.'];
  part.evidence.push({ source: 'user', raw: field === 'shape' ? SHAPE_LABELS[part.shape] : MATERIAL_LABELS[part.material] });
  renderStageBody({ flip: true });
  openSheet(partId);
}

let userPartCount = 0;
function addUserPart(shape: ShapeClass, material: MaterialClass) {
  const part: Part = {
    id: `u${userPartCount++}`,
    shape,
    material,
    confidence: 'high',
    reasons: ['You described this part.'],
    evidence: [{ source: 'user', raw: `${SHAPE_LABELS[shape]}, ${MATERIAL_LABELS[material]}`, shape, material }],
    needsInput: false,
  };
  state.parts.push(part);
  state.notes = state.notes.filter((n) => !n.startsWith('This product has no packaging information'));
  state.ask = undefined;
  renderStageBody({ flip: true });
  document.querySelector(`[data-part="${part.id}"]`)?.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'center' });
}

// ---------- Camera and photo ----------

async function openCamera() {
  const dlg = document.getElementById('camera') as HTMLDialogElement;
  dlg.innerHTML = `<video playsinline muted></video><div class="camera-frame"></div>
    <div class="camera-bar"><p id="camera-status">Point the camera at the barcode.</p><button type="button" class="btn" data-camera-close>Cancel</button></div>`;
  dlg.showModal();
  const { scanFromCamera } = await import('./ui/scanner.ts');
  const video = dlg.querySelector('video')!;
  const scan = scanFromCamera(video);
  cameraStop = scan.stop;
  try {
    const code = await scan.result;
    dlg.close();
    void lookup(code);
  } catch (e) {
    const status = document.getElementById('camera-status');
    if (status && dlg.open)
      status.textContent =
        e instanceof Error && /Permission|NotAllowed/i.test(e.name + e.message)
          ? 'Camera access was blocked. Use a photo or type the number instead.'
          : 'No camera found. Use a photo or type the number instead.';
  }
}
let cameraStop: (() => void) | undefined;

async function handlePhoto(file: File) {
  const err = document.getElementById('field-error');
  if (err) err.textContent = 'Reading the barcode…';
  const { decodeImageFile } = await import('./ui/scanner.ts');
  const code = await decodeImageFile(file);
  if (!code) {
    if (err) err.textContent = 'No barcode found in that photo. Try a sharper, closer shot, or type the number.';
    return;
  }
  if (err) err.textContent = '';
  void lookup(code);
}

// ---------- Events ----------

function bind() {
  document.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>(
      '[data-pack],[data-scan],[data-photo],[data-sample],[data-open],[data-resolve],[data-close],[data-about],[data-home],[data-add-part],[data-ask-shape],[data-ask-material],[data-ask-cancel],[data-ask-back],[data-camera-close],[data-retype],[data-keep],[data-drop]',
    );
    if (!t) {
      const dlg = document.getElementById('sheet') as HTMLDialogElement;
      if (e.target === dlg) closeDialog(dlg); // backdrop click
      return;
    }
    const d = t.dataset;
    if (d.pack) setPack(d.pack);
    else if ('scan' in d) void openCamera();
    else if ('photo' in d) (document.getElementById('photo') as HTMLInputElement).click();
    else if (d.sample) void lookup(d.sample);
    else if (d.resolve) resolvePart(d.resolve, d.material as MaterialClass);
    else if (d.keep) keepPart(d.keep);
    else if (d.drop) void dropPart(d.drop);
    else if (d.open) openSheet(d.open);
    else if ('close' in d) closeDialog(document.getElementById('sheet') as HTMLDialogElement);
    else if ('about' in d) openAbout();
    else if ('home' in d) {
      e.preventDefault();
      state.view = 'start';
      state.code = undefined;
      cancelSplit();
      syncUrl();
      renderStart();
    } else if ('addPart' in d) {
      state.ask = { step: 'shape' };
      renderStageBody();
      document.getElementById('ask')?.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
    } else if (d.askShape) {
      state.ask = { step: 'material', shape: d.askShape as ShapeClass };
      renderStageBody();
    } else if (d.askMaterial) addUserPart(state.ask!.shape!, d.askMaterial as MaterialClass);
    else if ('askCancel' in d) {
      state.ask = undefined;
      renderStageBody();
    } else if ('askBack' in d) {
      state.ask = { step: 'shape' };
      renderStageBody();
    } else if ('cameraClose' in d) {
      cameraStop?.();
      (document.getElementById('camera') as HTMLDialogElement).close();
    } else if ('retype' in d) {
      const input = document.querySelector<HTMLInputElement>('[data-lookup] input');
      input?.focus();
      input?.select();
    }
  });
  document.addEventListener('submit', (e) => {
    const form = (e.target as HTMLElement).closest('[data-lookup]');
    if (!form) return;
    e.preventDefault();
    void lookup((form.querySelector('input') as HTMLInputElement).value);
  });
  document.addEventListener('change', (e) => {
    const t = e.target as HTMLElement;
    if (t.id === 'photo') {
      const input = t as HTMLInputElement;
      if (input.files?.[0]) void handlePhoto(input.files[0]);
      input.value = '';
    } else if (t.dataset.editShape) editPart(t.dataset.editShape, 'shape', (t as HTMLSelectElement).value);
    else if (t.dataset.editMaterial) editPart(t.dataset.editMaterial, 'material', (t as HTMLSelectElement).value);
  });
  (document.getElementById('camera') as HTMLDialogElement).addEventListener('close', () => cameraStop?.());
  // Escape on the sheet: animate the close instead of the instant default.
  document.getElementById('sheet')!.addEventListener('cancel', (e) => {
    e.preventDefault();
    closeDialog(e.target as HTMLDialogElement);
  });
}

// ---------- Boot ----------

shell();
bind();
const startCode = new URLSearchParams(location.search).get('code');
if (startCode) void lookup(startCode);
else renderStart();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker
    .register('./sw.js')
    .then(() => navigator.serviceWorker.ready)
    .then((reg) => {
      const urls = [location.href.split('?')[0], ...performance.getEntriesByType('resource').map((e) => e.name)];
      reg.active?.postMessage({ type: 'precache', urls });
      // The scanner is loaded on demand; fetch it now so the camera and photo work offline too.
      void import('./ui/scanner.ts');
    })
    .catch(() => {
      /* offline support is a bonus, the app works without it */
    });
}
