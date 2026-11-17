// "Force dark mode" (Settings → Features), run by tab-preload.ts inside
// every website before its first paint, in an isolated world.
//
// How it darkens: the page is inverted with a CSS filter and its hues are
// turned back (blue stays blue). One layer caps the lightest colors before
// the inversion, so white becomes a soft gray instead of black. Photos,
// videos, big background pictures and embeds are inverted back so they
// look normal.
//
// What makes it smart:
// - It looks at what's actually on screen (the backgrounds behind a grid
//   of points), not just <body>, so app-like pages that are already dark
//   are left alone, and so are pages that only come in dark (color-scheme).
// - Dark and colored parts of a light page (a dark or blue header, a code
//   block, a colored button, a modal's backdrop) keep their own colors
//   instead of turning light.
// - Small icons and SVG logos stay inverted, so a black logo turns light
//   instead of disappearing into the gray.
// - It looks again once the page has loaded and when a single-page app
//   swaps its content, and marks new content as it appears.

import { DARK_GRAY } from './shared';

/** The lightest color allowed before inverting: 255 - 0x2b, so white
 * ends up as DARK_GRAY. */
const CAP = '#d4d4d4';

const FLIP = 'invert(1) hue-rotate(180deg)';
/** A dark section of a light page: flipped back so it stays dark. */
const KEEP = 'data-terra-keep';
/** A big picture set as a CSS background: flipped back so it looks right. */
const PHOTO = 'data-terra-photo';
/** A small image (icon, logo): stays inverted, so dark turns light. */
const ICON = 'data-terra-icon';
const MEDIA = 'img, video, canvas, iframe, embed, object, picture, svg image';

const DARK_CSS = `
html {
  filter: ${FLIP} !important;
  background-color: #fff !important;
}
${MEDIA}, [${PHOTO}], [${KEEP}] {
  filter: ${FLIP} !important;
}
/* Already flipped back with their section or picture: not twice. */
[${KEEP}] :is(${MEDIA}, [${PHOTO}]),
[${PHOTO}] :is(${MEDIA}),
picture img,
img[${ICON}],
img[src$=".svg" i],
img[src*=".svg?" i] {
  filter: none !important;
}
terra-dark-cap {
  display: block !important;
  position: fixed !important;
  inset: 0 !important;
  z-index: 2147483647 !important;
  background: ${CAP} !important;
  mix-blend-mode: darken !important;
  pointer-events: none !important;
}
`;

/** Shown until we know whether the page is light: never a white flash. */
const WAIT_CSS = `html { background-color: ${DARK_GRAY} !important; }`;

/** A page lighter than this gets darkened. The gap avoids flip-flopping. */
const DARKEN_ABOVE = 0.5;
const RECHECK_MARGIN = 0.15;
/**
 * Darker than this, a section of a light page keeps its own colors:
 * inverted, it would come out lighter than the gray around it (a blue
 * header turning light blue).
 */
const DARK_SECTION = 0.5;
/** Most elements looked at in one go, so huge pages stay fast. */
const SCAN_LIMIT = 4000;

let enabled = false;
let darkened = false;
let darkStyle: HTMLStyleElement | null = null;
let waitStyle: HTMLStyleElement | null = null;
let cap: HTMLElement | null = null;

function addStyle(css: string) {
  const style = document.createElement('style');
  style.textContent = css;
  // Our own element on <html>, so the site's scripts can't easily remove it
  // by rewriting <head>.
  document.documentElement.append(style);
  return style;
}

/** Lightness of a CSS color, 0 = black, 1 = white; null if see-through. */
function lightnessOf(color: string) {
  const parts = color.match(/[\d.]+/g);
  if (!parts) return null;
  const [r, g, b, a = 1] = parts.map(Number);
  if (a < 0.5) return null;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** The first solid background at or above an element. */
function backgroundBehind(element: Element | null): number | null {
  for (let e = element; e; e = e.parentElement) {
    const light = lightnessOf(getComputedStyle(e).backgroundColor);
    if (light !== null) return light;
  }
  return null;
}

/** The page only comes in dark (color-scheme: dark). */
function pageIsDarkOnly() {
  const scheme = getComputedStyle(document.documentElement).colorScheme;
  return /\bdark\b/.test(scheme) && !/\blight\b/.test(scheme);
}

/** How light the page looks: 0 = black, 1 = white. */
function pageLightness() {
  // Measure the site's own colors, not ours.
  if (darkStyle) darkStyle.disabled = true;
  if (waitStyle) waitStyle.disabled = true;
  // With no background of its own, the page shows the browser default.
  const fallback = pageIsDarkOnly() ? 0 : 1;
  const samples: number[] = [];
  const width = window.innerWidth;
  const height = window.innerHeight;
  if (document.body && width > 0 && height > 0) {
    for (const fx of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      for (const fy of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        const element = document.elementFromPoint(width * fx, height * fy);
        samples.push(backgroundBehind(element) ?? fallback);
      }
    }
  }
  if (!samples.length) {
    samples.push(
      backgroundBehind(document.body ?? document.documentElement) ?? fallback,
    );
  }
  if (darkStyle) darkStyle.disabled = false;
  if (waitStyle) waitStyle.disabled = false;
  return samples.reduce((sum, value) => sum + value, 0) / samples.length;
}

const shouldDarken = () => !pageIsDarkOnly() && pageLightness() >= DARKEN_ABOVE;

/**
 * Marks what needs special treatment under (and including) `root`: dark
 * sections, big CSS background pictures and small images.
 */
function mark(root: Element, budget = { left: SCAN_LIMIT }) {
  const visit = (element: Element) => {
    if (budget.left-- <= 0) return;
    if (element.tagName === 'IMG') {
      const { width, height } = element.getBoundingClientRect();
      // Only once it has a size: a loading image measures 0.
      if (width > 0 && width <= 32 && height <= 32) {
        element.setAttribute(ICON, '');
      }
      return;
    }
    const style = getComputedStyle(element);
    const picture = style.backgroundImage.includes('url(');
    const light = lightnessOf(style.backgroundColor);
    const dark = light !== null && light < DARK_SECTION;
    if (!picture && !dark) return;
    if (element.parentElement?.closest(`[${KEEP}], [${PHOTO}]`)) return;
    const { width, height } = element.getBoundingClientRect();
    if (picture && width >= 96 && height >= 96) {
      element.setAttribute(PHOTO, '');
    } else if (dark && width >= 24 && height >= 16) {
      element.setAttribute(KEEP, '');
    }
  };
  visit(root);
  const all = root.getElementsByTagName('*');
  for (let i = 0; i < all.length && budget.left > 0; i++) visit(all[i]);
}

function unmark() {
  for (const element of document.querySelectorAll(
    `[${KEEP}], [${PHOTO}], [${ICON}]`,
  )) {
    element.removeAttribute(KEEP);
    element.removeAttribute(PHOTO);
    element.removeAttribute(ICON);
  }
}

function setDarkened(on: boolean) {
  darkened = on;
  if (on) {
    darkStyle ??= addStyle(DARK_CSS);
    if (!cap) {
      cap = document.createElement('terra-dark-cap');
      cap.ariaHidden = 'true';
      document.documentElement.append(cap);
    }
    if (document.body) mark(document.body);
  } else {
    darkStyle?.remove();
    darkStyle = null;
    cap?.remove();
    cap = null;
    unmark();
  }
}

function stopWaiting() {
  waitStyle?.remove();
  waitStyle = null;
}

/**
 * The tab's own background matches the browser's color mode (so new pages
 * don't flash white). A page that never sets a background expects the
 * browser default instead, so give it that: `Canvas` is white for normal
 * pages and dark for pages that declare a dark color scheme.
 */
function keepDefaultBackground() {
  const clear = (element: Element | null) =>
    !element ||
    /^(transparent|rgba\(0, 0, 0, 0\))$/.test(
      getComputedStyle(element).backgroundColor,
    );
  if (clear(document.documentElement) && clear(document.body)) {
    addStyle(':root { background-color: Canvas; }');
  }
}

/**
 * Called when <body> appears. The site's render-blocking CSS is loaded by
 * then but nothing is painted yet, so the choice is made before the first
 * frame.
 */
function decide() {
  keepDefaultBackground();
  if (!enabled) return;
  setDarkened(shouldDarken());
  stopWaiting();
}

/** Later looks: change the choice only if the page clearly changed. */
function recheck() {
  if (!enabled || !document.body) return;
  const lightness = pageIsDarkOnly() ? 0 : pageLightness();
  if (darkened && lightness < DARKEN_ABOVE - RECHECK_MARGIN) {
    setDarkened(false);
  } else if (!darkened && lightness > DARKEN_ABOVE + RECHECK_MARGIN) {
    setDarkened(true);
  }
}

// New content (infinite feeds, single-page apps): mark what was added, and
// look at the whole page again once things settle.
let added: Element[] = [];
let settleTimer: ReturnType<typeof setTimeout> | null = null;
const observer = new MutationObserver((mutations) => {
  if (!enabled) return;
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node instanceof Element && node.tagName !== 'TERRA-DARK-CAP') {
        added.push(node);
      }
    }
  }
  if (!added.length) return;
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    settleTimer = null;
    const nodes = added;
    added = [];
    recheck();
    if (!darkened) return;
    const budget = { left: SCAN_LIMIT };
    for (const node of nodes) if (node.isConnected) mark(node, budget);
  }, 500);
});

function start() {
  if (enabled) waitStyle = addStyle(WAIT_CSS);
  const begin = () => {
    decide();
    observer.observe(document.body, { childList: true, subtree: true });
  };
  if (document.body) {
    begin();
    return;
  }
  const waitForBody = new MutationObserver(() => {
    if (!document.body) return;
    waitForBody.disconnect();
    begin();
  });
  waitForBody.observe(document, { childList: true, subtree: true });
}

/** Starts the forcer in this page (`on`: the setting is on). */
export function initDarkMode(on: boolean) {
  enabled = on;
  if (document.documentElement) {
    start();
  } else {
    // Very early: wait for <html> to exist.
    const waitForRoot = new MutationObserver(() => {
      if (!document.documentElement) return;
      waitForRoot.disconnect();
      start();
    });
    waitForRoot.observe(document, { childList: true });
  }
  window.addEventListener('load', () => {
    setTimeout(recheck, 300);
    // Images have sizes now; late styles have arrived.
    setTimeout(() => {
      recheck();
      if (darkened && document.body) mark(document.body);
    }, 1500);
  });
  // Single-page apps going to another "page".
  window.addEventListener('popstate', () => setTimeout(recheck, 500));
}

/** The setting was switched while the page is open. */
export function setForceDark(on: boolean) {
  enabled = on;
  if (!enabled) {
    stopWaiting();
    setDarkened(false);
  } else if (document.body) {
    setDarkened(shouldDarken());
  }
}
