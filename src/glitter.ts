// The glitter shown when Terra fills in a saved login: a shine sweeps
// across each filled field and sparkles burst out of it. Runs inside the
// website (tab-preload.ts), drawn in a closed shadow root on top of the
// page so the site's CSS can't touch it and it can't touch the site.

/** A four-pointed star, 24x24. */
const STAR =
  'M12 0C12.9 7.2 16.8 11.1 24 12C16.8 12.9 12.9 16.8 12 24C11.1 16.8 7.2 12.9 0 12C7.2 11.1 11.1 7.2 12 0Z';

const SPARKLES_PER_FIELD = 22;
/** How long the whole show lasts, ms. */
const LENGTH = 1600;

const random = (min: number, max: number) => min + Math.random() * (max - min);

function sparkleColors(accent: string) {
  return [accent, accent, '#ffffff', '#ffe08a', '#ffc2f0'];
}

function shine(
  layer: HTMLElement,
  field: HTMLElement,
  box: DOMRect,
  accent: string,
) {
  const frame = document.createElement('div');
  const radius = getComputedStyle(field).borderRadius || '0px';
  Object.assign(frame.style, {
    position: 'fixed',
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    borderRadius: radius,
    overflow: 'hidden',
  });
  // A soft glow in the accent color around the field.
  frame.animate(
    [
      { boxShadow: `0 0 0 0 ${accent}00` },
      {
        boxShadow: `0 0 0 2px ${accent}, 0 0 16px 4px ${accent}88`,
        offset: 0.25,
      },
      { boxShadow: `0 0 0 0 ${accent}00` },
    ],
    { duration: LENGTH * 0.8, easing: 'ease-out', fill: 'forwards' },
  );
  // A band of light that sweeps across it.
  const band = document.createElement('div');
  Object.assign(band.style, {
    position: 'absolute',
    inset: '0',
    background:
      'linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.75) 48%, rgba(255,240,200,0.9) 50%, rgba(255,255,255,0.75) 52%, transparent 70%)',
    mixBlendMode: 'screen',
  });
  band.animate(
    [{ transform: 'translateX(-100%)' }, { transform: 'translateX(100%)' }],
    {
      duration: LENGTH * 0.5,
      easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
      fill: 'forwards',
    },
  );
  frame.append(band);
  layer.append(frame);
}

function sparkles(layer: HTMLElement, box: DOMRect, accent: string) {
  const colors = sparkleColors(accent);
  for (let i = 0; i < SPARKLES_PER_FIELD; i++) {
    const size = random(6, 16);
    // Spread along the field, following the shine from left to right.
    const along = Math.random();
    const x = box.left + along * box.width;
    const y = box.top + random(0.1, 0.9) * box.height;
    const angle = random(0, Math.PI * 2);
    const distance = random(12, 44);
    const dx = Math.cos(angle) * distance;
    const dy = Math.sin(angle) * distance - random(4, 16);
    const spin = random(-180, 180);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    Object.assign(svg.style, {
      position: 'fixed',
      left: `${x - size / 2}px`,
      top: `${y - size / 2}px`,
      overflow: 'visible',
      opacity: '0',
    });
    const color = colors[Math.floor(Math.random() * colors.length)];
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', STAR);
    path.setAttribute('fill', color);
    svg.style.filter = `drop-shadow(0 0 ${size / 3}px ${color})`;
    svg.append(path);
    layer.append(svg);
    svg.animate(
      [
        { transform: 'translate(0, 0) scale(0) rotate(0deg)', opacity: 0 },
        {
          transform: `translate(${dx * 0.4}px, ${dy * 0.4}px) scale(1.15) rotate(${spin * 0.4}deg)`,
          opacity: 1,
          offset: 0.3,
        },
        {
          transform: `translate(${dx * 0.75}px, ${dy * 0.75}px) scale(0.6) rotate(${spin * 0.75}deg)`,
          opacity: 1,
          offset: 0.6,
        },
        {
          transform: `translate(${dx}px, ${dy}px) scale(0) rotate(${spin}deg)`,
          opacity: 0,
        },
      ],
      {
        duration: random(650, 1100),
        delay: along * LENGTH * 0.3 + random(0, 120),
        easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)',
        fill: 'forwards',
      },
    );
  }
}

/** Plays the glitter over the given (just filled) fields. */
export function glitter(fields: HTMLElement[], accent: string) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const color = /^#[0-9a-f]{6}$/i.test(accent) ? accent : '#4f7cff';
  const host = document.createElement('terra-glitter');
  for (const [name, value] of Object.entries({
    all: 'initial',
    position: 'fixed',
    inset: '0',
    'z-index': '2147483647',
    'pointer-events': 'none',
    display: 'block',
  })) {
    host.style.setProperty(name, value, 'important');
  }
  const root = host.attachShadow({ mode: 'closed' });
  const layer = document.createElement('div');
  root.append(layer);
  for (const field of fields) {
    const box = field.getBoundingClientRect();
    if (!box.width || !box.height) continue;
    shine(layer, field, box, color);
    sparkles(layer, box, color);
  }
  document.documentElement.append(host);
  setTimeout(() => host.remove(), LENGTH + 400);
}
