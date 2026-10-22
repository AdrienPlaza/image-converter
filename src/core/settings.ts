/**
 * Preferences persisted in chrome.storage.sync (synced across devices).
 * Loading tolerates corrupted values: falls back to defaults.
 */
import { OUTPUT_FORMATS, type OutputFormatId } from './formats';
import type { ResizeOptions } from './resize';
import { clamp, normalizeHexColor } from './util';

export type Language = 'auto' | 'fr' | 'en';

export interface Settings {
  language: Language;
  target: OutputFormatId;
  quality: number;
  effort: number;
  resize: ResizeOptions;
  background: string;
  /** Keeps alpha for compatible formats (including 1-bit GIF). */
  keepTransparency: boolean;
  removeMetadata: boolean;
  keepAnimation: boolean;
  namePattern: string;
}

export const DEFAULT_SETTINGS: Settings = {
  language: 'auto',
  target: 'png',
  quality: 90,
  effort: 6,
  resize: { enabled: false, width: null, height: null, keepRatio: true },
  background: '#ffffff',
  keepTransparency: true,
  removeMetadata: true,
  keepAnimation: true,
  namePattern: '{name}_converted.{ext}',
};

const STORAGE_KEY = 'settings';

function positiveOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : null;
}

function sanitize(raw: unknown): Settings {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const resize =
    value.resize && typeof value.resize === 'object'
      ? (value.resize as Record<string, unknown>)
      : {};

  const target =
    typeof value.target === 'string' && OUTPUT_FORMATS.includes(value.target as OutputFormatId)
      ? (value.target as OutputFormatId)
      : DEFAULT_SETTINGS.target;
  const language =
    value.language === 'fr' || value.language === 'en' ? value.language : 'auto';

  return {
    language,
    target,
    quality:
      typeof value.quality === 'number'
        ? Math.round(clamp(value.quality, 1, 100))
        : DEFAULT_SETTINGS.quality,
    effort:
      typeof value.effort === 'number'
        ? Math.round(clamp(value.effort, 1, 10))
        : DEFAULT_SETTINGS.effort,
    resize: {
      enabled: resize.enabled === true,
      width: positiveOrNull(resize.width),
      height: positiveOrNull(resize.height),
      keepRatio: resize.keepRatio !== false,
    },
    background:
      typeof value.background === 'string'
        ? normalizeHexColor(value.background)
        : DEFAULT_SETTINGS.background,
    keepTransparency: value.keepTransparency !== false,
    removeMetadata: value.removeMetadata !== false,
    keepAnimation: value.keepAnimation !== false,
    namePattern:
      typeof value.namePattern === 'string' && value.namePattern.trim()
        ? value.namePattern.slice(0, 150)
        : DEFAULT_SETTINGS.namePattern,
  };
}

export async function loadSettings(): Promise<Settings> {
  try {
    const stored = await chrome.storage.sync.get(STORAGE_KEY);
    return sanitize(stored[STORAGE_KEY]);
  } catch {
    return { ...DEFAULT_SETTINGS, resize: { ...DEFAULT_SETTINGS.resize } };
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  try {
    await chrome.storage.sync.set({ [STORAGE_KEY]: settings });
  } catch {
    // Quota or sync disabled: preferences remain valid for the session.
  }
}
