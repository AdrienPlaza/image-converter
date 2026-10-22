/**
 * Conversion orchestrator, executed in the Web Worker.
 *
 * Pipeline: detection → decoding → (resizing + alpha flattening)
 * → encoding → (JPEG→JPEG EXIF). Each step reports progress and every
 * error surfaces as a `ConversionError`: no silent failure.
 *
 * Canvas (OffscreenCanvas) is used to decode native formats
 * and resize them; non-native encoders live in `codecs/`.
 */
import { GIFEncoder } from 'gifenc';
import { encodeAvif } from './codecs/avif';
import { encodeBmp } from './codecs/bmp';
import { encodeGif, writeGifFrame } from './codecs/gif';
import { encodeIco } from './codecs/ico';
import { normalizeSvg } from './codecs/svg';
import { decodeTiff, encodeTiff } from './codecs/tiff';
import { ConversionError } from './errors';
import {
  FORMATS,
  detectInput,
  formatWarnings,
  isAnimated,
  mergeWarnings,
  type InputFormat,
  type OutputFormatId,
  type Warning,
} from './formats';
import {
  extractExifSegment,
  insertExifSegment,
  prepareExifForOutput,
} from './metadata';
import { buildFileName, stripExtension } from './naming';
import { assertCanvasSize, computeTarget, type ResizeOptions } from './resize';
import { clamp, normalizeHexColor } from './util';

export type ConversionStage = 'decode' | 'render' | 'encode' | 'finalize';
export type ProgressFn = (stage: ConversionStage, ratio: number) => void;

export interface ConversionOptions {
  target: OutputFormatId;
  /** 1–100 (JPEG, WebP, AVIF). */
  quality: number;
  /** 1–10 (AVIF uniquement). */
  effort: number;
  resize: ResizeOptions;
  /** Background color when the output cannot store alpha. */
  background: string;
  /** Keeps alpha; otherwise flattens onto `background`. */
  keepTransparency: boolean;
  /** Checked by default: removes metadata. */
  removeMetadata: boolean;
  /** Animated GIF input + GIF output: keeps every frame. */
  keepAnimation: boolean;
  namePattern: string;
  /** Index in the batch ({index} variable). */
  index: number;
}

export interface ConvertInput {
  bytes: Uint8Array;
  fileName: string;
  mime?: string;
}

export interface ConvertResult {
  bytes: Uint8Array;
  fileName: string;
  mime: string;
  ext: string;
  width: number;
  height: number;
  sourceFormat: InputFormat;
  warnings: Warning[];
}

export interface ConversionPlan {
  width: number;
  height: number;
  warnings: Warning[];
}

/** JPEG/BMP without alpha, or solid background requested: flatten onto a color. */
export function needsAlphaFlatten(target: OutputFormatId, keepTransparency = true): boolean {
  return !FORMATS[target].supportsAlpha || !keepTransparency;
}

/**
 * Computes final dimensions and format/resize warnings.
 * Pure function, testable without a canvas.
 */
export function planConversion(
  source: InputFormat,
  sourceWidth: number,
  sourceHeight: number,
  target: OutputFormatId,
  resize: ResizeOptions,
  background: string,
  keepTransparency = true,
): ConversionPlan {
  const base = computeTarget(sourceWidth, sourceHeight, resize);
  const warnings: Warning[] = [];

  if (
    needsAlphaFlatten(target, keepTransparency) &&
    source !== 'heic' &&
    FORMATS[source].supportsAlpha
  ) {
    warnings.push({ code: 'alpha-flattened', params: { background: normalizeHexColor(background) } });
  }
  if (base.upscaled) {
    warnings.push({ code: 'upscaled', params: { width: base.width, height: base.height } });
  }

  let width = base.width;
  let height = base.height;

  // ICO: one entry ≤ 256 px. Scale down proportionally when needed.
  if (target === 'ico' && (width > 256 || height > 256)) {
    const scale = Math.min(256 / width, 256 / height);
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
    warnings.push({ code: 'ico-resized', params: { max: 256 } });
  }

  return { width, height, warnings };
}

function toBlobPart(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

function frameDelay(duration: number | null): number {
  if (!duration || duration <= 0) return 100;
  return Math.round(clamp(duration / 1000, 20, 10_000));
}

function buildResult(
  input: ConvertInput,
  options: ConversionOptions,
  source: InputFormat,
  target: OutputFormatId,
  width: number,
  height: number,
  bytes: Uint8Array,
  warnings: Warning[],
): ConvertResult {
  return {
    bytes,
    fileName: buildFileName(options.namePattern, {
      name: stripExtension(input.fileName),
      ext: FORMATS[target].ext,
      index: options.index,
      width,
      height,
    }),
    mime: FORMATS[target].mime,
    ext: FORMATS[target].ext,
    width,
    height,
    sourceFormat: source,
    warnings: mergeWarnings(warnings),
  };
}

const MAX_ANIMATION_FRAMES = 1000;

/**
 * Animated GIF: ImageDecoder returns already-composited frames. Each frame is
 * resized and re-encoded, with 1-bit alpha when transparency is
 * preserved. Returns `null` if the track turns out not to be animated.
 */
async function encodeAnimatedGif(
  input: ConvertInput,
  options: ConversionOptions,
  warnings: Warning[],
  onProgress: ProgressFn,
): Promise<{ bytes: Uint8Array; width: number; height: number } | null> {
  const decoder = new ImageDecoder({
    data: input.bytes.slice().buffer,
    type: 'image/gif',
    preferAnimation: true,
  });

  try {
    await decoder.tracks.ready;
    const track = decoder.tracks.selectedTrack ?? decoder.tracks[0];
    if (!track || !track.animated || track.frameCount < 2) return null;
    if (track.frameCount > MAX_ANIMATION_FRAMES) {
      throw new ConversionError('animation-too-long', {
        frames: track.frameCount,
        max: MAX_ANIMATION_FRAMES,
      });
    }

    const first = await decoder.decode({ frameIndex: 0 });
    const sourceWidth = first.image.displayWidth;
    const sourceHeight = first.image.displayHeight;
    if (!sourceWidth || !sourceHeight) throw new ConversionError('decode-failed');

    const plan = planConversion(
      'gif',
      sourceWidth,
      sourceHeight,
      'gif',
      options.resize,
      options.background,
      options.keepTransparency,
    );
    assertCanvasSize(plan.width, plan.height);
    warnings.push(...plan.warnings);

    const canvas = new OffscreenCanvas(plan.width, plan.height);
    const ctx = canvas.getContext('2d', { alpha: true, willReadFrequently: true });
    if (!ctx) throw new ConversionError('decode-failed');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const flatten = needsAlphaFlatten('gif', options.keepTransparency);
    const background = normalizeHexColor(options.background);
    const encoder = GIFEncoder();

    for (let index = 0; index < track.frameCount; index++) {
      const frame = index === 0 ? first.image : (await decoder.decode({ frameIndex: index })).image;
      const delay = frameDelay(frame.duration);

      ctx.clearRect(0, 0, plan.width, plan.height);
      if (flatten) {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, plan.width, plan.height);
      }
      ctx.drawImage(frame, 0, 0, plan.width, plan.height);
      frame.close();

      const image = ctx.getImageData(0, 0, plan.width, plan.height);
      writeGifFrame(
        encoder,
        image,
        delay,
        index === 0 ? 0 : undefined,
        !flatten,
        flatten ? undefined : 2,
      );
      onProgress('encode', 0.1 + (0.8 * (index + 1)) / track.frameCount);
    }

    encoder.finish();
    return { bytes: encoder.bytes(), width: plan.width, height: plan.height };
  } finally {
    decoder.close();
  }
}

async function decodeToBitmap(
  bytes: Uint8Array,
  format: InputFormat,
): Promise<ImageBitmap> {
  if (format === 'heic') throw new ConversionError('heic-unsupported');

  if (format === 'tiff') {
    const image = await decodeTiff(bytes);
    return createImageBitmap(image);
  }

  if (format === 'svg') {
    const blob = normalizeSvg(bytes);
    return createImageBitmap(blob);
  }

  const blob = new Blob([toBlobPart(bytes)], { type: FORMATS[format].mime });
  return createImageBitmap(blob);
}

async function renderCanvas(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  flatten: boolean,
  background: string,
): Promise<OffscreenCanvas> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { alpha: true, willReadFrequently: true });
  if (!ctx) throw new ConversionError('decode-failed');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (flatten) {
    ctx.fillStyle = normalizeHexColor(background);
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  return canvas;
}

async function encodeCanvas(
  canvas: OffscreenCanvas,
  target: OutputFormatId,
  quality: number,
  effort: number,
  keepTransparency: boolean,
): Promise<Uint8Array> {
  const info = FORMATS[target];
  if (info.encode === 'native') {
    const blob = await canvas.convertToBlob({
      type: info.mime,
      quality: info.quality ? clamp(quality, 1, 100) / 100 : undefined,
    });
    return new Uint8Array(await blob.arrayBuffer());
  }

  if (target === 'ico') {
    const png = new Uint8Array(
      await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer(),
    );
    return encodeIco(png, canvas.width, canvas.height);
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ConversionError('encode-failed');
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);

  switch (target) {
    case 'gif':
      return encodeGif(image, keepTransparency);
    case 'bmp':
      return encodeBmp(image);
    case 'avif':
      return encodeAvif(image, quality, effort);
    case 'tiff':
      return encodeTiff(image);
    default:
      throw new ConversionError('encode-unsupported', { format: target });
  }
}

/**
 * Converts an image. `onProgress` receives coarse stages: the UI must not
 * depend on a fine-grained ratio.
 */
export async function convertImage(
  input: ConvertInput,
  options: ConversionOptions,
  onProgress: ProgressFn = () => {},
): Promise<ConvertResult> {
  if (input.bytes.length === 0) throw new ConversionError('empty-file');

  const detection = detectInput(input.bytes, input.fileName, input.mime);
  const source = detection.format;
  if (!source) throw new ConversionError('unsupported-input');
  if (source === 'heic') throw new ConversionError('heic-unsupported');

  const target = options.target;
  if (!FORMATS[target]) throw new ConversionError('encode-unsupported', { format: target });

  const animated = isAnimated(input.bytes, source);
  const animationKept =
    options.keepAnimation && target === 'gif' && source === 'gif' && animated;
  const warnings: Warning[] = formatWarnings(
    source,
    target,
    animated,
    animationKept,
    options.keepTransparency,
  );

  if (animationKept) {
    onProgress('decode', 0.05);
    const animation = await encodeAnimatedGif(input, options, warnings, onProgress);
    if (animation) {
      onProgress('finalize', 1);
      return buildResult(
        input,
        options,
        source,
        target,
        animation.width,
        animation.height,
        animation.bytes,
        warnings,
      );
    }
    warnings.push({ code: 'gif-static' }, { code: 'animation-first-frame' });
  }

  onProgress('decode', 0.05);
  const bitmap = await decodeToBitmap(input.bytes, source);
  try {
    const sourceWidth = bitmap.width;
    const sourceHeight = bitmap.height;
    if (!sourceWidth || !sourceHeight) throw new ConversionError('decode-failed');

    const plan = planConversion(
      source,
      sourceWidth,
      sourceHeight,
      target,
      options.resize,
      options.background,
      options.keepTransparency,
    );
    assertCanvasSize(plan.width, plan.height);
    warnings.push(...plan.warnings);

    onProgress('render', 0.35);
    const canvas = await renderCanvas(
      bitmap,
      plan.width,
      plan.height,
      needsAlphaFlatten(target, options.keepTransparency),
      options.background,
    );

    onProgress('encode', 0.55);
    let bytes = await encodeCanvas(
      canvas,
      target,
      options.quality,
      options.effort,
      options.keepTransparency,
    );

    onProgress('finalize', 0.9);
    if (target === 'jpeg') {
      const exif = source === 'jpeg' ? extractExifSegment(input.bytes) : null;
      if (!options.removeMetadata) {
        if (exif) {
          const prepared = prepareExifForOutput(exif);
          bytes = insertExifSegment(bytes, prepared.segment);
          if (prepared.orientation !== 1) {
            warnings.push({
              code: 'exif-orientation-baked',
              params: { orientation: prepared.orientation },
            });
          }
        } else if (source === 'jpeg') {
          warnings.push({ code: 'exif-absent' });
        }
      }
    } else if (!options.removeMetadata && source === 'jpeg' && extractExifSegment(input.bytes)) {
      // Canvas cannot copy EXIF outside JPEG → the user must be told.
      warnings.push({ code: 'exif-stripped' });
    }

    onProgress('finalize', 1);
    return buildResult(
      input,
      options,
      source,
      target,
      plan.width,
      plan.height,
      bytes,
      warnings,
    );
  } finally {
    bitmap.close();
  }
}
