/**
 * Popup controller: queue, settings, preview and outputs.
 *
 * Every conversion goes through the Web Worker (`ConversionWorker`): the UI
 * never decodes an image itself. One heavy conversion at a time;
 * the preview is debounced and cancelled whenever a setting changes.
 */
import {
  ACCEPT_ATTRIBUTE,
  FORMATS,
  OUTPUT_FORMATS,
  detectInput,
  type FormatId,
} from '../core/formats';
import type { ConversionOptions } from '../core/converter';
import {
  ConversionError,
  serializeError,
  toConversionError,
  type SerializedError,
} from '../core/errors';
import {
  copyPngToClipboard,
  downloadBytes,
  downloadZip,
  type ZipEntry,
} from '../core/output';
import { uniqueFileName } from '../core/naming';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type Language,
  type Settings,
} from '../core/settings';
import { base64ToBytes, clamp, formatBytes, normalizeHexColor } from '../core/util';
import { ConversionWorker } from '../core/workerClient';
import { MSG_FETCH_PENDING_IMAGE, type FetchPendingImageResponse } from '../core/messages';
import type { WorkerResultPayload } from '../core/worker';
import {
  applyTranslations,
  getLocale,
  localizeError,
  localizeWarning,
  resolveLocale,
  setLocale,
  t,
  tn,
} from '../i18n';

type ItemStatus = 'pending' | 'converting' | 'done' | 'error' | 'cancelled';

interface QueueItem {
  id: number;
  name: string;
  mime: string;
  bytes: Uint8Array;
  size: number;
  sourceFormat: FormatId;
  previewUrl: string;
  status: ItemStatus;
  progress: number;
  result?: WorkerResultPayload;
  /** Options key that produced `result` (lets us reuse the preview). */
  resultOptions?: string;
  error?: SerializedError;
}

interface PreviewState {
  itemId: number;
  result: WorkerResultPayload;
  options: string;
  url: string;
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

const ui = {
  language: byId<HTMLSelectElement>('language'),
  dropzone: byId<HTMLDivElement>('dropzone'),
  pick: byId<HTMLButtonElement>('pick'),
  fileInput: byId<HTMLInputElement>('file-input'),
  queueEmpty: byId<HTMLParagraphElement>('queue-empty'),
  queue: byId<HTMLUListElement>('queue'),
  queueCount: byId<HTMLSpanElement>('queue-count'),
  batchBar: byId<HTMLDivElement>('batch-bar'),
  batchProgress: byId<HTMLProgressElement>('batch-progress'),
  batchLabel: byId<HTMLSpanElement>('batch-label'),
  cancel: byId<HTMLButtonElement>('cancel'),
  clear: byId<HTMLButtonElement>('clear'),
  convert: byId<HTMLButtonElement>('convert'),
  downloadAll: byId<HTMLButtonElement>('download-all'),
  format: byId<HTMLSelectElement>('format'),
  keepAnimationField: byId<HTMLDivElement>('keep-animation-field'),
  keepAnimation: byId<HTMLInputElement>('keep-animation'),
  qualityField: byId<HTMLDivElement>('quality-field'),
  quality: byId<HTMLInputElement>('quality'),
  qualityValue: byId<HTMLOutputElement>('quality-value'),
  effortField: byId<HTMLDivElement>('effort-field'),
  effort: byId<HTMLInputElement>('effort'),
  effortValue: byId<HTMLOutputElement>('effort-value'),
  resizeEnabled: byId<HTMLInputElement>('resize-enabled'),
  resizeWidth: byId<HTMLInputElement>('resize-width'),
  resizeHeight: byId<HTMLInputElement>('resize-height'),
  keepRatio: byId<HTMLInputElement>('keep-ratio'),
  backgroundField: byId<HTMLDivElement>('background-field'),
  keepTransparency: byId<HTMLInputElement>('keep-transparency'),
  background: byId<HTMLInputElement>('background'),
  backgroundValue: byId<HTMLElement>('background-value'),
  removeMetadata: byId<HTMLInputElement>('remove-metadata'),
  namePattern: byId<HTMLInputElement>('name-pattern'),
  beforeImg: byId<HTMLImageElement>('before-img'),
  beforeMeta: byId<HTMLParagraphElement>('before-meta'),
  afterImg: byId<HTMLImageElement>('after-img'),
  afterMeta: byId<HTMLParagraphElement>('after-meta'),
  previewStatus: byId<HTMLParagraphElement>('preview-status'),
  warningsBlock: byId<HTMLDivElement>('warnings-block'),
  warnings: byId<HTMLUListElement>('warnings'),
  copy: byId<HTMLButtonElement>('copy'),
  download: byId<HTMLButtonElement>('download'),
  toasts: byId<HTMLDivElement>('toasts'),
};

const worker = new ConversionWorker();
let settings: Settings = { ...DEFAULT_SETTINGS, resize: { ...DEFAULT_SETTINGS.resize } };
let items: QueueItem[] = [];
let selectedId: number | null = null;
let nextItemId = 1;
let busy = false;
let cancelling = false;
let batchAbort: AbortController | null = null;
let previewState: PreviewState | null = null;
let previewTimer: number | undefined;
let previewSeq = 0;
let previewBusy = false;
let saveTimer: number | undefined;

function sizeLabel(bytes: number): string {
  return formatBytes(bytes, getLocale());
}

function selectedItem(): QueueItem | null {
  return items.find((item) => item.id === selectedId) ?? null;
}

function itemIndex(item: QueueItem): number {
  return items.indexOf(item);
}

/** Options snapshot for an item (1-based index for {index}). */
function toConversionOptions(index: number): ConversionOptions {
  return {
    target: settings.target,
    quality: settings.quality,
    effort: settings.effort,
    resize: { ...settings.resize },
    background: settings.background,
    keepTransparency: settings.keepTransparency,
    removeMetadata: settings.removeMetadata,
    keepAnimation: settings.keepAnimation,
    namePattern: settings.namePattern,
    index,
  };
}

function optionsForItem(item: QueueItem): ConversionOptions {
  return toConversionOptions(itemIndex(item) + 1);
}

function optionsKey(options: ConversionOptions): string {
  return JSON.stringify(options);
}

function formatLabelFromExt(ext: string): string {
  const found = Object.values(FORMATS).find((format) => format.ext === ext);
  return found?.label ?? ext.toUpperCase();
}

function toast(message: string, type: 'info' | 'error' = 'info'): void {
  while (ui.toasts.children.length >= 4) ui.toasts.firstElementChild?.remove();

  const element = document.createElement('div');
  element.className = `toast${type === 'error' ? ' error' : ''}`;
  element.textContent = message;
  ui.toasts.append(element);
  requestAnimationFrame(() => element.classList.add('visible'));

  window.setTimeout(
    () => {
      element.classList.remove('visible');
      window.setTimeout(() => element.remove(), 220);
    },
    type === 'error' ? 6000 : 3500,
  );
}

function showError(error: unknown): void {
  toast(t('toast.error', { message: localizeError(toConversionError(error)) }), 'error');
}

function clearBadge(): void {
  try {
    void chrome.action.setBadgeText({ text: '' });
    void chrome.action.setTitle({ title: 'Image Converter' });
  } catch {
    // API missing (tests): no effect.
  }
}

function populateLanguage(): void {
  ui.language.replaceChildren();
  for (const value of ['auto', 'fr', 'en'] as const) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = t(`lang.${value}`);
    ui.language.append(option);
  }
  ui.language.value = settings.language;
}

function populateFormat(): void {
  ui.format.replaceChildren();
  for (const id of OUTPUT_FORMATS) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = t(`formats.${id}`);
    ui.format.append(option);
  }
  ui.format.value = settings.target;
}

function applySettingsToControls(): void {
  ui.fileInput.accept = ACCEPT_ATTRIBUTE;
  ui.language.value = settings.language;
  ui.format.value = settings.target;
  ui.keepAnimation.checked = settings.keepAnimation;
  ui.quality.value = String(settings.quality);
  ui.qualityValue.textContent = String(settings.quality);
  ui.effort.value = String(settings.effort);
  ui.effortValue.textContent = String(settings.effort);
  ui.resizeEnabled.checked = settings.resize.enabled;
  ui.resizeWidth.value = settings.resize.width === null ? '' : String(settings.resize.width);
  ui.resizeHeight.value = settings.resize.height === null ? '' : String(settings.resize.height);
  ui.keepRatio.checked = settings.resize.keepRatio;
  ui.keepTransparency.checked = settings.keepTransparency;
  ui.background.value = settings.background;
  ui.backgroundValue.textContent = settings.background;
  ui.removeMetadata.checked = settings.removeMetadata;
  ui.namePattern.value = settings.namePattern;
}

function readSettingsFromControls(): Settings {
  const width = ui.resizeWidth.value.trim();
  const height = ui.resizeHeight.value.trim();
  const parsedWidth = width ? Number.parseInt(width, 10) : null;
  const parsedHeight = height ? Number.parseInt(height, 10) : null;
  const target = OUTPUT_FORMATS.includes(ui.format.value as FormatId)
    ? (ui.format.value as FormatId)
    : settings.target;
  const supportsAlpha = FORMATS[target].supportsAlpha;
  const previousSupportsAlpha = FORMATS[settings.target].supportsAlpha;

  return {
    language: (['auto', 'fr', 'en'] as const).includes(ui.language.value as Language)
      ? (ui.language.value as Language)
      : settings.language,
    target,
    quality: Math.round(clamp(Number(ui.quality.value) || 90, 1, 100)),
    effort: Math.round(clamp(Number(ui.effort.value) || 6, 1, 10)),
    resize: {
      enabled: ui.resizeEnabled.checked,
      width: parsedWidth && parsedWidth > 0 ? parsedWidth : null,
      height: parsedHeight && parsedHeight > 0 ? parsedHeight : null,
      keepRatio: ui.keepRatio.checked,
    },
    background: normalizeHexColor(ui.background.value),
    keepTransparency:
      !supportsAlpha || !previousSupportsAlpha
        ? settings.keepTransparency
        : ui.keepTransparency.checked,
    removeMetadata: ui.removeMetadata.checked,
    keepAnimation: ui.keepAnimation.checked,
    namePattern: ui.namePattern.value.trim() || DEFAULT_SETTINGS.namePattern,
  };
}

function syncOutputs(): void {
  const supportsAlpha = FORMATS[settings.target].supportsAlpha;
  ui.keepAnimationField.hidden = settings.target !== 'gif';
  ui.qualityField.hidden = !FORMATS[settings.target].quality;
  ui.effortField.hidden = settings.target !== 'avif';
  ui.backgroundField.hidden = false;
  ui.keepTransparency.checked = supportsAlpha ? settings.keepTransparency : false;
  ui.qualityValue.textContent = String(settings.quality);
  ui.effortValue.textContent = String(settings.effort);
  ui.backgroundValue.textContent = settings.background;
}

function syncControlStates(): void {
  const hasItems = items.length > 0;
  const previewReady = previewState !== null && selectedItem() !== null && !busy;

  ui.language.disabled = busy;
  ui.format.disabled = busy;
  ui.keepAnimation.disabled = busy;
  ui.quality.disabled = busy;
  ui.effort.disabled = busy;
  ui.resizeEnabled.disabled = busy;
  ui.keepTransparency.disabled = busy || !FORMATS[settings.target].supportsAlpha;
  ui.background.disabled =
    busy || (FORMATS[settings.target].supportsAlpha && settings.keepTransparency);
  ui.removeMetadata.disabled = busy;
  ui.namePattern.disabled = busy;
  ui.resizeWidth.disabled = busy || !settings.resize.enabled;
  ui.resizeHeight.disabled = busy || !settings.resize.enabled;
  ui.keepRatio.disabled = busy || !settings.resize.enabled;

  ui.convert.disabled = busy || !hasItems;
  ui.clear.disabled = busy || !hasItems;
  ui.cancel.disabled = !busy || cancelling;
  ui.downloadAll.disabled = busy;
  ui.copy.disabled = !previewReady;
  ui.download.disabled = !previewReady;

  ui.dropzone.setAttribute('aria-disabled', busy ? 'true' : 'false');
  ui.pick.disabled = busy;
  ui.batchBar.hidden = !busy;
}

function scheduleSave(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void saveSettings(settings);
  }, 300);
}

const ICONS = {
  download:
    '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 21h16"/>',
  copy:
    '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  remove: '<path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="m6 7 1 13h10l1-13"/><path d="M9 7V4h6v3"/>',
} as const;

function iconButton(
  action: string,
  label: string,
  icon: keyof typeof ICONS,
  danger = false,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `icon-btn${danger ? ' danger' : ''}`;
  button.dataset.action = action;
  button.setAttribute('aria-label', label);
  button.title = label;
  button.disabled = busy;
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[icon]}</svg>`;
  return button;
}

function statusLabel(item: QueueItem): string {
  switch (item.status) {
    case 'converting':
      return t('item.status.converting', { percent: Math.round(item.progress * 100) });
    case 'done':
      return t('item.status.done');
    case 'cancelled':
      return t('item.status.cancelled');
    case 'error':
      return item.error ? localizeError(item.error) : t('errors.unknown');
    default:
      return t('item.status.pending');
  }
}

function buildQueueItem(item: QueueItem): HTMLLIElement {
  const row = document.createElement('li');
  row.className = `queue-item${item.id === selectedId ? ' selected' : ''}`;
  row.dataset.id = String(item.id);

  const thumb = document.createElement('img');
  thumb.className = 'thumb';
  thumb.src = item.previewUrl;
  thumb.alt = '';
  thumb.draggable = false;

  const main = document.createElement('div');
  main.className = 'item-main';

  const name = document.createElement('button');
  name.type = 'button';
  name.className = 'item-name';
  name.textContent = item.name;
  name.title = item.name;
  name.dataset.action = 'select';
  name.setAttribute('aria-label', t('item.select', { name: item.name }));

  const meta = document.createElement('span');
  meta.className = 'item-meta';
  meta.textContent =
    item.status === 'done' && item.result
      ? t('item.doneMeta', {
          width: item.result.width,
          height: item.result.height,
          size: sizeLabel(item.result.bytes.byteLength),
        })
      : t('item.meta', { format: FORMATS[item.sourceFormat].label, size: sizeLabel(item.size) });

  const status = document.createElement('span');
  status.className = `item-status${item.status === 'done' ? ' done' : ''}${
    item.status === 'error' ? ' error' : ''
  }`;
  status.textContent = statusLabel(item);

  main.append(name, meta, status);

  if (item.status === 'converting') {
    const progress = document.createElement('progress');
    progress.className = 'item-progress';
    progress.max = 100;
    progress.value = Math.round(item.progress * 100);
    progress.setAttribute('aria-hidden', 'true');
    main.append(progress);
  }

  const actions = document.createElement('div');
  actions.className = 'item-actions';
  if (item.status === 'done' && item.result) {
    actions.append(
      iconButton('download', t('item.download', { name: item.name }), 'download'),
      iconButton('copy', t('item.copy', { name: item.name }), 'copy'),
    );
  }
  actions.append(iconButton('remove', t('item.remove', { name: item.name }), 'remove', true));

  row.append(thumb, main, actions);
  return row;
}

function renderQueue(): void {
  ui.queue.replaceChildren(...items.map(buildQueueItem));
  ui.queueEmpty.hidden = items.length > 0;
  ui.queueCount.textContent = String(items.length);
  ui.downloadAll.hidden = items.every((item) => !(item.status === 'done' && item.result));
  ui.downloadAll.textContent =
    items.filter((item) => item.status === 'done' && item.result).length > 1
      ? t('queue.downloadAllZip')
      : t('queue.downloadAll');
}

function createQueueItem(
  bytes: Uint8Array,
  name: string,
  mime: string,
  sourceFormat: FormatId,
): QueueItem {
  return {
    id: nextItemId++,
    name,
    mime,
    bytes,
    size: bytes.byteLength,
    sourceFormat,
    previewUrl: URL.createObjectURL(
      new Blob([bytes.slice().buffer], { type: mime || FORMATS[sourceFormat].mime }),
    ),
    status: 'pending',
    progress: 0,
  };
}

async function addFiles(files: FileList | File[]): Promise<void> {
  if (busy) return;

  let added = 0;
  let skipped = 0;
  let heic = 0;

  for (const file of Array.from(files)) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!bytes.byteLength) {
        skipped++;
        continue;
      }
      const detection = detectInput(bytes, file.name, file.type);
      if (!detection.format) {
        skipped++;
        continue;
      }
      if (detection.format === 'heic') {
        heic++;
        continue;
      }

      const mime = file.type || FORMATS[detection.format].mime;
      const item = createQueueItem(bytes, file.name, mime, detection.format);
      items.push(item);
      if (selectedId === null) selectedId = item.id;
      added++;
    } catch {
      skipped++;
    }
  }

  renderQueue();
  syncControlStates();
  updateDownloadAll();
  if (selectedId !== null) showSelectedPreview();

  if (added > 0) toast(tn('toast.added', added));
  if (heic > 0) {
    toast(localizeError(new ConversionError('heic-unsupported')), 'error');
  }
  if (skipped > 0) toast(tn('toast.skipped', skipped), 'error');
}

function updateItemProgress(id: number, ratio: number): void {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) return;
  item.progress = clamp(ratio, 0, 1);

  const row = ui.queue.querySelector<HTMLLIElement>(`li[data-id="${id}"]`);
  if (!row) return;
  const status = row.querySelector<HTMLElement>('.item-status');
  if (status) status.textContent = statusLabel(item);
  const progress = row.querySelector<HTMLProgressElement>('.item-progress');
  if (progress) progress.value = Math.round(item.progress * 100);
}

function setBatchProgress(completed: number, total: number): void {
  ui.batchProgress.max = Math.max(total, 1);
  ui.batchProgress.value = completed;
  ui.batchLabel.textContent = `${completed} / ${total}`;
}

function updateDownloadAll(): void {
  const done = items.filter((item) => item.status === 'done' && item.result);
  ui.downloadAll.hidden = done.length === 0;
  ui.downloadAll.textContent =
    done.length > 1 ? t('queue.downloadAllZip') : t('queue.downloadAll');
  ui.downloadAll.disabled = busy;
}

function removeItem(id: number): void {
  if (busy) return;
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return;

  const [removed] = items.splice(index, 1);
  if (removed) URL.revokeObjectURL(removed.previewUrl);
  if (previewState?.itemId === id) resetPreviewState();

  if (selectedId === id) {
    selectedId = items[Math.min(index, items.length - 1)]?.id ?? null;
  }

  renderQueue();
  syncControlStates();
  updateDownloadAll();
  showSelectedPreview();
  toast(t('toast.removed'));
}

function clearQueue(): void {
  if (busy || items.length === 0) return;
  for (const item of items) URL.revokeObjectURL(item.previewUrl);
  items = [];
  selectedId = null;
  resetPreviewState();
  renderQueue();
  syncControlStates();
  updateDownloadAll();
  showSelectedPreview();
}

function selectItem(id: number): void {
  if (busy || selectedId === id) return;
  selectedId = id;
  resetPreviewState();
  renderQueue();
  showSelectedPreview();
}

async function convertAll(): Promise<void> {
  if (busy || items.length === 0) return;

  stopPreview();
  busy = true;
  cancelling = false;
  batchAbort = new AbortController();
  const signal = batchAbort.signal;
  const total = items.length;

  for (const item of items) {
    item.status = 'pending';
    item.progress = 0;
    item.result = undefined;
    item.resultOptions = undefined;
    item.error = undefined;
  }

  setBatchProgress(0, total);
  ui.batchBar.hidden = false;
  syncControlStates();
  renderQueue();

  let errors = 0;
  let processed = 0;
  let cancelled = false;

  for (const item of items) {
    if (signal.aborted) {
      cancelled = true;
      break;
    }

    item.status = 'converting';
    item.progress = 0;
    renderQueue();

    try {
      const options = optionsForItem(item);
      const result = await worker.convert(
        { bytes: item.bytes, fileName: item.name, mime: item.mime },
        options,
        (_stage, ratio) => updateItemProgress(item.id, ratio),
        signal,
      );
      item.result = result;
      item.resultOptions = optionsKey(options);
      item.status = 'done';
      item.progress = 1;
    } catch (error) {
      const normalized = toConversionError(error);
      if (normalized.code === 'cancelled') {
        item.status = 'cancelled';
        cancelled = true;
      } else {
        item.status = 'error';
        item.error = serializeError(normalized);
        errors++;
      }
    }

    processed++;
    setBatchProgress(processed, total);
    renderQueue();
    updateDownloadAll();
    if (selectedId === item.id) showSelectedPreview();
    if (cancelled) break;
  }

  const wasCancelled = signal.aborted || cancelled;
  busy = false;
  cancelling = false;
  batchAbort = null;
  syncControlStates();
  renderQueue();
  updateDownloadAll();
  showSelectedPreview();

  if (wasCancelled) {
    toast(t('toast.cancelled'));
  } else if (errors > 0) {
    toast(tn('toast.convertErrors', errors), 'error');
  } else {
    toast(t('toast.convertDone'));
  }
}

function cancelBatch(): void {
  if (!busy || cancelling) return;
  cancelling = true;
  syncControlStates();
  batchAbort?.abort();
}

function stopPreview(): void {
  window.clearTimeout(previewTimer);
  previewTimer = undefined;
  previewSeq++;
  if (previewBusy) {
    previewBusy = false;
    worker.cancelAll();
  }
}

function clearPreviewVisual(): void {
  ui.afterImg.hidden = true;
  ui.afterImg.removeAttribute('src');
  ui.afterMeta.textContent = '—';
  ui.warnings.replaceChildren();
  ui.warningsBlock.hidden = true;
  updatePreviewActions();
}

function resetPreviewState(): void {
  if (previewState) {
    URL.revokeObjectURL(previewState.url);
    previewState = null;
  }
  clearPreviewVisual();
}

function setPreviewStatus(text: string, isError = false): void {
  ui.previewStatus.textContent = text;
  ui.previewStatus.classList.toggle('error', isError);
}

function updatePreviewActions(): void {
  const item = selectedItem();
  const ready =
    !busy &&
    item !== null &&
    previewState !== null &&
    previewState.itemId === item.id &&
    previewState.options === optionsKey(optionsForItem(item));
  ui.copy.disabled = !ready;
  ui.download.disabled = !ready;
}

function renderBefore(item: QueueItem | null): void {
  if (!item) {
    ui.beforeImg.hidden = true;
    ui.beforeImg.removeAttribute('src');
    ui.beforeMeta.textContent = '—';
    return;
  }

  ui.beforeImg.src = item.previewUrl;
  ui.beforeImg.hidden = false;
  ui.beforeImg.alt = t('preview.beforeAlt', { name: item.name });
  ui.beforeMeta.textContent = t('item.meta', {
    format: FORMATS[item.sourceFormat].label,
    size: sizeLabel(item.size),
  });
  ui.beforeImg.onload = () => {
    ui.beforeMeta.textContent = t('preview.meta', {
      format: FORMATS[item.sourceFormat].label,
      width: ui.beforeImg.naturalWidth,
      height: ui.beforeImg.naturalHeight,
      size: sizeLabel(item.size),
    });
  };
}

function renderPreviewFromState(): void {
  if (!previewState) return;
  const state = previewState;
  const item = items.find((candidate) => candidate.id === state.itemId);

  ui.afterImg.src = state.url;
  ui.afterImg.hidden = false;
  ui.afterImg.alt = t('preview.afterAlt', {
    name: item?.name ?? state.result.fileName,
  });
  ui.afterMeta.textContent = t('preview.meta', {
    format: formatLabelFromExt(state.result.ext),
    width: state.result.width,
    height: state.result.height,
    size: sizeLabel(state.result.bytes.byteLength),
  });

  ui.warnings.replaceChildren();
  for (const warning of state.result.warnings) {
    const entry = document.createElement('li');
    entry.textContent = localizeWarning(warning);
    ui.warnings.append(entry);
  }
  ui.warningsBlock.hidden = state.result.warnings.length === 0;
  setPreviewStatus(t('preview.ready'));
  updatePreviewActions();
}

function adoptPreview(itemId: number, result: WorkerResultPayload, key: string): void {
  if (previewState) URL.revokeObjectURL(previewState.url);
  const url = URL.createObjectURL(new Blob([result.bytes], { type: result.mime }));
  previewState = { itemId, result, options: key, url };
  renderPreviewFromState();
}

function showPreviewError(error: unknown): void {
  resetPreviewState();
  setPreviewStatus(
    t('toast.previewError', { message: localizeError(toConversionError(error)) }),
    true,
  );
  updatePreviewActions();
}

function schedulePreview(delay = 400): void {
  const seq = ++previewSeq;
  window.clearTimeout(previewTimer);
  if (previewBusy) {
    previewBusy = false;
    worker.cancelAll();
  }
  previewTimer = window.setTimeout(() => {
    void runPreview(seq);
  }, delay);
}

async function runPreview(seq: number): Promise<void> {
  if (seq !== previewSeq || busy) return;
  const item = selectedItem();
  if (!item) return;

  const options = optionsForItem(item);
  const key = optionsKey(options);

  if (item.result && item.resultOptions === key) {
    adoptPreview(item.id, item.result, key);
    return;
  }
  if (previewState && previewState.itemId === item.id && previewState.options === key) {
    renderPreviewFromState();
    return;
  }

  previewBusy = true;
  setPreviewStatus(t('preview.working'));

  try {
    const result = await worker.convert(
      { bytes: item.bytes, fileName: item.name, mime: item.mime },
      options,
      (_stage, ratio) => {
        if (seq !== previewSeq || busy) return;
        ui.previewStatus.textContent = `${t('preview.working')} ${Math.round(ratio * 100)} %`;
      },
    );

    if (seq !== previewSeq || busy) return;
    adoptPreview(item.id, result, key);
  } catch (error) {
    if (seq !== previewSeq || busy) return;
    const normalized = toConversionError(error);
    if (normalized.code === 'cancelled') return;
    showPreviewError(normalized);
  } finally {
    if (seq === previewSeq) previewBusy = false;
  }
}

function showSelectedPreview(): void {
  const item = selectedItem();
  renderBefore(item);

  if (!item) {
    stopPreview();
    resetPreviewState();
    setPreviewStatus(t('preview.empty'));
    updatePreviewActions();
    return;
  }

  const options = optionsForItem(item);
  const key = optionsKey(options);

  if (item.result && item.resultOptions === key) {
    adoptPreview(item.id, item.result, key);
    return;
  }
  if (previewState && previewState.itemId === item.id && previewState.options === key) {
    renderPreviewFromState();
    return;
  }

  resetPreviewState();
  setPreviewStatus(t('preview.working'));
  schedulePreview(400);
}

async function downloadResult(result: WorkerResultPayload): Promise<void> {
  try {
    await downloadBytes(new Uint8Array(result.bytes), result.mime, result.fileName);
    toast(t('toast.downloadStarted'));
  } catch (error) {
    showError(error);
  }
}

async function downloadItem(id: number): Promise<void> {
  const item = items.find((candidate) => candidate.id === id);
  if (item?.result) await downloadResult(item.result);
}

async function downloadAllResults(): Promise<void> {
  const done = items.filter((item) => item.status === 'done' && item.result);
  if (done.length === 0) {
    toast(t('toast.nothingToDownload'), 'error');
    return;
  }
  if (done.length === 1) {
    const result = done[0]?.result;
    if (result) await downloadResult(result);
    return;
  }

  const used = new Set<string>();
  const entries: ZipEntry[] = done.map((item) => {
    const result = item.result as WorkerResultPayload;
    return {
      name: uniqueFileName(result.fileName, used),
      bytes: new Uint8Array(result.bytes),
    };
  });

  try {
    await downloadZip(t('zip.fileName'), entries);
    toast(tn('toast.zipStarted', entries.length));
  } catch (error) {
    showError(error);
  }
}

async function copyResult(result: WorkerResultPayload): Promise<void> {
  try {
    let png: Uint8Array;
    let reencoded = false;

    if (result.mime === 'image/png') {
      png = new Uint8Array(result.bytes);
    } else {
      toast(t('toast.copyPreparing'));
      const options: ConversionOptions = {
        target: 'png',
        quality: 90,
        effort: 1,
        resize: { enabled: false, width: null, height: null, keepRatio: true },
        background: settings.background,
        keepTransparency: true,
        removeMetadata: true,
        keepAnimation: false,
        namePattern: '{name}.png',
        index: 1,
      };
      const converted = await worker.convert(
        {
          bytes: new Uint8Array(result.bytes),
          fileName: result.fileName,
          mime: result.mime,
        },
        options,
      );
      png = new Uint8Array(converted.bytes);
      reencoded = true;
    }

    await copyPngToClipboard(png);
    toast(t(reencoded ? 'toast.copiedPng' : 'toast.copied'));
  } catch (error) {
    showError(error);
  }
}

async function copyItem(id: number): Promise<void> {
  const item = items.find((candidate) => candidate.id === id);
  if (item?.result) await copyResult(item.result);
}

function requestPendingImage(): Promise<FetchPendingImageResponse | undefined> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        { type: MSG_FETCH_PENDING_IMAGE },
        (response: FetchPendingImageResponse | undefined) => {
          if (chrome.runtime.lastError) {
            resolve(undefined);
            return;
          }
          resolve(response);
        },
      );
    } catch {
      resolve(undefined);
    }
  });
}

async function loadPendingImage(): Promise<void> {
  clearBadge();
  const timer = window.setTimeout(() => toast(t('toast.fetching')), 350);
  const response = await requestPendingImage();
  window.clearTimeout(timer);

  if (!response) return;
  if (!response.ok || !response.base64) {
    if (response.error && response.error !== 'no-pending-image') {
      toast(t('toast.fetchError', { detail: response.error }), 'error');
    }
    return;
  }

  try {
    const bytes = base64ToBytes(response.base64);
    const name = response.name || 'image';
    const detection = detectInput(bytes, name, response.mime ?? '');
    if (!detection.format || detection.format === 'heic') {
      showError(
        new ConversionError(
          detection.format === 'heic' ? 'heic-unsupported' : 'unsupported-input',
        ),
      );
      return;
    }

    const mime = response.mime || FORMATS[detection.format].mime;
    const item = createQueueItem(bytes, name, mime, detection.format);
    items.push(item);
    selectedId = item.id;
    renderQueue();
    syncControlStates();
    updateDownloadAll();
    showSelectedPreview();
    toast(t('toast.fetched'));
  } catch (error) {
    showError(error);
  }
}

function applyStaticAria(): void {
  ui.dropzone.tabIndex = 0;
  ui.dropzone.setAttribute('role', 'button');
  ui.dropzone.setAttribute('aria-label', t('dnd.aria'));
  ui.language.setAttribute('aria-label', t('lang.label'));
}

function handleSettingsChange(): void {
  if (busy) return;
  settings = readSettingsFromControls();
  syncOutputs();
  syncControlStates();
  scheduleSave();
  showSelectedPreview();
}

function handleLanguageChange(): void {
  if (busy) return;
  settings = readSettingsFromControls();
  setLocale(resolveLocale(settings.language));
  applyTranslations();
  populateLanguage();
  populateFormat();
  applySettingsToControls();
  applyStaticAria();
  syncOutputs();
  syncControlStates();
  renderQueue();
  showSelectedPreview();
  scheduleSave();
}

function bindEvents(): void {
  ui.language.addEventListener('change', handleLanguageChange);
  ui.format.addEventListener('change', handleSettingsChange);
  ui.keepAnimation.addEventListener('change', handleSettingsChange);
  ui.keepTransparency.addEventListener('change', handleSettingsChange);
  ui.quality.addEventListener('input', handleSettingsChange);
  ui.effort.addEventListener('input', handleSettingsChange);
  ui.resizeEnabled.addEventListener('change', handleSettingsChange);
  ui.resizeWidth.addEventListener('input', handleSettingsChange);
  ui.resizeHeight.addEventListener('input', handleSettingsChange);
  ui.keepRatio.addEventListener('change', handleSettingsChange);
  ui.removeMetadata.addEventListener('change', handleSettingsChange);
  ui.namePattern.addEventListener('input', handleSettingsChange);
  ui.background.addEventListener('input', () => {
    ui.backgroundValue.textContent = normalizeHexColor(ui.background.value);
    handleSettingsChange();
  });

  ui.fileInput.addEventListener('change', () => {
    const files = Array.from(ui.fileInput.files ?? []);
    ui.fileInput.value = '';
    if (files.length > 0) void addFiles(files);
  });

  ui.pick.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!busy) ui.fileInput.click();
  });
  ui.dropzone.addEventListener('click', (event) => {
    if (event.target === ui.fileInput || busy) return;
    ui.fileInput.click();
  });
  ui.dropzone.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    if (!busy) ui.fileInput.click();
  });

  const hasFiles = (event: DragEvent): boolean =>
    Array.from(event.dataTransfer?.types ?? []).includes('Files');

  ui.dropzone.addEventListener('dragenter', (event) => {
    if (!hasFiles(event) || busy) return;
    event.preventDefault();
    ui.dropzone.classList.add('dragover');
  });
  ui.dropzone.addEventListener('dragover', (event) => {
    if (!hasFiles(event) || busy) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    ui.dropzone.classList.add('dragover');
  });
  ui.dropzone.addEventListener('dragleave', () => {
    ui.dropzone.classList.remove('dragover');
  });
  ui.dropzone.addEventListener('drop', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    ui.dropzone.classList.remove('dragover');
    if (!busy && event.dataTransfer) void addFiles(event.dataTransfer.files);
  });

  document.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = busy ? 'none' : 'copy';
  });
  document.addEventListener('drop', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    ui.dropzone.classList.remove('dragover');
    if (!busy && event.dataTransfer) void addFiles(event.dataTransfer.files);
  });

  ui.queue.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const row = target.closest<HTMLLIElement>('li[data-id]');
    if (!row) return;
    const id = Number(row.dataset.id);
    if (!Number.isFinite(id)) return;

    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action === 'remove') {
      removeItem(id);
      return;
    }
    if (action === 'download') {
      void downloadItem(id);
      return;
    }
    if (action === 'copy') {
      void copyItem(id);
      return;
    }
    selectItem(id);
  });

  ui.convert.addEventListener('click', () => {
    void convertAll();
  });
  ui.cancel.addEventListener('click', cancelBatch);
  ui.clear.addEventListener('click', clearQueue);
  ui.downloadAll.addEventListener('click', () => {
    void downloadAllResults();
  });
  ui.copy.addEventListener('click', () => {
    if (previewState) void copyResult(previewState.result);
  });
  ui.download.addEventListener('click', () => {
    if (previewState) void downloadResult(previewState.result);
  });

  window.addEventListener('pagehide', () => {
    window.clearTimeout(previewTimer);
    const shouldFlushSave = saveTimer !== undefined;
    window.clearTimeout(saveTimer);
    if (shouldFlushSave) void saveSettings(settings);

    worker.dispose();
    for (const item of items) URL.revokeObjectURL(item.previewUrl);
    if (previewState) URL.revokeObjectURL(previewState.url);
  });
}

async function init(): Promise<void> {
  settings = await loadSettings();
  setLocale(resolveLocale(settings.language));
  applyTranslations();
  populateLanguage();
  populateFormat();
  applySettingsToControls();
  applyStaticAria();
  bindEvents();
  syncOutputs();
  syncControlStates();
  renderQueue();
  updateDownloadAll();
  showSelectedPreview();
  clearBadge();
  await loadPendingImage();
}

void init().catch((error: unknown) => {
  showError(error);
});
