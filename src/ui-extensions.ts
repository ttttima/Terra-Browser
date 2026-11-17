// Chrome extensions (see extensions.ts): their buttons in the toolbar, and
// Settings → Features → Extensions, which lists them with a Remove button
// and a link to the Chrome Web Store, where "Add to Chrome" installs one.
import type { ExtensionInfo } from './shared';
import {
  $,
  actionButton,
  emptyState,
  letterBadge,
  listText,
  terra,
} from './ui-common';

const actions = $<HTMLElement>('#extension-actions');
const list = $<HTMLDivElement>('#extensions-list');
const title = $<HTMLElement>('#extensions-title');

function row(ext: ExtensionInfo) {
  const element = document.createElement('div');
  element.className = 'list-row';
  let icon: HTMLElement;
  if (ext.icon) {
    const img = document.createElement('img');
    img.className = 'tab-icon';
    img.alt = '';
    img.src = ext.icon;
    icon = img;
  } else {
    icon = letterBadge(ext.name);
  }
  const buttons = document.createElement('span');
  buttons.className = 'list-actions';
  buttons.append(
    actionButton('remove', 'Remove', () => {
      if (confirm(`Remove ${ext.name}?`)) {
        terra.send('terra:extension-remove', ext.id);
      }
    }),
  );
  element.append(icon, listText(ext.name, `Version ${ext.version}`), buttons);
  return element;
}

async function refresh() {
  let extensions: ExtensionInfo[] = [];
  try {
    extensions = await terra.invoke<ExtensionInfo[]>('terra:extensions');
  } catch {
    // Not ready yet: the next change refreshes.
  }
  actions.hidden = extensions.length === 0;
  title.textContent = `Extensions${extensions.length ? ` (${extensions.length})` : ''}`;
  list.replaceChildren(
    ...(extensions.length
      ? extensions.map(row)
      : [
          emptyState(
            'No extensions yet. Open the Chrome Web Store and click "Add to Terra".',
          ),
        ]),
  );
}

$<HTMLButtonElement>('#open-web-store').addEventListener('click', () =>
  terra.send('terra:open-web-store'),
);
terra.on('terra:extensions-changed', () => void refresh());
void refresh();
