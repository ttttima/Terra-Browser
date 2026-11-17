// Runs inside every website tab before the site's own scripts, in an
// isolated world: the site cannot see or call anything here. It hosts the
// built-in dark mode forcer (here so it can decide before the first paint
// and the page never flashes), the mouse side buttons and the password
// helper.
import { contextBridge, ipcRenderer } from 'electron';
import { initDarkMode, setForceDark } from './dark-mode';

// ---- Google sign-in (see SIGN_IN_URLS in main.ts). Google refuses to sign
// in browsers it takes for an embedded one: there window.chrome is empty
// and the brand list has no "Google Chrome". On accounts.google.com only,
// the page's scripts see what Chrome itself shows them.
function chromeLikeSignIn(version: string) {
  type Brand = { brand: string; version: string };
  const major = version.split('.')[0];
  const w = window as unknown as { chrome?: Record<string, unknown> };
  const chrome = w.chrome ?? {};
  const now = () => Date.now() / 1000;
  chrome.app ??= {
    isInstalled: false,
    InstallState: {
      DISABLED: 'disabled',
      INSTALLED: 'installed',
      NOT_INSTALLED: 'not_installed',
    },
    RunningState: {
      CANNOT_RUN: 'cannot_run',
      READY_TO_RUN: 'ready_to_run',
      RUNNING: 'running',
    },
    getDetails: () => null,
    getIsInstalled: () => false,
    runningState: () => 'cannot_run',
  };
  chrome.csi ??= () => ({
    startE: Math.round(performance.timeOrigin),
    onloadT: Math.round(performance.timeOrigin + performance.now()),
    pageT: performance.now(),
    tran: 15,
  });
  chrome.loadTimes ??= () => ({
    requestTime: performance.timeOrigin / 1000,
    startLoadTime: performance.timeOrigin / 1000,
    commitLoadTime: now(),
    finishDocumentLoadTime: now(),
    finishLoadTime: now(),
    firstPaintTime: now(),
    firstPaintAfterLoadTime: 0,
    navigationType: 'Other',
    wasFetchedViaSpdy: true,
    wasNpnNegotiated: true,
    npnNegotiatedProtocol: 'h2',
    wasAlternateProtocolAvailable: false,
    connectionInfo: 'h2',
  });
  w.chrome = chrome;

  const proto = (
    window as unknown as { NavigatorUAData?: { prototype: object } }
  ).NavigatorUAData?.prototype;
  if (!proto) return;
  const add = (list: Brand[], full: boolean) =>
    list.some((b) => b.brand === 'Google Chrome')
      ? list
      : [...list, { brand: 'Google Chrome', version: full ? version : major }];
  const brands = Object.getOwnPropertyDescriptor(proto, 'brands')?.get;
  if (brands) {
    Object.defineProperty(proto, 'brands', {
      configurable: true,
      enumerable: true,
      get(this: object) {
        return Object.freeze(add(brands.call(this) as Brand[], false));
      },
    });
  }
  const high = (proto as Record<string, unknown>).getHighEntropyValues as (
    hints: string[],
  ) => Promise<Record<string, unknown>>;
  if (typeof high === 'function') {
    (proto as Record<string, unknown>).getHighEntropyValues = function (
      this: object,
      hints: string[],
    ) {
      return high.call(this, hints).then((values) => {
        if (Array.isArray(values.brands)) {
          values.brands = add(values.brands as Brand[], false);
        }
        if (Array.isArray(values.fullVersionList)) {
          values.fullVersionList = add(values.fullVersionList as Brand[], true);
        }
        return values;
      });
    };
  }
}
// The Chrome Web Store too: it only offers "Add to Chrome" to Chrome.
if (
  window === window.top &&
  (location.hostname === 'accounts.google.com' ||
    location.hostname === 'chromewebstore.google.com')
) {
  try {
    contextBridge.executeInMainWorld({
      func: chromeLikeSignIn,
      args: [process.versions.chrome],
    });
  } catch {
    // Not available: sign-in may be refused, nothing else changes.
  }
}

// The dark mode forcer (dark-mode.ts) decides before the first paint.
initDarkMode(ipcRenderer.sendSync('browser:force-dark-get') === true);

// Mouse side buttons (back / forward by default) are user bindings, so
// report them instead of letting the page handle them.
window.addEventListener(
  'mouseup',
  (event) => {
    if (event.button !== 3 && event.button !== 4) return;
    event.preventDefault();
    event.stopPropagation();
    ipcRenderer.send('browser:mouse-button', event.button);
  },
  true,
);

// The setting was switched while the page is open.
ipcRenderer.on('browser:force-dark', (_event, on: unknown) =>
  setForceDark(on === true),
);

// ---------------------------------------------------------------- passwords
//
// Tells Terra when the page shows a sign-in form (so it can offer a saved
// login) and when one is sent (so it can offer to save it). Filling happens
// only after the user clicks "Fill in" in Terra's bar. Only the page itself
// takes part, never frames inside it.

const isTopPage =
  window === window.top && /^https?:$/.test(window.location.protocol);

function visible(element: HTMLElement) {
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0 && !element.closest('[hidden]');
}

function passwordFields(): HTMLInputElement[] {
  return [
    ...document.querySelectorAll<HTMLInputElement>('input[type="password"]'),
  ].filter(visible);
}

/** The username field that belongs to a password field. */
function usernameFor(password: HTMLInputElement): HTMLInputElement | null {
  const scope: ParentNode = password.form ?? document;
  const named = scope.querySelector<HTMLInputElement>(
    'input[autocomplete="username"], input[autocomplete="email"]',
  );
  if (named && visible(named)) return named;
  // Otherwise the last text-like field before the password.
  const inputs = [...scope.querySelectorAll<HTMLInputElement>('input')];
  const before = inputs.slice(0, inputs.indexOf(password)).reverse();
  return (
    before.find(
      (input) =>
        ['text', 'email', 'tel', ''].includes(input.type) && visible(input),
    ) ?? null
  );
}

let formReported = false;
let lastSent = '';

function reportForm() {
  if (formReported || passwordFields().length === 0) return;
  formReported = true;
  ipcRenderer.send('terra:login-form');
}

function captureLogin() {
  const password = passwordFields().find((field) => field.value);
  if (!password) return;
  const username = usernameFor(password)?.value.trim() ?? '';
  const key = `${username}\n${password.value}`;
  if (key === lastSent) return;
  lastSent = key;
  ipcRenderer.send('terra:login-submitted', username, password.value);
}

if (isTopPage) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const check = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      reportForm();
    }, 400);
  };
  window.addEventListener('DOMContentLoaded', () => {
    check();
    new MutationObserver(check).observe(document.body ?? document, {
      childList: true,
      subtree: true,
    });
  });

  // Sent by a form, a button, or Enter in the password field.
  window.addEventListener('submit', captureLogin, true);
  window.addEventListener(
    'click',
    (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('button, input[type="submit"], [role="button"]')) {
        captureLogin();
      }
    },
    true,
  );
  window.addEventListener(
    'keydown',
    (event) => {
      if (
        event.key === 'Enter' &&
        (event.target as HTMLElement)?.matches?.('input')
      ) {
        captureLogin();
      }
    },
    true,
  );

  // The user chose "Fill in" in Terra's bar.
  ipcRenderer.on(
    'terra:login-fill',
    (_event, username: unknown, password: unknown) => {
      if (typeof username !== 'string' || typeof password !== 'string') return;
      const field = passwordFields()[0];
      if (!field) return;
      // Set values the way typing does, so sites built with React etc. notice.
      const setValue = (input: HTMLInputElement, value: string) => {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        )?.set;
        setter?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const user = usernameFor(field);
      if (user && username) setValue(user, username);
      setValue(field, password);
      lastSent = `${username}\n${password}`;
      field.focus();
    },
  );
}
