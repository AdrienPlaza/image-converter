/**
 * Conteneur ICO embarquant un PNG (supporté par Windows, Chrome et la plupart
 * des outils depuis Vista). Une seule entrée, taille maximale 256 px.
 */
export function encodeIco(png: Uint8Array, width: number, height: number): Uint8Array {
  if (width < 1 || height < 1 || width > 256 || height > 256) {
    throw new Error(`ICO: dimensions invalides ${width}x${height}`);
  }
  const out = new Uint8Array(22 + png.length);
  const view = new DataView(out.buffer);

  // ICONDIR
  view.setUint16(0, 0, true); // réservé
  view.setUint16(2, 1, true); // type 1 = icône
  view.setUint16(4, 1, true); // nombre d'images

  // ICONDIRENTRY (0 signifie 256)
  out[6] = width === 256 ? 0 : width;
  out[7] = height === 256 ? 0 : height;
  out[8] = 0; // couleurs de la palette
  out[9] = 0; // réservé
  view.setUint16(10, 1, true); // plans
  view.setUint16(12, 32, true); // bits par pixel
  view.setUint32(14, png.length, true);
  view.setUint32(18, 22, true); // offset des données

  out.set(png, 22);
  return out;
}
