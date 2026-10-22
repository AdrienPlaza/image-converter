/**
 * Sorties utilisateur : téléchargement (unitaire/ZIP) et presse-papiers.
 * Chrome n'accepte que du PNG dans le presse-papiers image → l'UI ré-encode
 * en PNG avant d'appeler `copyPngToClipboard`.
 */
import { zipSync } from 'fflate';
import { ConversionError } from './errors';

export interface ZipEntry {
  name: string;
  bytes: Uint8Array;
}

export function buildZip(entries: ZipEntry[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const entry of entries) files[entry.name] = entry.bytes;
  // Les images sont déjà compressées : stockage direct, ZIP instantané.
  return zipSync(files, { level: 0 });
}

function toBlob(bytes: Uint8Array, mime: string): Blob {
  return new Blob([bytes.slice().buffer], { type: mime });
}

/** Télécharge via chrome.downloads et libère l'URL blob après coup. */
export function downloadBytes(
  bytes: Uint8Array,
  mime: string,
  fileName: string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const url = URL.createObjectURL(toBlob(bytes, mime));
    const release = (): void => {
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    };

    chrome.downloads.download(
      { url, filename: fileName, saveAs: false, conflictAction: 'uniquify' },
      (downloadId) => {
        release();
        const error = chrome.runtime.lastError;
        if (error || downloadId === undefined) {
          reject(new ConversionError('download-failed', undefined, error?.message));
        } else {
          resolve();
        }
      },
    );
  });
}

export async function downloadZip(fileName: string, entries: ZipEntry[]): Promise<void> {
  if (entries.length === 0) return;
  await downloadBytes(buildZip(entries), 'application/zip', fileName);
}

/** Copie une image PNG dans le presse-papiers (seul format accepté par Chrome). */
export async function copyPngToClipboard(png: Uint8Array): Promise<void> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
    throw new ConversionError('clipboard-unsupported');
  }
  try {
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': toBlob(png, 'image/png') }),
    ]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ConversionError('clipboard-denied', undefined, detail);
  }
}
