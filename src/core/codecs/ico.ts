/**
 * ICO container embedding a PNG (supported by Windows, Chrome and most
 * tools since Vista). Single entry, maximum size 256 px.
 */
export function encodeIco(png: Uint8Array, width: number, height: number): Uint8Array {
  if (width < 1 || height < 1 || width > 256 || height > 256) {
    throw new Error(`ICO: invalid dimensions ${width}x${height}`);
  }
  const out = new Uint8Array(22 + png.length);
  const view = new DataView(out.buffer);

  // ICONDIR
  view.setUint16(0, 0, true); // reserved
  view.setUint16(2, 1, true); // type 1 = icon
  view.setUint16(4, 1, true); // image count

  // ICONDIRENTRY (0 means 256)
  out[6] = width === 256 ? 0 : width;
  out[7] = height === 256 ? 0 : height;
  out[8] = 0; // palette colors
  out[9] = 0; // reserved
  view.setUint16(10, 1, true); // plans
  view.setUint16(12, 32, true); // bits per pixel
  view.setUint32(14, png.length, true);
  view.setUint32(18, 22, true); // data offset

  out.set(png, 22);
  return out;
}
