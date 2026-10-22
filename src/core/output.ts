/**
 * User outputs: download (single/ZIP) and clipboard.
 * Chrome only accepts PNG on the image clipboard → the UI re-encodes
 * to PNG before calling `copyPngToClipboard`.
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
  // Images are already compressed: store directly, instant ZIP.
  return zipSync(files, { level: 0 });
}

function toBlob(bytes: Uint8Array, mime: string): Blob {
  return new Blob([bytes.slice().buffer], { type: mime });
}

/** Downloads via chrome.downloads and releases the blob URL afterward. */
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

/** Copies a PNG image to the clipboard (the only format Chrome accepts). */
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
