// Records the demo video from the real running app: drives it with Playwright,
// adds a themed caption bar, a macOS `say` voice-over, and joins the scenes
// with ffmpeg into assets/demo.mp4.
//
//   npm run dev -- --port 5181     (in another terminal)
//   node scripts/record-demo.ts [baseUrl]

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync, readdirSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] ?? 'http://127.0.0.1:5181/';
const work = join(root, '.cache/demo');
const W = 1600;
const H = 900;
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

interface Scene {
  id: string;
  vo: string;
  caption?: string;
  card?: string;
  /** Filmed in a phone-width frame (scripts/video/phone.html). */
  phone?: boolean;
  run?: (page: Page) => Promise<void>;
}

const wait = (page: Page, ms: number) => page.waitForTimeout(ms);

/** A themed caption bar: a registration mark and one line; a new line crossfades in. */
async function caption(page: Page, text: string) {
  await page.evaluate(async (t) => {
    let el = document.getElementById('demo-caption');
    if (!el) {
      el = document.createElement('div');
      el.id = 'demo-caption';
      el.style.cssText =
        'position:fixed;left:50%;bottom:28px;z-index:9999;max-width:920px;display:flex;align-items:center;gap:14px;' +
        'background:#17201c;color:#f3efe6;font:600 21px/1.35 "Instrument Sans Variable",sans-serif;letter-spacing:-0.005em;' +
        'padding:14px 22px 14px 18px;border-radius:16px;box-shadow:0 1px 0 rgb(23 32 28/.2),0 22px 44px -18px rgb(23 32 28/.65);' +
        'transform:translateX(-50%);opacity:0;transition:opacity 220ms ease,transform 320ms cubic-bezier(.23,1,.32,1)';
      el.innerHTML =
        '<svg viewBox="0 0 16 16" width="18" height="18" style="flex:none"><circle cx="8" cy="8" r="4" fill="none" stroke="#d2462a" stroke-width="1.4"/><path d="M8 0v16M0 8h16" stroke="#d2462a" stroke-width="1.4"/></svg><span></span>';
      document.body.appendChild(el);
      el.querySelector('span')!.textContent = t;
      el.style.transform = 'translate(-50%, 8px)';
      el.getBoundingClientRect();
      el.style.opacity = '1';
      el.style.transform = 'translate(-50%, 0)';
      return;
    }
    el.style.opacity = '0';
    el.style.transform = 'translate(-50%, 6px)';
    await new Promise((r) => setTimeout(r, 200));
    el.querySelector('span')!.textContent = t;
    el.style.opacity = '1';
    el.style.transform = 'translate(-50%, 0)';
  }, text);
}

/** Load the product pictures before a scene starts, so the parts are cut from a visible image. */
async function preloadImages(page: Page) {
  await page.goto(base + '?area=my-act672');
  await page.evaluate(async () => {
    const urls = Object.keys(localStorage)
      .filter((k) => k.startsWith('binsplit:product:'))
      .map((k) => JSON.parse(localStorage.getItem(k)!)?.image_front_small_url)
      .filter(Boolean) as string[];
    await Promise.all(urls.map((u) => new Promise((r) => { const i = new Image(); i.onload = i.onerror = r; i.src = u; })));
  });
}

/** Look a barcode up through the search field, retrying if Open Food Facts is busy. */
async function lookup(page: Page, code: string) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const input = page.locator('[data-lookup] input');
    await input.fill(code);
    await input.press('Enter');
    const done = await page
      .locator('#stage-body .bin, #stage-body .panel')
      .first()
      .waitFor({ timeout: 25000 })
      .then(() => true, () => false);
    const busy = await page.locator('.panel h3', { hasText: /busy|did not answer/ }).count();
    if (done && !busy) return;
    await wait(page, 20000);
  }
  throw new Error(`lookup ${code} kept failing`);
}

/** Open the app on a product, retrying while Open Food Facts is busy. */
async function openCode(page: Page, code: string) {
  for (let attempt = 0; attempt < 8; attempt++) {
    await page.goto(`${base}?area=my-act672&code=${code}`);
    const ok = await page
      .locator('#stage-body .bin .piece')
      .first()
      .waitFor({ timeout: 25000 })
      .then(() => true, () => false);
    if (ok) return;
    await wait(page, 20000);
  }
  throw new Error(`could not open ${code}`);
}

const scenes: Scene[] = [
  {
    id: '00-title',
    card: 'title',
    vo: 'BinSplit. Scan a barcode, and every part of the packaging goes to the right bin.',
  },
  {
    id: '01-cold-open',
    caption: 'A real jar of Nutella, with its product data from Open Food Facts',
    vo:
      'This is a jar of Nutella. BinSplit looks up its packaging, splits it into parts, and sorts each part under the Malaysian rules from S W Corp. ' +
      'Here the records disagree: one lists six plastic bottles, the packaging text does not. So BinSplit asks, instead of guessing.',
    run: async (page) => {
      await page.getByRole('heading', { name: /Every part/ }).waitFor();
      await wait(page, 1800);
      await page.getByRole('button', { name: 'Nutella jar' }).click();
      await caption(page, 'A real jar of Nutella: its packaging, split into parts');
      await page.locator('.bin--needs').waitFor({ timeout: 30000 });
      await wait(page, 4200);
      await caption(page, 'The records disagree on one part, so it asks instead of guessing');
      await page.locator('.bin--needs .piece').hover();
      await wait(page, 4200);
      await page.locator('[data-drop]').first().click();
      await wait(page, 600);
      await caption(page, 'Glass jar and aluminium seal: Others. Plastic lid: Plastics.');
      await wait(page, 4000);
    },
  },
  {
    id: '02-problem',
    card: 'problem',
    vo:
      "Singapore's environment agency says forty percent of the items in recycling bins cannot be recycled, because of contamination. " +
      'Packaging is mixed, and the rules change from place to place.',
  },
  {
    id: '03-products',
    caption: 'Three more real products',
    vo:
      'A bottle of green tea: the bottle and the cap both go to Plastics. Butter: the box goes to Papers, the film wrapper to Plastics. ' +
      'Instant noodles: the foil-lined wrapper is not in S W Corp\'s list, and BinSplit says so rather than guess.',
    run: async (page) => {
      await openCode(page, '8888196173324');
      await caption(page, 'Green tea: bottle and cap go to Plastics (Plastik)');
      await wait(page, 5500);
      await lookup(page, '8901262010016');
      await caption(page, 'Butter: box to Papers (Kertas), film to Plastics');
      await wait(page, 5500);
      await lookup(page, '8801073113312');
      await caption(page, 'Noodles: the foil-lined wrapper is not covered by the SWCorp list');
      await wait(page, 3800);
      await page.locator('.bin--gap .piece-main').first().click();
      await caption(page, 'Not covered here: no official rule, so no bin is guessed');
      await wait(page, 4800);
      await page.keyboard.press('Escape');
      await wait(page, 600);
    },
  },
  {
    id: '04-region',
    caption: 'Switch the area: the same parts re-sort under NEA Singapore rules',
    vo:
      "Switch to Singapore, and the same parts re-sort under NEA's rules: the foil-lined wrapper is general waste there. " +
      'Tap any part to see the rule, and the official source it comes from.',
    run: async (page) => {
      await openCode(page, '8801073113312');
      await wait(page, 2600);
      await page.getByRole('button', { name: /Singapore/ }).click();
      await wait(page, 3200);
      await page.locator('.bin[data-bin="general"] .piece-main').first().click();
      await caption(page, 'Every answer cites its official source');
      await wait(page, 6000);
    },
  },
  {
    id: '04b-phone',
    phone: true,
    vo:
      'On a phone, the parts come out of the product as a fanned deck, then each one drops into its bin. ' +
      'One tap answers the question. One tap switches the area.',
    run: async (page) => {
      const app = page.frameLocator('#phone-app');
      await app.getByRole('heading', { name: /Every part/ }).waitFor();
      await caption(page, 'Phone width, the way it is used at the bin');
      await wait(page, 1600);
      await app.getByRole('button', { name: 'Nutella jar' }).click();
      await app.locator('.bin--needs').waitFor({ timeout: 30000 });
      await wait(page, 3600);
      await app.locator('.bin--needs [data-drop]').first().click();
      await caption(page, 'One tap answers the question');
      await wait(page, 1600);
      await app.locator('#bins').evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      await wait(page, 1800);
      await app.getByRole('button', { name: 'Singapore' }).click();
      await caption(page, 'One tap switches the area: the parts re-sort under NEA rules');
      await wait(page, 3600);
    },
  },
  {
    id: '05-photo-and-two-tap',
    caption: 'Barcode photo, decoded in the browser',
    vo:
      'Scan with the camera, or a photo. Decoding runs in the browser. ' +
      'If a product has no packaging data, two taps describe the part, and the same official rules sort it.',
    run: async (page) => {
      await page.goto(base + '?area=my-act672');
      await page.getByRole('heading', { name: /Every part/ }).waitFor();
      await wait(page, 800);
      await page.locator('#photo').setInputFiles(join(root, 'assets/test-barcode-5449000000996.png'));
      await page.locator('#stage-body .bin .piece').first().waitFor({ timeout: 30000 });
      await wait(page, 4000);
      await caption(page, 'No data for this barcode? Describe the part in two taps');
      await lookup(page, '9556231110045');
      await wait(page, 1200);
      await page.getByRole('button', { name: 'Describe a part' }).click();
      await wait(page, 1000);
      await page.locator('[data-ask-shape="bag"]').click();
      await wait(page, 1000);
      await page.locator('[data-ask-material="plastic"]').click();
      await wait(page, 2500);
    },
  },
  {
    id: '06-how',
    card: 'how',
    vo:
      'Under the hood: Open Food Facts data, normalised with its packaging taxonomy, reconciled across fields with a confidence level, ' +
      'then matched to rule packs where every rule cites its source. We measured coverage on two hundred and forty of the most scanned products sold in Malaysia and Singapore. ' +
      'Many products have no packaging data yet, which is why the two-tap path exists.',
  },
  {
    id: '06b-about',
    caption: 'The About screen: measured coverage and every source',
    vo:
      'Of the products that do have packaging data, about three in four get a bin for at least one part, and half get every part sorted. ' +
      'The About screen shows these numbers and lists every official source.',
    run: async (page) => {
      await openCode(page, '8888196173324');
      await wait(page, 1500);
      await page.getByRole('button', { name: 'About' }).click();
      await page.locator('.big-figure').waitFor();
      await wait(page, 5000);
      await page.locator('#sheet .sheet').evaluate((el) => el.scrollBy({ top: 520, behavior: 'smooth' }));
      await wait(page, 4000);
    },
  },
  {
    id: '07-offline',
    caption: 'Offline: products you have looked up still work',
    vo: 'No account, no server, no key. It is a static site, and products you have already looked up keep working offline.',
    run: async (page) => {
      await openCode(page, '3017620422003');
      await wait(page, 1500);
      await page.context().setOffline(true);
      await page.locator('[data-home]').click();
      await page.getByRole('heading', { name: /Every part/ }).waitFor();
      await caption(page, 'Network off. Same jar again.');
      await wait(page, 1200);
      const input = page.locator('[data-lookup] input');
      await input.fill('3017620422003');
      await input.press('Enter');
      await page.locator('#stage-body .bin .piece').first().waitFor({ timeout: 10000 });
      await wait(page, 4500);
      await page.context().setOffline(false);
    },
  },
  {
    id: '08-measure',
    card: 'measure',
    vo:
      'How we would measure impact: coverage, which we measured; a sorting quiz before and after; and a bin audit of one residence block over four weeks.',
  },
  { id: '09-end', card: 'end', vo: 'BinSplit. Open data, official rules, every part in the right bin.' },
];

function sh(cmd: string, args: string[]) {
  return execFileSync(cmd, args, { encoding: 'utf8' });
}
const duration = (file: string) =>
  Number(sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).trim());

const browser: Browser = await chromium.launch({ args: ['--use-mock-keychain', '--password-store=basic'] });
let storage: Awaited<ReturnType<BrowserContext['storageState']>> | undefined;

// Warm-up (not recorded): look every demo product up once through the app, so a busy
// Open Food Facts API (HTTP 429) cannot stall the recording. The app keeps each
// lookup on the device, exactly as it does for a user; the recorded scenes then read it.
const savedCache = join(root, '.cache/demo-storage.json');
{
  const ctx = await browser.newContext(existsSync(savedCache) ? { storageState: savedCache } : {});
  const page = await ctx.newPage();
  for (const code of ['3017620422003', '8888196173324', '8901262010016', '8801073113312', '5449000000996', '9556231110045']) {
    for (let attempt = 0; ; attempt++) {
      await page.goto(`${base}?area=my-act672&code=${code}`);
      const ok = await page
        .locator('#stage-body .bin, #stage-body .panel')
        .first()
        .waitFor({ timeout: 25000 })
        .then(() => true, () => false);
      const busy = await page.locator('.panel h3', { hasText: /busy|did not answer/ }).count();
      if (ok && !busy) break;
      if (attempt >= 10) throw new Error(`warm-up: ${code} kept failing`);
      console.log(`warm-up: ${code} busy, waiting`);
      await wait(page, 30000);
    }
  }
  storage = await ctx.storageState({ path: savedCache });
  await ctx.close();
  console.log('warm-up done');
}
const segments: string[] = [];

for (const scene of scenes) {
  const voFile = join(work, `${scene.id}.aiff`);
  sh('say', ['-v', 'Samantha', '-r', '178', '-o', voFile, scene.vo]);
  const voLen = duration(voFile);

  const dir = join(work, scene.id);
  mkdirSync(dir);
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir, size: { width: W, height: H } }, storageState: storage });
  const t0 = Date.now();
  const page = await ctx.newPage();
  let start = 0;
  if (scene.card) {
    await page.goto(`${base}scripts/video/card.html?card=${scene.card}`);
    await page.locator('#card > *').first().waitFor();
    start = (Date.now() - t0) / 1000;
    await wait(page, Math.ceil(voLen * 1000) + 1500);
  } else {
    // Not filmed: fetch the product pictures, and leave the page on the start screen.
    await preloadImages(page);
    if (scene.phone) await page.goto(`${base}scripts/video/phone.html?src=${encodeURIComponent(base + '?area=my-act672')}`);
    start = (Date.now() - t0) / 1000;
    const sceneStart = Date.now();
    await scene.run!(page);
    if (scene.caption && !(await page.locator('#demo-caption').count())) await caption(page, scene.caption);
    const spent = (Date.now() - sceneStart) / 1000;
    if (spent < voLen + 2.2) await wait(page, Math.ceil((voLen + 2.2 - spent) * 1000));
  }
  storage = await ctx.storageState();
  await ctx.close();
  const webm = readdirSync(dir).find((f) => f.endsWith('.webm'))!;
  renameSync(join(dir, webm), join(dir, 'clip.webm'));

  // Trim the blank start, keep the voice from the scene start, pad audio to the clip length.
  const seg = join(work, `${scene.id}.mp4`);
  const clipLen = duration(join(dir, 'clip.webm')) - start;
  sh('ffmpeg', [
    '-loglevel', 'error', '-y',
    '-ss', String(start), '-i', join(dir, 'clip.webm'),
    '-i', voFile,
    '-filter_complex', `[1:a]adelay=300|300,apad[a]`,
    '-map', '0:v', '-map', '[a]', '-t', String(clipLen),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
    seg,
  ]);
  segments.push(seg);
  console.log(`${scene.id}: ${clipLen.toFixed(1)}s (voice ${voLen.toFixed(1)}s)`);
}
await browser.close();

const list = join(work, 'list.txt');
writeFileSync(list, segments.map((s) => `file '${s}'`).join('\n'));
const out = join(root, 'assets/demo.mp4');
sh('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out]);
console.log(`demo: ${duration(out).toFixed(1)}s -> ${out}`);
