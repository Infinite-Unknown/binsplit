// FLIP animation: remember where keyed elements are, re-render, then animate
// each element from its old position to its new one along a lifted arc.

const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function snapshot(root: ParentNode): Map<string, DOMRect> {
  const m = new Map<string, DOMRect>();
  root.querySelectorAll<HTMLElement>('[data-flip]').forEach((el) => m.set(el.dataset.flip!, el.getBoundingClientRect()));
  return m;
}

export function play(root: ParentNode, before: Map<string, DOMRect>, opts: { stagger?: number; duration?: number } = {}) {
  if (reduceMotion()) return;
  const duration = opts.duration ?? 520;
  let i = 0;
  root.querySelectorAll<HTMLElement>('[data-flip]').forEach((el) => {
    const prev = before.get(el.dataset.flip!);
    const now = el.getBoundingClientRect();
    if (!prev) {
      el.animate([{ opacity: 0, transform: 'scale(.94)' }, { opacity: 1, transform: 'none' }], {
        duration: 260,
        easing: 'cubic-bezier(.23,1,.32,1)',
        fill: 'backwards',
      });
      return;
    }
    const dx = prev.left - now.left;
    const dy = prev.top - now.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    // Picked up, carried over the bins, set down: the lift grows with the distance travelled.
    const lift = Math.min(56, 16 + Math.hypot(dx, dy) * 0.08);
    el.classList.add('is-flying');
    const anim = el.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(1)`, easing: 'cubic-bezier(.25,.6,.35,1)' },
        { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - lift}px) scale(1.03)`, offset: 0.5, easing: 'cubic-bezier(.5,0,.3,1)' },
        { transform: 'translate(0px, 0px) scale(1)' },
      ],
      { duration, delay: (opts.stagger ?? 0) * i++, fill: 'backwards' },
    );
    const done = () => el.classList.remove('is-flying');
    anim.finished.then(done, done);
  });
}
