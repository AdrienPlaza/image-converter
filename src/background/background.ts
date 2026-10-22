/**
 * Service worker: “Convert this image” context menu.
 *
 * Flow without broad permissions:
 * 1. image click → stores the URL (chrome.storage.session);
 * 2. opens the popup (Chrome 127+); on failure, badge “1”;
 * 3. the popup requests the bytes; we try a fetch in the tab via
 *    activeTab (including cookies), then a direct fetch from the worker.
 *    Failures are always explicit (never an empty image).
 */
import { MSG_FETCH_PENDING_IMAGE, type FetchPendingImageResponse } from '../core/messages';
import { loadSettings } from '../core/settings';
import { bytesToBase64 } from '../core/util';

const MENU_ID = 'convert-image';
const PENDING_KEY = 'pendingImage';
const BADGE_COLOR = '#0ea5e9';

interface PendingImage {
  url: string;
  name: string;
  tabId?: number;
}

interface FetchResult {
  ok: boolean;
  base64?: string;
  mime?: string;
  error?: string;
}

let currentMenuTitle = '';

function nameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const last = decodeURIComponent(parsed.pathname.split('/').pop() ?? '');
    return last || 'image';
  } catch {
    return 'image';
  }
}

function isFetchableUrl(url: string): boolean {
  return /^(https?|data|blob):/i.test(url);
}

/** Builds the menu title for the selected language (fr/en). */
async function syncContextMenu(): Promise<void> {
  const settings = await loadSettings();
  const language =
    settings.language === 'fr' || settings.language === 'en'
      ? settings.language
      : chrome.i18n.getUILanguage().toLowerCase().startsWith('fr')
        ? 'fr'
        : 'en';
  const title = language === 'fr' ? 'Convertir cette image' : 'Convert this image';
  if (title === currentMenuTitle) return;
  currentMenuTitle = title;

  await new Promise<void>((resolve) => chrome.contextMenus.removeAll(() => resolve()));
  chrome.contextMenus.create({ id: MENU_ID, title, contexts: ['image'] }, () => {
    void chrome.runtime.lastError;
  });
}

/**
 * Runs IN the page (activeTab). Self-contained function: no imports, no
 * external variables — `chrome.scripting` serializes its source code.
 */
async function fetchImageInPage(url: string): Promise<FetchResult> {
  try {
    const response = await fetch(url, {
      credentials: 'include',
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };

    const blob = await response.blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return {
      ok: true,
      base64: btoa(binary),
      mime: blob.type || response.headers.get('content-type') || '',
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function fetchFromWorker(url: string): Promise<FetchResult> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    const blob = await response.blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return {
      ok: true,
      base64: bytesToBase64(bytes),
      mime: blob.type || response.headers.get('content-type') || '',
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function takePendingImage(): Promise<FetchPendingImageResponse> {
  const stored = await chrome.storage.session.get(PENDING_KEY);
  const pending = stored[PENDING_KEY] as PendingImage | undefined;
  if (!pending) return { ok: false, error: 'no-pending-image' };

  // Consumed once, even on failure (prevents loops).
  await chrome.storage.session.remove(PENDING_KEY);

  if (!isFetchableUrl(pending.url)) {
    return { ok: false, name: pending.name, error: 'unsupported-url' };
  }

  let fetched: FetchResult | undefined;
  if (pending.tabId !== undefined) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: pending.tabId },
        func: fetchImageInPage,
        args: [pending.url],
      });
      fetched = results[0]?.result;
    } catch {
      // Closed tab, navigation, chrome:// page… → worker fallback.
    }
  }
  if (!fetched?.ok) fetched = await fetchFromWorker(pending.url);

  if (!fetched.ok || !fetched.base64) {
    return { ok: false, name: pending.name, error: fetched.error ?? 'empty-response' };
  }
  return { ok: true, name: pending.name, mime: fetched.mime, base64: fetched.base64 };
}

chrome.runtime.onInstalled.addListener(() => {
  void syncContextMenu();
});

chrome.runtime.onStartup.addListener(() => {
  void syncContextMenu();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && changes.settings) void syncContextMenu();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !info.srcUrl) return;

  const pending: PendingImage = {
    url: info.srcUrl,
    name: nameFromUrl(info.srcUrl),
    tabId: tab?.id,
  };

  void (async () => {
    await chrome.storage.session.set({ [PENDING_KEY]: pending });
    try {
      await chrome.action.openPopup();
    } catch {
      await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
      await chrome.action.setBadgeText({ text: '1' });
      await chrome.action.setTitle({
        title:
          chrome.i18n.getUILanguage().toLowerCase().startsWith('fr')
            ? 'Image en attente : ouvrez le popup'
            : 'Image pending: open the popup',
      });
    }
  })();
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (
    !message ||
    typeof message !== 'object' ||
    (message as { type?: unknown }).type !== MSG_FETCH_PENDING_IMAGE
  ) {
    return false;
  }

  void takePendingImage()
    .then(sendResponse)
    .catch((error: unknown) =>
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  return true;
});
