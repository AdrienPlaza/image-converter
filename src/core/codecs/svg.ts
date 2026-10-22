/**
 * SVG input normalization only. SVG is not an output format: producing an
 * SVG that merely wraps a PNG adds no value.
 *
 * Chrome requires intrinsic dimensions to rasterize an SVG. We inject
 * width/height from the viewBox when they are missing.
 */
import { ConversionError } from '../errors';

/**
 * Ensures the SVG has width/height (otherwise `createImageBitmap` fails).
 * Values are derived from the viewBox; without a viewBox, an explicit error.
 */
export function normalizeSvg(bytes: Uint8Array): Blob {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const svgTag = /<svg\b[^>]*>/i.exec(text);
  if (!svgTag) throw new ConversionError('svg-no-size');

  const tag = svgTag[0];
  // Percentages/relative units do not provide an intrinsic size.
  const hasWidth = /\bwidth\s*=\s*["']\s*\d+(?:\.\d+)?(?:px)?\s*["']/i.test(tag);
  const hasHeight = /\bheight\s*=\s*["']\s*\d+(?:\.\d+)?(?:px)?\s*["']/i.test(tag);
  if (hasWidth && hasHeight) return new Blob([text], { type: 'image/svg+xml' });

  const viewBox = /viewBox\s*=\s*["']\s*([\d.+-]+)[\s,]+([\d.+-]+)[\s,]+([\d.+-]+)[\s,]+([\d.+-]+)/i.exec(
    text,
  );
  if (!viewBox) throw new ConversionError('svg-no-size');
  const vbWidth = Number(viewBox[3]);
  const vbHeight = Number(viewBox[4]);
  if (!(vbWidth > 0) || !(vbHeight > 0)) throw new ConversionError('svg-no-size');

  let attributes = '';
  if (!hasWidth) attributes += ` width="${vbWidth}"`;
  if (!hasHeight) attributes += ` height="${vbHeight}"`;
  const patched = text.replace(svgTag[0], tag.replace(/\s*>$/, ` ${attributes.trim()}>`));
  return new Blob([patched], { type: 'image/svg+xml' });
}
