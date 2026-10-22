import { describe, expect, it } from 'vitest';
import { encodeBmp } from '../src/core/codecs/bmp';
import { encodeGif } from '../src/core/codecs/gif';
import { encodeIco } from '../src/core/codecs/ico';
import { encodeSvgEmbedded, normalizeSvg } from '../src/core/codecs/svg';
import { ConversionError } from '../src/core/errors';

function imageData(width: number, height: number, pixels: number[][]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  pixels.forEach((pixel, index) => data.set(pixel, index * 4));
  return { width, height, data, colorSpace: 'srgb' } as ImageData;
}

function gifGraphicControls(gif: Uint8Array): { packed: number; transparentIndex: number }[] {
  let offset = 6;
  const screenPacked = gif[10] ?? 0;
  offset = screenPacked & 0x80 ? 13 + 3 * 2 ** ((screenPacked & 0x07) + 1) : 13;

  const controls: { packed: number; transparentIndex: number }[] = [];
  const skipSubBlocks = (): void => {
    while ((gif[offset] ?? 0) !== 0) offset += (gif[offset] ?? 0) + 1;
    offset++;
  };

  while (offset < gif.length) {
    const block = gif[offset++] ?? 0;
    if (block === 0x3b) break;

    if (block === 0x21) {
      const label = gif[offset++] ?? 0;
      if (label === 0xf9) {
        const size = gif[offset++] ?? 0;
        controls.push({
          packed: gif[offset] ?? 0,
          transparentIndex: gif[offset + 2] ?? 0,
        });
        offset += size;
        skipSubBlocks();
      } else {
        skipSubBlocks();
      }
      continue;
    }

    if (block === 0x2c) {
      const imagePacked = gif[offset + 8] ?? 0;
      offset += 9;
      if (imagePacked & 0x80) offset += 3 * 2 ** ((imagePacked & 0x07) + 1);
      offset++; // code LZW minimal
      skipSubBlocks();
      continue;
    }

    break;
  }

  return controls;
}

describe('encodeGif', () => {
  it('writes a 1-bit transparency flag for alpha pixels', () => {
    const image = imageData(2, 1, [
      [255, 0, 0, 0],
      [0, 0, 255, 255],
    ]);
    const controls = gifGraphicControls(encodeGif(image, true));
    expect(controls).toHaveLength(1);
    expect((controls[0]?.packed ?? 0) & 0x01).toBe(1);
  });

  it('does not enable transparency when the option is off', () => {
    const image = imageData(1, 1, [[255, 0, 0, 0]]);
    const controls = gifGraphicControls(encodeGif(image, false));
    expect((controls[0]?.packed ?? 1) & 0x01).toBe(0);
  });

  it('does not enable transparency for an opaque image', () => {
    const image = imageData(1, 1, [[255, 0, 0, 255]]);
    const controls = gifGraphicControls(encodeGif(image, true));
    expect((controls[0]?.packed ?? 1) & 0x01).toBe(0);
  });
});

describe('encodeBmp', () => {
  it('writes a 24-bit BMP with bottom-up rows and padding', () => {
    const image = imageData(2, 2, [
      [255, 0, 0, 255],
      [0, 255, 0, 255],
      [0, 0, 255, 255],
      [255, 255, 255, 255],
    ]);
    const bmp = encodeBmp(image);
    const view = new DataView(bmp.buffer, bmp.byteOffset, bmp.byteLength);

    expect(String.fromCharCode(bmp[0] ?? 0, bmp[1] ?? 0)).toBe('BM');
    expect(view.getUint32(2, true)).toBe(70);
    expect(view.getUint32(10, true)).toBe(54);
    expect(view.getInt32(18, true)).toBe(2);
    expect(view.getInt32(22, true)).toBe(2);
    expect(view.getUint16(28, true)).toBe(24);
    expect(bmp.length).toBe(70);

    // First pixel row = bottom of the image: blue, then white.
    expect(Array.from(bmp.subarray(54, 60))).toEqual([255, 0, 0, 255, 255, 255]);
    // Two padding bytes, then the top row: red, then green.
    expect(Array.from(bmp.subarray(62, 68))).toEqual([0, 0, 255, 0, 255, 0]);
  });
});

describe('encodeIco', () => {
  it('wraps a PNG in a valid ICONDIR entry', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const ico = encodeIco(png, 256, 64);
    const view = new DataView(ico.buffer);

    expect(view.getUint16(0, true)).toBe(0);
    expect(view.getUint16(2, true)).toBe(1);
    expect(view.getUint16(4, true)).toBe(1);
    expect(ico[6]).toBe(0);
    expect(ico[7]).toBe(64);
    expect(view.getUint16(10, true)).toBe(1);
    expect(view.getUint16(12, true)).toBe(32);
    expect(view.getUint32(14, true)).toBe(png.length);
    expect(view.getUint32(18, true)).toBe(22);
    expect(Array.from(ico.subarray(22))).toEqual(Array.from(png));
  });

  it('rejects out-of-range dimensions', () => {
    expect(() => encodeIco(new Uint8Array(1), 300, 10)).toThrow();
  });
});

describe('SVG', () => {
  it('embeds the PNG as base64 without an external resource', () => {
    const png = new Uint8Array([1, 2, 3, 4]);
    const svg = new TextDecoder().decode(encodeSvgEmbedded(png, 10, 20));
    expect(svg).toContain('width="10"');
    expect(svg).toContain('height="20"');
    expect(svg).toContain('viewBox="0 0 10 20"');
    expect(svg).toContain('data:image/png;base64,AQIDBA==');
    expect(svg).not.toContain('href="http');
  });

  it('injects width/height from the viewBox', async () => {
    const blob = normalizeSvg(
      new TextEncoder().encode('<svg viewBox="0 0 120 80"><rect width="120" height="80"/></svg>'),
    );
    const text = await blob.text();
    expect(text).toContain('width="120"');
    expect(text).toContain('height="80"');
    expect(blob.type).toBe('image/svg+xml');
  });

  it('fills in a single missing dimension', async () => {
    const blob = normalizeSvg(
      new TextEncoder().encode('<svg width="20" viewBox="0 0 100 50"></svg>'),
    );
    const text = await blob.text();
    expect(text).toContain('width="20"');
    expect(text).toContain('height="50"');
  });

  it('rejects an SVG without usable dimensions', () => {
    expect(() => normalizeSvg(new TextEncoder().encode('<svg></svg>'))).toThrow(ConversionError);
    expect(() =>
      normalizeSvg(new TextEncoder().encode('<svg width="100%"></svg>')),
    ).toThrow(ConversionError);
  });
});
