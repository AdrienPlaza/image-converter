/**
 * Source de vérité des formats : capacités, détection, warnings.
 *
 * Règle : tout ce qui n'est pas nativement encodable par Chrome est signalé
 * (WASM, encodeur maison, ou absence de support). Rien n'échoue en silence.
 */

export type FormatId = 'png' | 'jpeg' | 'webp' | 'avif' | 'gif' | 'bmp' | 'ico' | 'svg' | 'tiff';
export type InputFormat = FormatId | 'heic';

export type EncodeKind = 'native' | 'wasm' | 'custom' | 'unsupported';
export type DecodeKind = 'native' | 'wasm' | 'unsupported';

export interface FormatInfo {
  id: FormatId;
  label: string;
  mime: string;
  ext: string;
  /** Le format peut stocker de l'alpha. */
  supportsAlpha: boolean;
  /** Encodage avec pertes (qualité applicable). */
  lossy: boolean;
  /** Le réglage de qualité a un effet. */
  quality: boolean;
  decode: DecodeKind;
  encode: EncodeKind;
}

export const FORMATS: Record<FormatId, FormatInfo> = {
  png: {
    id: 'png',
    label: 'PNG',
    mime: 'image/png',
    ext: 'png',
    supportsAlpha: true,
    lossy: false,
    quality: false,
    decode: 'native',
    encode: 'native',
  },
  jpeg: {
    id: 'jpeg',
    label: 'JPEG',
    mime: 'image/jpeg',
    ext: 'jpg',
    supportsAlpha: false,
    lossy: true,
    quality: true,
    decode: 'native',
    encode: 'native',
  },
  webp: {
    id: 'webp',
    label: 'WebP',
    mime: 'image/webp',
    ext: 'webp',
    supportsAlpha: true,
    lossy: true,
    quality: true,
    decode: 'native',
    encode: 'native',
  },
  avif: {
    id: 'avif',
    label: 'AVIF',
    mime: 'image/avif',
    ext: 'avif',
    supportsAlpha: true,
    lossy: true,
    quality: true,
    // Chrome décode l'AVIF mais ne l'encode pas via canvas : WASM obligatoire.
    decode: 'native',
    encode: 'wasm',
  },
  gif: {
    id: 'gif',
    label: 'GIF',
    mime: 'image/gif',
    ext: 'gif',
    supportsAlpha: true,
    lossy: true,
    quality: false,
    decode: 'native',
    encode: 'custom',
  },
  bmp: {
    id: 'bmp',
    label: 'BMP',
    mime: 'image/bmp',
    ext: 'bmp',
    supportsAlpha: false,
    lossy: false,
    quality: false,
    decode: 'native',
    encode: 'custom',
  },
  ico: {
    id: 'ico',
    label: 'ICO',
    mime: 'image/x-icon',
    ext: 'ico',
    supportsAlpha: true,
    lossy: false,
    quality: false,
    decode: 'native',
    encode: 'custom',
  },
  svg: {
    id: 'svg',
    label: 'SVG',
    mime: 'image/svg+xml',
    ext: 'svg',
    supportsAlpha: true,
    lossy: false,
    quality: false,
    decode: 'native',
    encode: 'custom',
  },
  tiff: {
    id: 'tiff',
    label: 'TIFF',
    mime: 'image/tiff',
    ext: 'tif',
    supportsAlpha: true,
    lossy: false,
    quality: false,
    decode: 'wasm',
    encode: 'wasm',
  },
};

export const OUTPUT_FORMATS: readonly FormatId[] = [
  'png',
  'jpeg',
  'webp',
  'avif',
  'gif',
  'bmp',
  'ico',
  'svg',
  'tiff',
];

/** Attribut `accept` de l'input file (MIME + extensions). */
export const ACCEPT_ATTRIBUTE = [
  ...Object.values(FORMATS).map((f) => f.mime),
  '.heic',
  '.heif',
  'image/heic',
  'image/heif',
  '.tif',
  '.tiff',
  '.jpg',
  '.jpeg',
  '.ico',
].join(',');

const MIME_TO_FORMAT: Record<string, InputFormat> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/jpg': 'jpeg',
  'image/pjpeg': 'jpeg',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/x-ms-bmp': 'bmp',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/svg+xml': 'svg',
  'image/tiff': 'tiff',
  'image/heic': 'heic',
  'image/heif': 'heic',
};

const EXT_TO_FORMAT: Record<string, InputFormat> = {
  png: 'png',
  jpg: 'jpeg',
  jpeg: 'jpeg',
  jfif: 'jpeg',
  webp: 'webp',
  avif: 'avif',
  gif: 'gif',
  bmp: 'bmp',
  dib: 'bmp',
  ico: 'ico',
  cur: 'ico',
  svg: 'svg',
  tif: 'tiff',
  tiff: 'tiff',
  heic: 'heic',
  heif: 'heic',
};

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[offset + i] ?? 0);
  return out;
}

function matchesAt(bytes: Uint8Array, offset: number, signature: readonly number[]): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((value, i) => bytes[offset + i] === value);
}

/**
 * Détection par signature binaire. Plus fiable que le MIME/extension fournis
 * par l'OS (souvent `application/octet-stream`).
 */
export function sniffFormat(bytes: Uint8Array): InputFormat | null {
  if (bytes.length >= 8 && matchesAt(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'png';
  }
  if (matchesAt(bytes, 0, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (ascii(bytes, 0, 4) === 'GIF8') return 'gif';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'webp';
  if (matchesAt(bytes, 0, [0x42, 0x4d])) return 'bmp';
  if (matchesAt(bytes, 0, [0x00, 0x00, 0x01, 0x00])) return 'ico';
  if (matchesAt(bytes, 0, [0x49, 0x49, 0x2a, 0x00]) || matchesAt(bytes, 0, [0x4d, 0x4d, 0x00, 0x2a])) {
    return 'tiff';
  }

  if (ascii(bytes, 4, 4) === 'ftyp') {
    const brands = ascii(bytes, 8, Math.min(56, Math.max(0, bytes.length - 8))).toLowerCase();
    if (brands.includes('avif') || brands.includes('avis') || brands.includes('av01')) return 'avif';
    if (/hei[csxvm]|heis|mif1/.test(brands)) return 'heic';
  }

  // SVG : texte, éventuellement précédé d'un BOM / déclaration XML / commentaires.
  const head = new TextDecoder('utf-8', { fatal: false }).decode(
    bytes.subarray(0, Math.min(bytes.length, 2048)),
  );
  if (head.includes('<svg') && /^\s*(?:\ufeff)?(?:<\?xml[\s\S]*?\?>|<!--[\s\S]*?-->|<!doctype[\s\S]*?>|\s)*<svg/i.test(head)) {
    return 'svg';
  }
  return null;
}

/** Déduit un format depuis le nom/MIME quand la signature n'est pas concluante. */
export function formatFromHint(fileName: string, mime: string): InputFormat | null {
  const byMime = MIME_TO_FORMAT[mime.toLowerCase()];
  if (byMime) return byMime;
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TO_FORMAT[ext] ?? null;
}

export interface InputDetection {
  format: InputFormat | null;
  /** Signature binaire reconnue (vs simple indice extension/MIME). */
  sniffed: boolean;
}

export function detectInput(bytes: Uint8Array, fileName: string, mime = ''): InputDetection {
  const sniffed = sniffFormat(bytes);
  if (sniffed) return { format: sniffed, sniffed: true };
  return { format: formatFromHint(fileName, mime), sniffed: false };
}

/**
 * Heuristique d'animation. Ces formats ne conservent que la première image en
 * sortie statique : l'utilisateur doit être averti.
 */
export function isAnimated(bytes: Uint8Array, format: InputFormat): boolean {
  try {
    if (format === 'gif') return countGifFrames(bytes) > 1;
    if (format === 'webp') {
      if (bytes.length < 30 || ascii(bytes, 12, 4) !== 'VP8X') return false;
      return ((bytes[20] ?? 0) & 0x02) !== 0;
    }
    if (format === 'avif') {
      return ascii(bytes, 0, 64).toLowerCase().includes('avis');
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Compte les images d'un GIF en sautant les blocs (extensions, tables de
 * couleurs, données LZW). S'arrête au trailer (0x3B).
 */
export function countGifFrames(bytes: Uint8Array): number {
  if (ascii(bytes, 0, 4) !== 'GIF8') return 0;
  let i = 6;
  const packed = bytes[10] ?? 0;
  if (packed & 0x80) i = 13 + 3 * 2 ** ((packed & 0x07) + 1);
  else i = 13;

  const skipSubBlocks = (): void => {
    while (i < bytes.length) {
      const size = bytes[i++] ?? 0;
      if (size === 0) return;
      i += size;
    }
  };

  let frames = 0;
  while (i < bytes.length) {
    const block = bytes[i++] ?? 0;
    if (block === 0x3b) break;
    if (block === 0x21) {
      if (i < bytes.length) i++; // label d'extension
      skipSubBlocks();
      continue;
    }
    if (block === 0x2c) {
      frames++;
      if (i + 9 > bytes.length) break;
      const localPacked = bytes[i + 8] ?? 0;
      i += 9;
      if (localPacked & 0x80) i += 3 * 2 ** ((localPacked & 0x07) + 1);
      if (i < bytes.length) i++; // code LZW minimal
      skipSubBlocks();
      continue;
    }
    break;
  }
  return frames;
}

export type WarningCode =
  | 'svg-rasterized'
  | 'svg-embedded'
  | 'gif-static'
  | 'gif-256'
  | 'gif-alpha'
  | 'ico-resized'
  | 'tiff-decode-experimental'
  | 'tiff-encode-experimental'
  | 'animation-first-frame'
  | 'exif-stripped'
  | 'exif-absent'
  | 'exif-orientation-baked'
  | 'alpha-flattened'
  | 'upscaled';

export interface Warning {
  code: WarningCode;
  params?: Record<string, string | number>;
}

/** Warnings déterministes liés au couple entrée/sortie (avant décodage). */
export function formatWarnings(
  source: InputFormat,
  target: FormatId,
  animated = false,
  animationKept = false,
  keepTransparency = true,
): Warning[] {
  const warnings: Warning[] = [];
  if (source === 'svg') warnings.push({ code: 'svg-rasterized' });
  if (source === 'tiff') warnings.push({ code: 'tiff-decode-experimental' });
  if (target === 'svg') warnings.push({ code: 'svg-embedded' });
  if (target === 'gif') {
    if (!animated || !animationKept) warnings.push({ code: 'gif-static' });
    warnings.push({ code: 'gif-256' });
    if (keepTransparency && source !== 'heic' && FORMATS[source].supportsAlpha) {
      warnings.push({ code: 'gif-alpha' });
    }
  }
  if (target === 'tiff') warnings.push({ code: 'tiff-encode-experimental' });
  if (animated && !animationKept) warnings.push({ code: 'animation-first-frame' });
  return warnings;
}

/** Fusionne des warnings en dédupliquant par code. */
export function mergeWarnings(...groups: Warning[][]): Warning[] {
  const seen = new Set<WarningCode>();
  const out: Warning[] = [];
  for (const group of groups) {
    for (const warning of group) {
      if (seen.has(warning.code)) continue;
      seen.add(warning.code);
      out.push(warning);
    }
  }
  return out;
}
