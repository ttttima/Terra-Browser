// Chrome extensions, installed from the Chrome Web Store ("Add to Chrome"
// works on chromewebstore.google.com). They live in the user data folder
// (Extensions/) and run in the normal session only, never in private tabs.
//
// electron-chrome-web-store handles installing, loading and updating them
// (the only network use: downloading an extension the user added, and
// checking Google for updates to those extensions). electron-chrome-extensions
// gives them the chrome.* APIs a browser has (tabs, action buttons and
// popups, context menus...), which Electron doesn't provide by itself.
import {
  nativeImage,
  session,
  webContents,
  type BaseWindow,
  type Session,
  type WebContents,
} from 'electron';
import { ElectronChromeExtensions } from 'electron-chrome-extensions';
import {
  installChromeWebStore,
  uninstallExtension,
} from 'electron-chrome-web-store';
import path from 'node:path';
import type { ExtensionInfo } from './shared';

export interface ExtensionHooks {
  /** chrome.tabs.create: opens a tab and returns its page and window. */
  createTab: (
    url: string | undefined,
    active: boolean,
  ) => [WebContents, BaseWindow] | null;
  /** chrome.tabs.update({ active: true }) */
  selectTab: (contents: WebContents) => void;
  /** chrome.tabs.remove */
  removeTab: (contents: WebContents) => void;
  /** "Add to Chrome" was clicked: ask before installing. */
  confirmInstall: (
    name: string,
    permissions: string[],
    from: WebContents,
  ) => Promise<boolean>;
  /** An extension was added or removed. */
  changed: () => void;
}

let extensions: ElectronChromeExtensions | null = null;
let ses: Session | null = null;

export async function initExtensions(hooks: ExtensionHooks) {
  ses = session.defaultSession;
  ElectronChromeExtensions.handleCRXProtocol(ses);
  extensions = new ElectronChromeExtensions({
    session: ses,
    createTab: async (details) => {
      const created = hooks.createTab(details.url, details.active !== false);
      if (!created) throw new Error('Could not open a tab');
      return created;
    },
    selectTab: (contents) => hooks.selectTab(contents),
    removeTab: (contents) => hooks.removeTab(contents),
  });
  ses.extensions.on('extension-loaded', hooks.changed);
  ses.extensions.on('extension-unloaded', hooks.changed);
  await installChromeWebStore({
    session: ses,
    beforeInstall: async ({ localizedName, manifest, frame }) => {
      const from = frame && !frame.isDestroyed() ? webContentsOf(frame) : null;
      const permissions = [
        ...((manifest.permissions as string[] | undefined) ?? []),
        ...((manifest.host_permissions as string[] | undefined) ?? []),
      ];
      const ok =
        !!from &&
        (await hooks.confirmInstall(localizedName, permissions, from));
      return { action: ok ? 'allow' : 'deny' };
    },
  });
}

const webContentsOf = (frame: Electron.WebFrameMain) =>
  webContents.fromFrame(frame) ?? null;

/** A tab's page: extensions see it in chrome.tabs. */
export function addExtensionTab(contents: WebContents, window: BaseWindow) {
  if (!extensions || contents.session !== ses) return;
  extensions.addTab(contents, window);
}

/** The tab on screen changed. */
export function selectExtensionTab(contents: WebContents) {
  if (!extensions || contents.session !== ses) return;
  extensions.selectTab(contents);
}

/** Extension items for a page's right-click menu. */
export function extensionMenuItems(
  contents: WebContents,
  params: Electron.ContextMenuParams,
) {
  if (!extensions || contents.session !== ses) return [];
  return extensions.getContextMenuItems(contents, params);
}

/** The installed extensions, for Settings. */
export function listExtensions(): ExtensionInfo[] {
  if (!ses) return [];
  return ses.extensions
    .getAllExtensions()
    .map((ext) => ({
      id: ext.id,
      name: ext.name,
      version: ext.version,
      icon: iconOf(ext),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function iconOf(ext: Electron.Extension) {
  const icons = (ext.manifest as { icons?: Record<string, string> }).icons;
  if (!icons) return '';
  // The smallest icon at least 32px, else the largest there is.
  const sizes = Object.keys(icons)
    .map(Number)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  const size = sizes.find((n) => n >= 32) ?? sizes[sizes.length - 1];
  if (!size) return '';
  const file = path.join(ext.path, icons[String(size)]);
  if (!path.resolve(file).startsWith(path.resolve(ext.path))) return '';
  const image = nativeImage.createFromPath(file);
  return image.isEmpty() ? '' : image.resize({ width: 32 }).toDataURL();
}

export async function removeExtension(id: string) {
  if (!ses || !ses.extensions.getExtension(id)) return;
  await uninstallExtension(id, { session: ses });
}
