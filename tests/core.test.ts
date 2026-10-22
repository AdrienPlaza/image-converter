import { describe, expect, it } from 'vitest';
import { buildFileName, stripExtension, uniqueFileName } from '../src/core/naming';
import { computeTarget, type ResizeOptions } from '../src/core/resize';
import {
  extractExifSegment,
  insertExifSegment,
  prepareExifForOutput,
  readExifOrientation,
} from '../src/core/metadata';

const NO_RESIZE: ResizeOptions = { enabled: false, width: null, height: null, keepRatio: true };

function resize(width: number | null, height: number | null, keepRatio = true): ResizeOptions {
  return { enabled: true, width, height, keepRatio };
}

describe('computeTarget', () => {
  it('keeps the source size without resizing', () => {
    expect(computeTarget(1200, 800, NO_RESIZE)).toEqual({
      width: 1200,
      height: 800,
      resized: false,
      upscaled: false,
    });
  });

  it('derives height from width', () => {
    const result = computeTarget(1200, 800, resize(600, null));
    expect(result.width).toBe(600);
    expect(result.height).toBe(400);
    expect(result.resized).toBe(true);
  });

  it('derives width from height', () => {
    const result = computeTarget(1200, 800, resize(null, 200));
    expect(result.width).toBe(300);
    expect(result.height).toBe(200);
  });

  it('contains within the box when both dimensions are provided', () => {
    const result = computeTarget(1200, 800, resize(500, 500));
    expect(result).toEqual({ width: 500, height: 333, resized: true, upscaled: false });
  });

  it('applies exact dimensions without preserving the ratio', () => {
    const result = computeTarget(1200, 800, resize(100, 100, false));
    expect(result).toEqual({ width: 100, height: 100, resized: true, upscaled: false });
  });

  it('warns about upscaling', () => {
    expect(computeTarget(100, 100, resize(200, null)).upscaled).toBe(true);
  });
});

describe('naming', () => {
  it('applies the template and variables', () => {
    expect(
      buildFileName('{name}-{width}x{height}.{ext}', {
        name: 'photo',
        ext: 'webp',
        index: 1,
        width: 800,
        height: 600,
      }),
    ).toBe('photo-800x600.webp');
  });

  it('appends the extension when the template lacks {ext}', () => {
    expect(
      buildFileName('{name}_converted', {
        name: 'photo',
        ext: 'png',
        index: 1,
        width: 1,
        height: 1,
      }),
    ).toBe('photo_converted.png');
  });

  it('sanitizes forbidden characters', () => {
    expect(
      buildFileName('{name}.{ext}', {
        name: 'a:b/c?d',
        ext: 'png',
        index: 1,
        width: 1,
        height: 1,
      }),
    ).toBe('a_b_c_d.png');
  });

  it('uses a fallback name for an empty template', () => {
    expect(
      buildFileName('   ', { name: '', ext: 'jpg', index: 2, width: 1, height: 1 }),
    ).toBe('image_converted.jpg');
  });

  it('deduplicates names', () => {
    const used = new Set<string>();
    expect(uniqueFileName('a.png', used)).toBe('a.png');
    expect(uniqueFileName('a.png', used)).toBe('a (2).png');
    expect(uniqueFileName('a.png', used)).toBe('a (3).png');
  });

  it('removes the extension', () => {
    expect(stripExtension('photo.2024.png')).toBe('photo.2024');
    expect(stripExtension('photo')).toBe('photo');
  });
});

function makeExifJpeg(orientation: number): Uint8Array {
  const tiff = new Uint8Array(26);
  const view = new DataView(tiff.buffer);
  view.setUint16(0, 0x4949, false);
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  view.setUint16(8, 1, true);
  view.setUint16(10, 0x0112, true);
  view.setUint16(12, 3, true);
  view.setUint32(14, 1, true);
  view.setUint16(18, orientation, true);
  view.setUint32(22, 0, true);

  const segmentLength = 2 + 6 + tiff.length;
  const segment = new Uint8Array(2 + segmentLength);
  segment.set([0xff, 0xe1], 0);
  new DataView(segment.buffer).setUint16(2, segmentLength, false);
  segment.set(new TextEncoder().encode('Exif\0\0'), 4);
  segment.set(tiff, 10);

  const jpeg = new Uint8Array(2 + segment.length + 4);
  jpeg.set([0xff, 0xd8], 0);
  jpeg.set(segment, 2);
  jpeg.set([0xff, 0xda, 0, 2], 2 + segment.length);
  return jpeg;
}

describe('EXIF', () => {
  it('extracts the APP1 segment and reads the orientation', () => {
    const jpeg = makeExifJpeg(6);
    const segment = extractExifSegment(jpeg);
    expect(segment).not.toBeNull();
    expect(readExifOrientation(segment as Uint8Array)).toBe(6);
  });

  it('resets orientation to 1 in the output copy', () => {
    const segment = extractExifSegment(makeExifJpeg(8)) as Uint8Array;
    const prepared = prepareExifForOutput(segment);
    expect(prepared.orientation).toBe(8);
    expect(readExifOrientation(prepared.segment)).toBe(1);
    expect(readExifOrientation(segment)).toBe(8);
  });

  it('inserts the segment right after SOI', () => {
    const segment = extractExifSegment(makeExifJpeg(1)) as Uint8Array;
    const output = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]);
    const merged = insertExifSegment(output, segment);
    expect(merged.length).toBe(output.length + segment.length);
    expect(merged[0]).toBe(0xff);
    expect(merged[1]).toBe(0xd8);
    expect(merged[2]).toBe(0xff);
    expect(merged[3]).toBe(0xe1);
  });

  it('ignores files that are not JPEGs', () => {
    expect(extractExifSegment(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});
