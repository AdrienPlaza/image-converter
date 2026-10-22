/**
 * SVG en sortie : pas de vectorisation (ce serait un traceur, v2). On produit
 * un SVG honnête contenant l'image PNG embarquée en base64 — sans aucune
 * ressource externe.
 *
 * En entrée : Chrome exige des dimensions intrinsèques pour rastériser un SVG.
 * On injecte width/height depuis le viewBox quand elles manquent.
 */
import { ConversionError } from '../errors';
import { bytesToBase64 } from '../util';

export function encodeSvgEmbedded(png: Uint8Array, width: number, height: number): Uint8Array {
  const base64 = bytesToBase64(png);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}">` +
    `<image width="${width}" height="${height}" href="data:image/png;base64,${base64}"/>` +
    `</svg>`;
  return new TextEncoder().encode(svg);
}

/**
 * Garantit que le SVG possède width/height (sinon `createImageBitmap` échoue).
 * Les valeurs sont déduites du viewBox ; sans viewBox, erreur explicite.
 */
export function normalizeSvg(bytes: Uint8Array): Blob {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const svgTag = /<svg\b[^>]*>/i.exec(text);
  if (!svgTag) throw new ConversionError('svg-no-size');

  const tag = svgTag[0];
  // Les pourcentages/unités relatives ne donnent pas de taille intrinsèque.
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
