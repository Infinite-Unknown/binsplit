// Renders assets/demo.mp4 from the footage and log made by scripts/record-demo.ts.
//
//   node scripts/video/render.ts [baseUrl]        (the dev server must be running)
//
// 1. Builds the edit: clips cut from the recording at their in/out marks, cards in
//    between, a short crossfade at every join, voice lines placed where they started.
// 2. Renders every 1920x1080 frame at 60 fps in scripts/video/render.html (several
//    pages in parallel), each piped into its own x264 encoder.
// 3. Mixes the voice-over, normalises it to -16 LUFS (two-pass loudnorm), and muxes.
// 4. Writes an upload copy under 9.5 MB (two-pass, gitignored) for browser upload limits.

import { chromium } from 'playwright';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, statSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const base = process.argv[2] ?? 'http://127.0.0.1:5181/';
const work = join(root, '.cache/video');
const out = join(root, 'assets/demo.mp4');
const uploadOut = join(root, 'assets/demo-upload.mp4');
const FPS = 60;
const OVERLAP = 0.4;
const WORKERS = Number(process.env.WORKERS ?? 4);

type Ev = { t: number; kind: string; [k: string]: any };
const rec = JSON.parse(readFileSync(join(work, 'rec.json'), 'utf8')) as {
  viewport: { w: number; h: number; dsf: number };
  voices: Record<string, { file: string; dur: number; text: string }>;
  frames: Array<{ t: number; f: number }>;
  events: Ev[];
  edit: Array<{ kind: 'clip'; id: string } | { kind: 'card'; card: string; vo: string }>;
};

const sh = (cmd: string, args: string[]) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 26 });
const ffprobe = (file: string, entries: string) =>
  sh('ffprobe', ['-v', 'error', '-show_entries', entries, '-of', 'default=nw=1:nk=1', file]).trim();

// ---------- The edit ----------

const marks = new Map<string, number>();
for (const e of rec.events) if (e.kind === 'mark') marks.set(`${e.clip}:${e.edge}`, e.t);
const captionEvents = rec.events.filter((e) => e.kind === 'caption');

type Item =
  | { kind: 'clip'; id: string; recIn: number; recOut: number; outStart: number; outDur: number; captions: Array<{ t0: number; t1: number; text: string }> }
  | { kind: 'card'; card: string; vo: string; outStart: number; outDur: number };
const items: Item[] = [];
const voPlacements: Array<{ id: string; at: number }> = [];
let cursorT = 0;
for (const e of rec.edit) {
  const outStart = items.length ? cursorT - OVERLAP : 0;
  if (e.kind === 'card') {
    const lead = 0.55;
    const tail = e.card === 'end' ? 1.8 : 0.9;
    const outDur = lead + rec.voices[e.vo].dur + tail;
    items.push({ kind: 'card', card: e.card, vo: e.vo, outStart, outDur });
    voPlacements.push({ id: e.vo, at: outStart + lead });
    cursorT = outStart + outDur;
  } else {
    const recIn = marks.get(`${e.id}:in`)!;
    const recOut = marks.get(`${e.id}:out`)!;
    if (recIn == null || recOut == null) throw new Error(`clip ${e.id} has no marks`);
    // Captions set inside the clip; each one lasts until the next caption or the end of the clip.
    const inside = captionEvents.filter((c) => c.t >= recIn - 0.05 && c.t < recOut);
    const captions = inside
      .map((c, i) => ({ t0: Math.max(c.t, recIn), t1: (inside[i + 1]?.t ?? recOut) - 0.05, text: c.text as string | null }))
      .filter((c): c is { t0: number; t1: number; text: string } => !!c.text);
    items.push({ kind: 'clip', id: e.id, recIn, recOut, outStart, outDur: recOut - recIn, captions });
    for (const v of rec.events) if (v.kind === 'vo' && v.t >= recIn && v.t < recOut) voPlacements.push({ id: v.id, at: outStart + (v.t - recIn) });
    cursorT = outStart + (recOut - recIn);
  }
}
const total = cursorT;
const nFrames = Math.ceil(total * FPS);
console.log(`edit: ${items.length} items, ${total.toFixed(2)} s, ${nFrames} frames`);
for (const it of items) console.log(`  ${(it.kind === 'clip' ? it.id : 'card ' + it.card).padEnd(14)} ${it.outStart.toFixed(2).padStart(7)}  ${it.outDur.toFixed(2)} s`);

const edl = {
  view: rec.viewport,
  overlap: OVERLAP,
  items,
  frames: rec.frames,
  cams: rec.events.filter((e) => e.kind === 'cam'),
  cursor: rec.events.filter((e) => e.kind === 'cursor').map((e) => ({ t: e.t, x: e.x, y: e.y })),
  clicks: rec.events.filter((e) => e.kind === 'click').map((e) => ({ t: e.t, x: e.x, y: e.y })),
};

// ---------- Frames ----------

const chunksDir = join(work, 'chunks');
rmSync(chunksDir, { recursive: true, force: true });
mkdirSync(chunksDir, { recursive: true });

// PREVIEW=12.5,40 renders just those output times to .cache/video/preview-<t>.png.
if (process.env.PREVIEW) {
  const browser = await chromium.launch({ args: ['--use-mock-keychain', '--password-store=basic'] });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await ctx.route('**/__frame/*', (route) => {
    const name = route.request().url().split('/__frame/')[1];
    route.fulfill({ body: readFileSync(join(work, 'frames', name)), contentType: 'image/jpeg' });
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error(e.message));
  await page.goto(base + 'scripts/video/render.html');
  await page.evaluate((e) => (window as any).setup(e), edl);
  for (const t of process.env.PREVIEW.split(',').map(Number)) {
    await page.evaluate((T) => (window as any).renderFrame(T), t);
    await page.screenshot({ path: join(work, `preview-${t}.png`) });
  }
  await browser.close();
  process.exit(0);
}

if (!process.env.SKIP_FRAMES) {
  const browser = await chromium.launch({ args: ['--use-mock-keychain', '--password-store=basic'] });
  const per = Math.ceil(nFrames / WORKERS);
  const t0 = Date.now();
  let done = 0;
  await Promise.all(
    Array.from({ length: WORKERS }, async (_, w) => {
      const from = w * per;
      const to = Math.min(nFrames, from + per);
      if (from >= to) return;
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
      await ctx.route('**/__frame/*', (route) => {
        const name = route.request().url().split('/__frame/')[1];
        route.fulfill({ body: readFileSync(join(work, 'frames', name)), contentType: 'image/jpeg' });
      });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => console.error(`worker ${w}:`, e.message));
      await page.goto(base + 'scripts/video/render.html');
      await page.evaluate((e) => (window as any).setup(e), edl);
      const cdp = await ctx.newCDPSession(page);
      const ff = spawn('ffmpeg', [
        '-loglevel', 'error', '-y',
        '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
        '-r', String(FPS), '-g', String(FPS * 2), '-x264-params', 'keyint=120:min-keyint=60',
        join(chunksDir, `${String(w).padStart(2, '0')}.mp4`),
      ], { stdio: ['pipe', 'inherit', 'inherit'] });
      const finished = new Promise<void>((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg ${w} exited ${c}`)))));
      for (let f = from; f < to; f++) {
        await page.evaluate((T) => (window as any).renderFrame(T), f / FPS);
        const shot = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
        if (!ff.stdin.write(Buffer.from(shot.data, 'base64'))) await new Promise((r) => ff.stdin.once('drain', r));
        done++;
        if (done % 600 === 0) console.log(`  ${done}/${nFrames} frames, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
      }
      ff.stdin.end();
      await finished;
      await ctx.close();
    }),
  );
  await browser.close();
  console.log(`frames rendered in ${((Date.now() - t0) / 1000).toFixed(0)} s`);

  const list = join(chunksDir, 'list.txt');
  writeFileSync(
    list,
    Array.from({ length: WORKERS }, (_, w) => `file '${join(chunksDir, `${String(w).padStart(2, '0')}.mp4`)}'`).join('\n'),
  );
  sh('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', join(work, 'video.mp4')]);
}

// ---------- Voice-over: placed, mixed, normalised to -16 LUFS ----------

const inputs: string[] = [];
const chains: string[] = [];
voPlacements.forEach((v, i) => {
  inputs.push('-i', rec.voices[v.id].file);
  const ms = Math.round(v.at * 1000);
  chains.push(`[${i}:a]aresample=48000,aformat=channel_layouts=mono,adelay=${ms}:all=1[v${i}]`);
});
const mix = `${chains.join(';')};${voPlacements.map((_, i) => `[v${i}]`).join('')}amix=inputs=${voPlacements.length}:normalize=0:dropout_transition=0,apad,atrim=0:${total.toFixed(3)}[mix]`;
const rawAudio = join(work, 'vo-mix.wav');
sh('ffmpeg', ['-loglevel', 'error', '-y', ...inputs, '-filter_complex', mix, '-map', '[mix]', '-ac', '1', '-ar', '48000', rawAudio]);
// loudnorm prints its measurement as JSON on stderr.
const measured = JSON.parse(
  execFileSync('sh', ['-c', `ffmpeg -hide_banner -i "${rawAudio}" -af loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p'`], { encoding: 'utf8' }),
);
const audio = join(work, 'vo-16lufs.wav');
sh('ffmpeg', [
  '-loglevel', 'error', '-y', '-i', rawAudio,
  '-af',
  `loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true,aresample=48000`,
  '-ac', '2', '-ar', '48000', audio,
]);

// ---------- Mux ----------

sh('ffmpeg', [
  '-loglevel', 'error', '-y', '-i', join(work, 'video.mp4'), '-i', audio,
  '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
  '-t', total.toFixed(3), '-movflags', '+faststart', out,
]);
const lufs = execFileSync('sh', ['-c', `ffmpeg -hide_banner -i "${out}" -af ebur128 -f null - 2>&1 | grep -E '^ +I:' | tail -1`], { encoding: 'utf8' }).trim();
console.log(`demo: ${Number(ffprobe(out, 'format=duration')).toFixed(1)} s, ${(statSync(out).size / 1e6).toFixed(1)} MB, loudness ${lufs} -> ${out}`);

// ---------- Upload copy under 9.5 MB (two-pass) ----------

if (!process.env.SKIP_UPLOAD) {
  const limit = 9.5 * 1e6;
  // 720p: at the ~400 kb/s this size allows, 1080p smears during the camera moves; 720p stays clean.
  const height = Number(process.env.UPLOAD_HEIGHT ?? 720);
  const audioKbps = 96;
  let target = Math.floor(((limit * 0.94 * 8) / total) / 1000) - audioKbps;
  for (let attempt = 0; attempt < 4; attempt++) {
    const passlog = join(work, 'x264pass');
    const common = ['-i', out, '-vf', `scale=-2:${height}:flags=lanczos`, '-c:v', 'libx264', '-preset', 'veryslow', '-b:v', `${target}k`, '-maxrate', `${Math.round(target * 2)}k`, '-bufsize', `${target * 4}k`, '-pix_fmt', 'yuv420p', '-r', '30', '-tune', 'animation', '-passlogfile', passlog];
    sh('ffmpeg', ['-loglevel', 'error', '-y', ...common, '-pass', '1', '-an', '-f', 'mp4', '/dev/null']);
    sh('ffmpeg', ['-loglevel', 'error', '-y', ...common, '-pass', '2', '-c:a', 'aac', '-b:a', `${audioKbps}k`, '-movflags', '+faststart', uploadOut]);
    const size = statSync(uploadOut).size;
    console.log(`upload copy: ${height}p, video ${target} kb/s -> ${(size / 1e6).toFixed(2)} MB`);
    if (size < limit) break;
    target = Math.floor(target * (limit * 0.97) / size);
  }
}
