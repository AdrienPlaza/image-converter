/**
 * Minimalist, dependency-free EXIF handling.
 *
 * Canvas strips ALL metadata on re-encode. We can therefore
 * guarantee removal (safe default). To keep EXIF, we can only do it
 * for JPEG → JPEG: we copy the APP1 segment as-is.
 *
 * Warning: Chrome applies EXIF orientation during decoding. Keeping a tag
 * Orientation ≠ 1 would double-rotate the image. We reset
 * that tag to 1 in the copied segment.
 */

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
const TAG_ORIENTATION = 0x0112;

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

function startsWithExifHeader(bytes: Uint8Array, offset: number): boolean {
  return EXIF_HEADER.every((value, i) => bytes[offset + i] === value);
}

/**
 * Extracts the first APP1/EXIF segment from a JPEG, without copying.
 * Returns `null` if absent or if the file is not a JPEG.
 */
export function extractExifSegment(jpeg: Uint8Array): Uint8Array | null {
  if (!isJpeg(jpeg)) return null;
  let i = 2;
  while (i + 4 <= jpeg.length) {
    if (jpeg[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = jpeg[i + 1] ?? 0;
    if (marker === 0xda || marker === 0xd9) break; // SOS / EOI: no more metadata
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2; // markers without a length
      continue;
    }
    const size = ((jpeg[i + 2] ?? 0) << 8) | (jpeg[i + 3] ?? 0);
    if (size < 2) break;
    const end = i + 2 + size;
    if (end > jpeg.length) break;
    if (marker === 0xe1 && startsWithExifHeader(jpeg, i + 4)) {
      return jpeg.subarray(i, end);
    }
    i = end;
  }
  return null;
}

interface OrientationLocation {
  offset: number;
  littleEndian: boolean;
  orientation: number;
}

/** Locates the Orientation tag in an APP1 segment (absolute offset in the segment). */
function findOrientation(segment: Uint8Array): OrientationLocation | null {
  if (segment.length < 16) return null;
  const tiff = 10;
  const view = new DataView(segment.buffer, segment.byteOffset, segment.byteLength);
  const byte0 = segment[tiff] ?? 0;
  const byte1 = segment[tiff + 1] ?? 0;
  const littleEndian = byte0 === 0x49 && byte1 === 0x49;
  const bigEndian = byte0 === 0x4d && byte1 === 0x4d;
  if (!littleEndian && !bigEndian) return null;
  if (view.getUint16(tiff + 2, littleEndian) !== 42) return null;

  const ifdOffset = view.getUint32(tiff + 4, littleEndian);
  const ifd = tiff + ifdOffset;
  if (ifd + 2 > segment.length) return null;
  const count = view.getUint16(ifd, littleEndian);
  for (let k = 0; k < count; k++) {
    const entry = ifd + 2 + k * 12;
    if (entry + 12 > segment.length) return null;
    if (view.getUint16(entry, littleEndian) !== TAG_ORIENTATION) continue;
    const type = view.getUint16(entry + 2, littleEndian);
    if (type !== 3) return null; // SHORT attendu
    return {
      offset: entry + 8,
      littleEndian,
      orientation: view.getUint16(entry + 8, littleEndian),
    };
  }
  return null;
}

/** Lit l'orientation EXIF (1 = normale, 6 = rotation 90°, etc.). */
export function readExifOrientation(segment: Uint8Array): number {
  return findOrientation(segment)?.orientation ?? 1;
}

export interface PreparedExif {
  segment: Uint8Array;
  /** Original orientation, before resetting to 1. */
  orientation: number;
}

/**
 * Prepares a copy of the segment for insertion: Orientation reset to 1
 * because the decoder has already rotated the pixels.
 */
export function prepareExifForOutput(segment: Uint8Array): PreparedExif {
  const copy = segment.slice();
  const found = findOrientation(copy);
  if (found) {
    const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
    view.setUint16(found.offset, 1, found.littleEndian);
    return { segment: copy, orientation: found.orientation };
  }
  return { segment: copy, orientation: 1 };
}

/** Re-inserts an APP1 segment immediately after SOI. */
export function insertExifSegment(jpeg: Uint8Array, segment: Uint8Array): Uint8Array {
  if (!isJpeg(jpeg)) return jpeg;
  if (segment.length < 4 || segment[0] !== 0xff || segment[1] !== 0xe1) return jpeg;
  const out = new Uint8Array(jpeg.length + segment.length);
  out.set(jpeg.subarray(0, 2), 0);
  out.set(segment, 2);
  out.set(jpeg.subarray(2), 2 + segment.length);
  return out;
}
