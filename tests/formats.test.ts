import { describe, expect, it } from 'vitest';
import {
  detectInput,
  formatFromHint,
  formatWarnings,
  isAnimated,
  mergeWarnings,
  sniffFormat,
  countGifFrames,
} from '../src/core/formats';

const ascii = (text: string): Uint8Array => new TextEncoder().encode(text);

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const GIF = ascii('GIF89a');
const WEBP = new Uint8Array([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBPVP8 ')]);
const BMP = new Uint8Array([0x42, 0x4d, 0, 0]);
const ICO = new Uint8Array([0, 0, 1, 0, 1, 0]);
const TIFF_LE = new Uint8Array([0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0]);
const TIFF_BE = new Uint8Array([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8]);
const AVIF = new Uint8Array([0, 0, 0, 0x1c, ...ascii('ftypavif'), 0, 0, 0, 0]);
const HEIC = new Uint8Array([0, 0, 0, 0x1c, ...ascii('ftypheic'), 0, 0, 0, 0]);

function makeGif(frames: number): Uint8Array {
  const bytes: number[] = [...ascii('GIF89a')];
  bytes.push(1, 0, 1, 0, 0, 0, 0);
  for (let i = 0; i < frames; i++) {
    bytes.push(0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0);
    bytes.push(0x02, 0x01, 0x00, 0x00);
  }
  bytes.push(0x3b);
  return new Uint8Array(bytes);
}

describe('sniffFormat', () => {
  it('recognizes binary signatures', () => {
    expect(sniffFormat(PNG)).toBe('png');
    expect(sniffFormat(JPEG)).toBe('jpeg');
    expect(sniffFormat(GIF)).toBe('gif');
    expect(sniffFormat(WEBP)).toBe('webp');
    expect(sniffFormat(BMP)).toBe('bmp');
    expect(sniffFormat(ICO)).toBe('ico');
    expect(sniffFormat(TIFF_LE)).toBe('tiff');
    expect(sniffFormat(TIFF_BE)).toBe('tiff');
    expect(sniffFormat(AVIF)).toBe('avif');
    expect(sniffFormat(HEIC)).toBe('heic');
  });

  it('recognizes textual SVG with or without a header', () => {
    expect(sniffFormat(ascii('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('svg');
    expect(
      sniffFormat(ascii('<?xml version="1.0"?>\n<svg viewBox="0 0 1 1"></svg>')),
    ).toBe('svg');
  });

  it('returns null for unknown bytes', () => {
    expect(sniffFormat(ascii('not an image'))).toBeNull();
    expect(sniffFormat(new Uint8Array())).toBeNull();
  });
});

describe('detectInput', () => {
  it('prioritizes the signature over MIME/extension', () => {
    expect(detectInput(PNG, 'fake.jpg', 'image/jpeg')).toEqual({ format: 'png', sniffed: true });
  });

  it('falls back to MIME then extension', () => {
    const unknown = ascii('raw');
    expect(detectInput(unknown, 'photo.webp', 'image/webp').format).toBe('webp');
    expect(detectInput(unknown, 'scan.TIFF', '').format).toBe('tiff');
    expect(detectInput(unknown, 'x.heic', '').format).toBe('heic');
    expect(detectInput(unknown, 'x.bin', 'application/octet-stream').format).toBeNull();
  });

  it('infers a format from a name or MIME', () => {
    expect(formatFromHint('a.JFIF', '')).toBe('jpeg');
    expect(formatFromHint('a.bin', 'image/vnd.microsoft.icon')).toBe('ico');
  });
});

describe('animation', () => {
  it('counts GIF frames', () => {
    expect(countGifFrames(makeGif(1))).toBe(1);
    expect(countGifFrames(makeGif(3))).toBe(3);
    expect(countGifFrames(PNG)).toBe(0);
    expect(isAnimated(makeGif(2), 'gif')).toBe(true);
    expect(isAnimated(makeGif(1), 'gif')).toBe(false);
  });

  it('detects the WebP animation flag', () => {
    const webp = new Uint8Array(40);
    webp.set(ascii('RIFF'), 0);
    webp.set(ascii('WEBP'), 8);
    webp.set(ascii('VP8X'), 12);
    webp[20] = 0x02;
    expect(isAnimated(webp, 'webp')).toBe(true);
    webp[20] = 0;
    expect(isAnimated(webp, 'webp')).toBe(false);
  });
});

describe('warnings', () => {
  it('warns about fragile conversions', () => {
    const codes = formatWarnings('gif', 'gif', true).map((warning) => warning.code);
    expect(codes).toContain('gif-static');
    expect(codes).toContain('gif-256');
    expect(codes).toContain('animation-first-frame');

    const kept = formatWarnings('gif', 'gif', true, true, true).map((warning) => warning.code);
    expect(kept).toEqual(['gif-256', 'gif-alpha']);
    const opaque = formatWarnings('gif', 'gif', true, true, false).map((warning) => warning.code);
    expect(opaque).toEqual(['gif-256']);
    expect(
      formatWarnings('jpeg', 'gif', false, false, true).map((warning) => warning.code),
    ).not.toContain('gif-alpha');
    expect(formatWarnings('svg', 'png')[0]?.code).toBe('svg-rasterized');
    expect(formatWarnings('png', 'svg')[0]?.code).toBe('svg-embedded');
    expect(formatWarnings('png', 'tiff').map((w) => w.code)).toContain(
      'tiff-encode-experimental',
    );
  });

  it('merges without duplicates', () => {
    const merged = mergeWarnings(
      [{ code: 'gif-static' }, { code: 'upscaled', params: { width: 2, height: 2 } }],
      [{ code: 'gif-static' }, { code: 'gif-256' }],
    );
    expect(merged.map((warning) => warning.code)).toEqual(['gif-static', 'upscaled', 'gif-256']);
  });
});
