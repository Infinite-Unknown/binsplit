// FLIP animation: remember where keyed elements are, re-render, then animate
// each element from its old position to its new one.

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
      el.animate([{ opacity: 0, transform: 'scale(.92)' }, { opacity: 1, transform: 'none' }], {
        duration: 260,
        easing: 'cubic-bezier(.2,.8,.2,1)',
        fill: 'backwards',
      });
      return;
    }
    const dx = prev.left - now.left;
    const dy = prev.top - now.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    el.animate(
      [
        { transform: `translate(${dx}px, ${dy}px)` },
        { transform: `translate(${dx * 0.1}px, ${dy * 0.1 - 18}px)`, offset: 0.6 },
        { transform: 'none' },
      ],
      { duration, delay: (opts.stagger ?? 0) * i++, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'backwards' },
    );
  });
}
