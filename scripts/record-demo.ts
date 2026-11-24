// Records the demo footage from the real running app, then hands it to the
// renderer (scripts/video/render.ts), which adds the camera moves, callouts,
// cursor, captions, title cards and voice-over and writes assets/demo.mp4.
//
// What this script does:
//   1. Makes the voice-over with a local text-to-speech script (voice af_heart), one
//      short phrase at a time, so a callout can start exactly when its element is named.
//   2. Drives the app in Chromium at 1600x900, device scale 2, and captures 3200x1800
//      frames with their timestamps. A 2x screenshot takes ~50 ms, so the page runs in
//      slow motion while it is filmed: the document timeline (every CSS and Web Animation)
//      plays at 1/K speed and page timers wait K times longer. Every time logged here is
//      in that slowed-down clock, so the finished video plays at the app's real speed.
//   3. Logs, against the same clock: cursor moves and clicks, camera targets, and for each
//      phrase the element it names (its bounding box read from the page at that moment).
//      While the parts are held over the product, their boxes are sampled every frame and
//      the edit holds that real frame while each part is named.
//
//   npm run dev -- --port 5181 --host 127.0.0.1     (in another terminal)
//   TTS_PYTHON=/path/to/python TTS_SCRIPT=/path/to/tts.py node scripts/record-demo.ts [baseUrl]
//   (tts.py is called as: tts.py "text" out.wav --voice af_heart)
//   node scripts/video/render.ts
//
// Product lookups: Open Food Facts rate-limits heavy use. Like a user's phone, the app
// keeps every product it has looked up on the device (localStorage). The recording starts
// from those saved lookups (.cache/demo-storage.json, made by an earlier warm-up run),
// so the product header shows "Saved on this device". Product pictures are kept in
// .cache/video/img after the first fetch.

import { chromium, type Locator, type Page } from 'playwright';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] ?? 'http://127.0.0.1:5181/';
const work = join(root, '.cache/video');
const framesDir = join(work, 'frames');
const voDir = join(work, 'vo');
const imgDir = join(work, 'img');
const W = 1600;
const H = 900;
const DSF = 2;
const K = 4; // slow-motion factor while filming
for (const d of [voDir, imgDir]) mkdirSync(d, { recursive: true });

// ---------- Voice-over, phrase by phrase ----------

const VO: Record<string, string> = {
  // hook
  h1: 'Pick a product, like this jar of Nutella.',
  h2: 'Its packaging comes apart, part by part:',
  h3: 'six plastic bottles,',
  h4: 'a plastic lid,',
  h5: 'a glass jar,',
  h6: 'and an aluminium seal.',
  h7: "Each part drops into its bin, under Malaysia's official rules.",
  h8: 'Plastics: one.',
  h9: 'Others: two.',
  h10: 'And one part waits for your answer.',
  // problem card
  p1: "The waste problem is contamination, and it's measured by what's in the bin.",
  p2: 'Clean and Green Singapore reports',
  p3: "that forty percent of the items in recycling bins can't be recycled, because of it.",
  p4: 'Packaging mixes materials,',
  p5: 'and the rules change from place to place.',
  // conflict
  c1: 'One record lists six plastic bottles that the packaging text never mentions.',
  c2: 'So BinSplit asks:',
  c3: 'yes, keep it,',
  c4: 'or no, remove it.',
  c5: 'One tap settles it.',
  c6: 'The glass jar and the aluminium seal go to Others,',
  c7: 'and the plastic lid goes to Plastics.',
  s1: 'Tap a part to see why.',
  s2: "The rule is quoted from S W Corp's leaflet,",
  s3: 'with a link to the official document.',
  // not covered + area switch
  n1: 'Type any barcode into this field.',
  n2: 'Instant noodles.',
  n3: "The foil-lined wrapper has no rule in S W Corp's list,",
  n4: 'so it goes to Not covered here, not a guessed bin.',
  n5: 'The sheet says why,',
  n6: 'and links the official source it checked.',
  w1: 'Now switch the area to Singapore,',
  w2: "and the same parts re-sort, under N E A's rules.",
  w3: 'There, the wrapper is general waste.',
  // two taps
  t1: 'Another barcode.',
  t2: 'This bread has no packaging data yet.',
  t3: 'Describe a part in two taps:',
  t4: 'its shape,',
  t5: 'then its material,',
  t6: 'and the same rules sort it.',
  // how card
  k1: 'Under the hood:',
  k2: 'a barcode,',
  k3: 'Open Food Facts data, normalised with its packaging taxonomy,',
  k4: 'reconciled into parts with a confidence level,',
  k5: 'and matched to rules that each cite an official source.',
  // coverage
  a1: 'The About screen shows what we measured.',
  a2: 'Two hundred and forty of the most-scanned products in Malaysia and Singapore.',
  a3: 'Ninety-five have packaging data.',
  a4: 'Seventy-two of those get at least one part sorted,',
  a5: 'and forty-nine get every part sorted.',
  // measure card
  m1: 'Coverage is our first measure of impact.',
  m2: 'Next, a ten-item sorting quiz, before and after.',
  m3: "Then a pilot that weighs the contamination in one residence block's bins, before and after four weeks.",
  // offline
  o1: 'With the network off, look up the jar again.',
  o2: 'It still works,',
  o3: 'because lookups are saved on this device.',
  // end card
  e1: 'BinSplit. Open data, official rules, and every part in the right bin.',
};

function sh(cmd: string, args: string[]) {
  return execFileSync(cmd, args, { encoding: 'utf8' });
}
const duration = (file: string) =>
  Number(sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).trim());

const voices: Record<string, { file: string; dur: number; text: string }> = {};
for (const [id, text] of Object.entries(VO)) {
  const file = join(voDir, `${createHash('sha1').update('af_heart|' + text).digest('hex').slice(0, 12)}.wav`);
  if (!existsSync(file)) {
    const py = process.env.TTS_PYTHON;
    const tts = process.env.TTS_SCRIPT;
    if (!py || !tts) throw new Error('Set TTS_PYTHON and TTS_SCRIPT to make the voice-over (voice af_heart).');
    sh(py, ['-I', tts, text, file, '--voice', 'af_heart']);
  }
  voices[id] = { file, dur: duration(file), text };
}
console.log(`voice-over: ${Object.keys(VO).length} phrases, ${Object.values(voices).reduce((a, v) => a + v.dur, 0).toFixed(1)} s`);

// ---------- Recording log ----------

type Rect = { x: number; y: number; w: number; h: number };
const events: Array<Record<string, unknown> & { t: number; kind: string }> = [];
// The filmed clock: real time slowed down K times, so it matches the app's own time.
const R0 = Date.now() / 1000;
const vclock = (realMs: number) => R0 + (realMs / 1000 - R0) / K;
const now = () => vclock(Date.now());
const ev = (kind: string, data: Record<string, unknown> = {}) => events.push({ t: now(), kind, ...data });
const realSleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Wait `ms` of filmed time. */
const sleep = (ms: number) => realSleep(ms * K);
const until = async (t: number) => {
  const ms = (t - now()) * 1000;
  if (ms > 0) await sleep(ms);
};
const GAP = 0.18; // between phrases of one sentence
const STOP = 0.4; // after a full stop

/** Start a voice line now; returns the time it ends. */
function say(id: string): number {
  ev('vo', { id });
  return now() + voices[id].dur;
}
const caption = (text: string | null) => ev('caption', { text });
const mark = (clip: string, edge: 'in' | 'out') => ev('mark', { clip, edge });

async function rectOf(loc: Locator): Promise<Rect> {
  const b = await loc.first().boundingBox();
  if (!b) throw new Error(`no box for ${loc}`);
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}
function union(...rs: Rect[]): Rect {
  const x = Math.min(...rs.map((r) => r.x));
  const y = Math.min(...rs.map((r) => r.y));
  return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y };
}
/** The box of a piece of text inside an element (for a number inside a sentence). */
async function textRect(page: Page, sel: string, needle: string): Promise<Rect> {
  const r = await page.evaluate(
    ([sel, needle]) => {
      const root = document.querySelector(sel);
      if (!root) return null;
      const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const i = n.textContent!.indexOf(needle);
        if (i < 0) continue;
        const range = document.createRange();
        range.setStart(n, i);
        range.setEnd(n, i + needle.length);
        const b = range.getBoundingClientRect();
        return { x: b.x, y: b.y, w: b.width, h: b.height };
      }
      return null;
    },
    [sel, needle] as const,
  );
  if (!r) throw new Error(`no text "${needle}" in ${sel}`);
  return r;
}

type Focus = { rect: Rect; sub?: Rect; label?: string; underline?: boolean; pulse?: boolean; below?: boolean };
/** The element being named: spotlight + ring (+ arrow and label, + underline or pulse for numbers). */
function focus(f: Focus | null, at?: { t: number; off: number }) {
  const data = f ? { ...f } : { clear: true };
  if (at) events.push({ t: at.t, off: at.off, kind: 'focus', ...data });
  else ev('focus', data);
}

/**
 * Point the camera at a rectangle of the page (CSS px). The zoom fits the rectangle
 * with some room around it, never more than maxZ. `at` shifts the start of the move.
 */
function cam(target: Rect | 'wide', o: { dur?: number; at?: number; pad?: number; maxZ?: number; z?: number; hold?: { t: number; off: number } } = {}) {
  const dur = o.dur ?? 1.0;
  let data: Record<string, unknown>;
  if (target === 'wide') data = { at: o.at ?? 0, dur, cx: W / 2, cy: H / 2, z: 1, ease: 'cubic' };
  else {
    const pad = o.pad ?? 1.25;
    const z = o.z ?? Math.max(1, Math.min(o.maxZ ?? 2.1, W / (target.w * pad), H / (target.h * pad)));
    data = { at: o.at ?? 0, dur, cx: target.x + target.w / 2, cy: target.y + target.h / 2, z, ease: 'cubic' };
  }
  if (o.hold) events.push({ t: o.hold.t, off: o.hold.off, kind: 'cam', ...data });
  else ev('cam', data);
}

// ---------- Cursor: eased paths with a slight arc; the real mouse follows the same path ----------

let cursor = { x: 700, y: 760 };
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

async function moveTo(page: Page, x: number, y: number, ms?: number) {
  const from = { ...cursor };
  const dist = Math.hypot(x - from.x, y - from.y);
  if (dist < 1) return;
  const total = ms ?? Math.min(1100, Math.max(450, 320 + dist * 0.55));
  const steps = Math.max(6, Math.round(total / 16));
  const nx = -(y - from.y) / (dist || 1);
  const ny = (x - from.x) / (dist || 1);
  const bow = Math.min(60, dist * 0.08);
  const t0 = now();
  for (let i = 1; i <= steps; i++) {
    const p = easeInOut(i / steps);
    const lift = Math.sin(Math.PI * p) * bow;
    const px = from.x + (x - from.x) * p + nx * lift;
    const py = from.y + (y - from.y) * p + ny * lift;
    await page.mouse.move(px, py);
    ev('cursor', { x: px, y: py });
    await until(t0 + (total * i) / steps / 1000);
  }
  cursor = { x, y };
}

async function pointAt(page: Page, loc: Locator, ms?: number, fx = 0.5, fy = 0.5) {
  const r = await rectOf(loc);
  await moveTo(page, r.x + r.w * fx, r.y + r.h * fy, ms);
  return r;
}

async function press(page: Page) {
  await sleep(120);
  ev('click', { x: cursor.x, y: cursor.y });
  await page.mouse.down();
  await sleep(70);
  await page.mouse.up();
}

async function click(page: Page, loc: Locator, opts: { ms?: number; fx?: number; fy?: number } = {}) {
  await pointAt(page, loc, opts.ms, opts.fx, opts.fy);
  await press(page);
}

async function typeInto(page: Page, input: Locator, text: string) {
  await click(page, input, { fx: 0.3 });
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  for (const ch of text) {
    await page.keyboard.type(ch);
    await sleep(38 + Math.random() * 30);
  }
}

// ---------- Browser ----------

const browser = await chromium.launch({ args: ['--use-mock-keychain', '--password-store=basic'] });
const savedCache = join(root, '.cache/demo-storage.json');
if (!existsSync(savedCache)) throw new Error('Missing .cache/demo-storage.json (saved product lookups). Run the app once on each demo product first.');
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: DSF,
  storageState: savedCache,
  reducedMotion: 'no-preference',
});

// Product pictures: fetched once, then served from .cache/video/img.
await ctx.route('https://images.openfoodfacts.org/**', async (route) => {
  const url = route.request().url();
  const file = join(imgDir, createHash('sha1').update(url).digest('hex').slice(0, 16));
  if (existsSync(file)) return route.fulfill({ body: readFileSync(file), contentType: 'image/jpeg' });
  try {
    const res = await route.fetch();
    const body = await res.body();
    if (res.ok()) writeFileSync(file, body);
    return route.fulfill({ response: res, body });
  } catch {
    return route.abort();
  }
});
let apiCalls = 0;
ctx.on('request', (r) => {
  if (/openfoodfacts\.org\/api/.test(r.url())) {
    apiCalls++;
    console.warn('live Open Food Facts lookup (not saved on this device):', r.url());
  }
});

// Slow motion, part 1: page timers wait K times longer, and smooth scrolling is driven
// by the page so it slows down too. Part 2 (the animation timeline) is set below.
await ctx.addInitScript((k: number) => {
  const st = window.setTimeout.bind(window);
  const si = window.setInterval.bind(window);
  (window as any).setTimeout = (fn: TimerHandler, ms = 0, ...a: unknown[]) => st(fn, (Number(ms) || 0) * k, ...a);
  (window as any).setInterval = (fn: TimerHandler, ms = 0, ...a: unknown[]) => si(fn, (Number(ms) || 0) * k, ...a);
  const siv = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (arg?: boolean | ScrollIntoViewOptions) {
    if (!arg || typeof arg !== 'object' || arg.behavior !== 'smooth') return siv.call(this, arg);
    const r = this.getBoundingClientRect();
    const dy = arg.block === 'center' ? r.top + r.height / 2 - innerHeight / 2 : arg.block === 'end' ? r.bottom - innerHeight : r.top;
    const from = scrollY;
    const to = Math.max(0, Math.min(document.documentElement.scrollHeight - innerHeight, from + dy));
    const dur = Math.min(800, Math.max(350, Math.abs(to - from) * 0.8)) * k;
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      window.scrollTo(0, from + (to - from) * e);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
}, K);

const page = await ctx.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));

// Off camera: load every product picture once so it is in the image cache.
await page.goto(base + '?area=my-act672');
await page.evaluate(async () => {
  const urls = Object.keys(localStorage)
    .filter((k) => k.startsWith('binsplit:product:'))
    .map((k) => JSON.parse(localStorage.getItem(k)!)?.image_front_small_url)
    .filter(Boolean) as string[];
  await Promise.all(urls.map((u) => new Promise((r) => { const i = new Image(); i.onload = i.onerror = r; i.src = u; })));
});
await page.goto(base + '?area=my-act672');
await page.getByRole('heading', { name: /Every part/ }).waitFor();
await page.evaluate(() => document.fonts.ready);
await realSleep(900);
await page.mouse.move(cursor.x, cursor.y);

// ---------- Capture: 3200x1800 frames in a loop, identical frames stored once ----------

rmSync(framesDir, { recursive: true, force: true });
mkdirSync(framesDir, { recursive: true });
const cdp = await ctx.newCDPSession(page);
// Slow motion, part 2: every CSS transition, CSS animation and Web Animation plays at 1/K.
await cdp.send('Animation.enable');
await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 / K });
const frames: Array<{ t: number; f: number }> = [];
let stored = 0;
let capturing = true;
const capture = (async () => {
  let last = '';
  while (capturing) {
    const a = Date.now();
    // A clip with scale 2 renders the viewport at device scale 2 (3200x1800), not an upscale.
    const r = await cdp.send('Page.captureScreenshot', {
      format: 'jpeg',
      quality: 94,
      optimizeForSpeed: true,
      clip: { x: 0, y: 0, width: W, height: H, scale: DSF },
    });
    const t = vclock((a + Date.now()) / 2);
    if (r.data !== last) {
      writeFileSync(join(framesDir, `${stored}.jpg`), Buffer.from(r.data, 'base64'));
      stored++;
      last = r.data;
    }
    frames.push({ t, f: stored - 1 });
  }
})();
await sleep(500);

const L = {
  chip: (code: string) => page.locator(`[data-sample="${code}"]`),
  product: page.locator('#product'),
  bins: page.locator('#bins'),
  search: page.locator('[data-lookup] input'),
  sheet: page.locator('#sheet .sheet'),
  bin: (id: string) => page.locator(`.bin[data-bin="${id}"]`),
};
const binFocus = async (id: string, label?: string) => {
  const bin = L.bin(id);
  return { rect: await rectOf(bin), sub: await rectOf(bin.locator('.bin-count')), label, pulse: true } as Focus;
};

// ===== Clip: hook. Parts cut from the product, held (each one named), then into their bins. =====
mark('hook', 'in');
cam('wide', { dur: 0 });
ev('cursor', { x: cursor.x, y: cursor.y });
caption('BinSplit · Every part. The right bin.');
const chip = L.chip('3017620422003');
focus({ rect: await rectOf(chip), label: 'A real product' });
let end = say('h1');
await pointAt(page, chip, 900);
await until(end - 0.15);
// Log every piece's visible box on every frame of the split.
await page.evaluate((k) => {
  const w = window as any;
  w.__split = [];
  const stop = Date.now() + 4000 * k;
  const tick = () => {
    const mains = [...document.querySelectorAll('#bins [data-flip] .piece-main')] as HTMLElement[];
    if (mains.length)
      w.__split.push({
        t: Date.now(),
        r: mains.map((m) => {
          const b = m.getBoundingClientRect();
          return [b.x, b.y, b.width, b.height, Number(getComputedStyle(m.closest('[data-flip]')!).opacity)];
        }),
      });
    if (Date.now() < stop) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}, K);
await press(page);
focus(null);
await L.product.waitFor();
await sleep(60);
cam(await rectOf(L.product), { pad: 1.06, dur: 0.9, at: -0.1 });
await sleep(3000); // the whole split, in filmed time
{
  // The hold: the first run of frames where every piece is fully cut out and not moving.
  const log = (await page.evaluate(() => (window as any).__split)) as Array<{ t: number; r: number[][] }>;
  let best: { i: number; j: number } | null = null;
  for (let i = 1, start = -1; i < log.length; i++) {
    const still = log[i].r.length === log[i - 1].r.length &&
      log[i].r.every((r, k) => r[4] > 0.99 && Math.abs(r[0] - log[i - 1].r[k][0]) < 0.3 && Math.abs(r[1] - log[i - 1].r[k][1]) < 0.3 && Math.abs(r[2] - log[i - 1].r[k][2]) < 0.3);
    if (still && start < 0) start = i - 1;
    if ((!still || i === log.length - 1) && start >= 0) {
      if (i - start >= 3) { best = { i: start, j: i - 1 }; break; }
      start = -1;
    }
  }
  if (!best) throw new Error('could not find the hold in the split');
  const s = log[Math.floor((best.i + best.j) / 2)];
  const tHold = vclock(s.t);
  const parts = s.r.map(([x, y, w, h]) => ({ x, y, w, h }));
  console.log(`hold at +${(tHold - (events.find((e) => e.kind === 'click')!.t)).toFixed(2)} s, ${parts.length} parts`);
  // The edit holds this real frame while the parts are named, then lets the split finish.
  let off = 0.15;
  const at = () => ({ t: tHold, off });
  events.push({ t: tHold, off, kind: 'caption', text: 'Paused mid-split: the parts, cut from the product' });
  cam(union(...parts), { pad: 1.12, dur: 1.0, hold: at() });
  const named: Array<[string, Focus]> = [
    ['h2', { rect: union(...parts) }],
    ['h3', { rect: parts[0] }],
    ['h4', { rect: parts[1] }],
    ['h5', { rect: parts[2] }],
    ['h6', { rect: parts[3] }],
  ];
  for (const [id, f] of named) {
    focus(f, at());
    events.push({ t: tHold, off, kind: 'vo', id });
    off += voices[id].dur + (id === 'h2' ? GAP + 0.1 : GAP);
  }
  off += 0.2;
  focus(null, at());
  events.push({ t: tHold, off, kind: 'caption', text: null });
  cam(union(await rectOf(L.product), await rectOf(L.bins)), { pad: 1.04, dur: 1.1, hold: at() });
  events.push({ t: tHold, kind: 'insert', d: off });
}
focus({ rect: await rectOf(L.bins) });
end = say('h7');
await until(end + GAP);
focus(await binFocus('plastic', '1 part'));
end = say('h8');
await until(end + GAP);
focus(await binFocus('others', '2 parts'));
end = say('h9');
await until(end + GAP);
focus(await binFocus('needs'));
end = say('h10');
await until(end + STOP);
mark('hook', 'out');

// ===== Clip: the conflict question, then a part's rule and source. =====
await sleep(200);
mark('conflict', 'in');
const needs = page.locator('.bin--needs');
cam(await rectOf(needs), { pad: 1.12, dur: 1.0 });
focus({ rect: await rectOf(needs.locator('.piece-main')) });
end = say('c1');
await pointAt(page, needs.locator('.piece-main'), 900, 0.7, 0.5);
await until(end + GAP);
focus({ rect: await rectOf(needs.locator('.piece-ask p')) });
end = say('c2');
await until(end + GAP);
focus({ rect: await rectOf(needs.locator('[data-keep]')) });
end = say('c3');
await pointAt(page, needs.locator('[data-keep]'), 600);
await until(end + GAP);
focus({ rect: await rectOf(needs.locator('[data-drop]')) });
end = say('c4');
await pointAt(page, needs.locator('[data-drop]'), 500);
await until(end + 0.1);
await press(page);
focus(null);
await sleep(750); // the part fades and the others re-sort
cam(union(await rectOf(L.bin('plastic')), await rectOf(L.bin('others'))), { pad: 1.2, dur: 1.0 });
focus({ rect: await rectOf(L.bins) });
end = say('c5');
await until(end + STOP);
focus({ rect: await rectOf(L.bin('others')) });
end = say('c6');
await until(end + GAP);
focus({ rect: await rectOf(L.bin('plastic')) });
end = say('c7');
await until(end + STOP);

const jar = L.bin('others').locator('.piece-main').first();
focus({ rect: await rectOf(jar) });
end = say('s1');
await pointAt(page, jar, 700);
await until(end);
await press(page);
focus(null);
await L.sheet.waitFor();
await sleep(300);
cam(await rectOf(L.sheet), { pad: 1.08, dur: 0.9 });
await sleep(500);
const quote = page.locator('#sheet .quote');
const srcLink = page.locator('#sheet .source a').first();
cam(union(await rectOf(quote), await rectOf(srcLink)), { pad: 1.35, dur: 1.0 });
await sleep(300);
focus({ rect: await rectOf(quote) });
end = say('s2');
await until(end + GAP);
focus({ rect: await rectOf(srcLink), label: 'Official source' });
end = say('s3');
await pointAt(page, srcLink, 800, 0.4, 0.6);
await until(end + STOP);
focus(null);
cam('wide', { dur: 0.9 });
await click(page, page.locator('#sheet .sheet-close'), { ms: 600 });
await sleep(600);
mark('conflict', 'out');

// ===== Clip: a typed barcode, Not covered here, then the area switch. =====
mark('noodles', 'in');
cam(await rectOf(page.locator('.searchbar')), { pad: 1.5, dur: 0.9 });
focus({ rect: await rectOf(L.search), label: 'Barcode' });
end = say('n1');
await typeInto(page, L.search, '8801073113312');
await until(end);
await page.keyboard.press('Enter');
await L.product.waitFor();
await sleep(60);
cam(union(await rectOf(L.product), await rectOf(L.bins)), { pad: 1.04, dur: 1.0 });
focus({ rect: await rectOf(page.locator('#product-name')) });
end = say('n2');
await until(end + 0.2);
await sleep(1400); // the split
const gap = page.locator('.bin--gap');
cam(await rectOf(gap), { pad: 1.25, dur: 1.0 });
focus({ rect: await rectOf(gap.locator('.piece-main')) });
end = say('n3');
await pointAt(page, gap.locator('.piece-main'), 800, 0.55, 0.45);
await until(end + GAP);
focus({ rect: await rectOf(gap.locator('.bin-head')), label: 'Not covered here' });
end = say('n4');
await until(end + 0.1);
focus(null);
await click(page, gap.locator('.piece-main'), { ms: 300, fx: 0.55, fy: 0.45 });
await L.sheet.waitFor();
await sleep(300);
const why = page.locator('#sheet section').first();
cam(await rectOf(why), { pad: 1.15, dur: 1.0 });
await sleep(400);
focus({ rect: await rectOf(why.locator('p').first()) });
end = say('n5');
await until(end + GAP);
const checked = why.locator('a').first();
focus({ rect: await rectOf(checked), label: 'Checked against' });
end = say('n6');
await pointAt(page, checked, 800, 0.4, 0.6);
await until(end + STOP);
focus(null);
cam('wide', { dur: 0.9 });
await click(page, page.locator('#sheet .sheet-close'), { ms: 600 });
await sleep(600);

const sg = page.locator('[data-pack="sg-nea"]');
cam(union(await rectOf(page.locator('.area')), await rectOf(L.product)), { pad: 1.1, dur: 1.0 });
await sleep(300);
focus({ rect: await rectOf(sg), label: 'Area' });
end = say('w1');
await pointAt(page, sg, 900);
await until(end);
await press(page);
focus(null);
await sleep(80);
cam(union(await rectOf(L.product), await rectOf(L.bins)), { pad: 1.04, dur: 1.0 });
await sleep(300);
focus({ rect: await rectOf(L.bins) });
end = say('w2');
await until(end + STOP);
cam(await rectOf(L.bin('general')), { pad: 1.4, dur: 1.0 });
focus({ rect: await rectOf(L.bin('general')) });
end = say('w3');
await until(end + STOP);
focus(null);
mark('noodles', 'out');

// ===== Clip: no packaging data, two taps. =====
cam('wide', { dur: 0 });
await sleep(150);
mark('twotap', 'in');
cam(await rectOf(page.locator('.searchbar')), { pad: 1.5, dur: 0.8 });
focus({ rect: await rectOf(L.search), label: 'Barcode' });
end = say('t1');
await typeInto(page, L.search, '9556231110045');
await until(end);
await page.keyboard.press('Enter');
const describe = page.getByRole('button', { name: 'Describe a part' });
await describe.waitFor();
await sleep(150);
cam(union(await rectOf(L.product), await rectOf(page.locator('#stage-body .panel'))), { pad: 1.1, dur: 1.0 });
focus({ rect: await rectOf(page.locator('#stage-body .panel h3')) });
end = say('t2');
await until(end + STOP);
focus({ rect: await rectOf(describe) });
end = say('t3');
await pointAt(page, describe, 700);
await until(end);
await press(page);
focus(null);
await sleep(900); // the shape tiles scroll into view
cam(await rectOf(page.locator('#ask')), { pad: 1.08, dur: 0.9 });
await sleep(300);
const bag = page.locator('[data-ask-shape="bag"]');
focus({ rect: await rectOf(bag), label: 'Shape' });
end = say('t4');
await pointAt(page, bag, 700);
await until(end);
await press(page);
await sleep(450);
cam(await rectOf(page.locator('#ask')), { pad: 1.08, dur: 0.7 });
const plastic = page.locator('[data-ask-material="plastic"]');
focus({ rect: await rectOf(plastic), label: 'Material' });
end = say('t5');
await pointAt(page, plastic, 700);
await until(end);
await press(page);
focus(null);
await sleep(1300); // the new part lands and scrolls into view
{
  const part = page.locator('[data-part^="u"]').first();
  const bin = part.locator('xpath=ancestor::div[contains(@class,"bin ")]');
  const r = union(await rectOf(bin), await rectOf(part));
  cam(r, { pad: 1.35, dur: 1.0 });
  focus({ rect: await rectOf(bin) });
}
end = say('t6');
await until(end + STOP);
focus(null);
mark('twotap', 'out');

// ===== Clip: measured coverage (About). =====
cam('wide', { dur: 0 });
await page.evaluate(() => window.scrollTo(0, 0));
await sleep(300);
mark('about', 'in');
const about = page.getByRole('button', { name: 'About' });
cam(union(await rectOf(about), await rectOf(page.locator('.area'))), { pad: 1.6, dur: 0.9 });
focus({ rect: await rectOf(about), label: 'About' });
end = say('a1');
await pointAt(page, about, 900);
await until(end);
await press(page);
focus(null);
await page.locator('.big-figure').waitFor();
await sleep(400);
cam(union(await rectOf(page.locator('.big-figure')), await rectOf(page.locator('.figure-label'))), { pad: 1.12, dur: 1.0 });
await sleep(300);
focus({ rect: await textRect(page, '.figure-label', '240 barcodes'), label: '240 barcodes', underline: true });
end = say('a2');
await until(end + STOP);
focus({ rect: await textRect(page, '.figure-label', '95 real products'), label: '95 with packaging data', underline: true, below: true });
end = say('a3');
await until(end + STOP);
focus({ rect: await textRect(page, '.big-figure', '76%'), label: '72 of 95', pulse: true });
end = say('a4');
await until(end + GAP);
focus({ rect: await textRect(page, '.figure-label', '52%'), label: '49 of 95', underline: true });
end = say('a5');
await until(end + STOP);
focus(null);
mark('about', 'out');

// ===== Clip: saved on this device, offline. =====
cam('wide', { dur: 0 });
await page.keyboard.press('Escape');
await sleep(400);
await page.locator('[data-home]').click();
await page.getByRole('heading', { name: /Every part/ }).waitFor();
await sleep(900);
mark('offline', 'in');
await ctx.setOffline(true);
caption('Network off');
const startInput = page.locator('[data-lookup] input');
cam(union(await rectOf(startInput), await rectOf(page.locator('.start h1'))), { pad: 1.2, dur: 1.0 });
focus({ rect: await rectOf(startInput) });
end = say('o1');
await typeInto(page, startInput, '3017620422003');
await until(end);
await page.keyboard.press('Enter');
await L.product.waitFor();
await sleep(60);
cam(await rectOf(L.product), { pad: 1.06, dur: 1.0 });
focus({ rect: await rectOf(L.product) });
end = say('o2');
await until(end + GAP);
const saved = await textRect(page, '.product-sub', 'Saved on this device');
cam(union(await rectOf(page.locator('.product-img')), saved), { pad: 1.25, dur: 1.0 });
focus({ rect: saved, label: 'No network needed' });
end = say('o3');
await until(end + 0.9);
focus(null);
mark('offline', 'out');
await ctx.setOffline(false);

await sleep(300);
capturing = false;
await capture;
await browser.close();

// ---------- Hand-off to the renderer ----------

// The edit: clips in order, with the cards between them. Card phrases name parts of the
// card (CSS selector, optionally a piece of its text), read from the card page when rendering.
const edit = [
  { kind: 'clip', id: 'hook' },
  {
    kind: 'card',
    card: 'problem',
    beats: [
      { vo: 'p1', sel: '.statement h2' },
      { vo: 'p2', sel: '.statement .src' },
      { vo: 'p3', sel: '.statement h2', text: '40%', underline: true, gap: STOP },
      { vo: 'p4', sel: '.split .board:nth-child(1)' },
      { vo: 'p5', sel: '.split .board:nth-child(2)' },
    ],
  },
  { kind: 'clip', id: 'conflict' },
  { kind: 'clip', id: 'noodles' },
  { kind: 'clip', id: 'twotap' },
  {
    kind: 'card',
    card: 'how',
    beats: [
      { vo: 'k1', sel: 'h2', text: 'How it works' },
      { vo: 'k2', sel: '.flow .step:nth-child(1)' },
      { vo: 'k3', sel: '.flow .step:nth-child(2)' },
      { vo: 'k4', sel: '.flow .step:nth-child(3)' },
      { vo: 'k5', sel: '.flow .step:nth-child(4)' },
    ],
  },
  { kind: 'clip', id: 'about' },
  {
    kind: 'card',
    card: 'measure',
    beats: [
      { vo: 'm1', sel: '.measure:nth-child(1)', gap: STOP },
      { vo: 'm2', sel: '.measure:nth-child(2)', gap: STOP },
      { vo: 'm3', sel: '.measure:nth-child(3)' },
    ],
  },
  { kind: 'clip', id: 'offline' },
  { kind: 'card', card: 'end', beats: [{ vo: 'e1', sel: '.end h1', text: 'BinSplit' }] },
];

writeFileSync(
  join(work, 'rec.json'),
  JSON.stringify({ viewport: { w: W, h: H, dsf: DSF }, slowMotion: K, gap: GAP, base, voices, frames, events, edit }, null, 0),
);
const span = frames[frames.length - 1].t - frames[0].t;
console.log(`frames: ${frames.length} (${(frames.length / span).toFixed(0)} per filmed second, ${stored} distinct), events: ${events.length}, live lookups: ${apiCalls}, page errors: ${errors.length ? errors.join(' | ') : 0}`);
