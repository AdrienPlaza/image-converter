/**
 * Encodeur BMP 24 bits (BGR, lignes bas→haut, padding 4 octets).
 * Chrome cannot encode BMP through canvas: direct implementation.
 * Alpha must be flattened upstream (24-bit BMP has no transparency).
 */
export function encodeBmp(image: ImageData): Uint8Array {
  const { width, height, data } = image;
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelSize = rowSize * height;
  const fileSize = 54 + pixelSize;
  const out = new Uint8Array(fileSize);
  const view = new DataView(out.buffer);

  out[0] = 0x42; // 'B'
  out[1] = 0x4d; // 'M'
  view.setUint32(2, fileSize, true);
  view.setUint32(10, 54, true); // pixel data offset
  view.setUint32(14, 40, true); // DIB header size
  view.setInt32(18, width, true);
  view.setInt32(22, height, true); // positif = bas→haut
  view.setUint16(26, 1, true); // plans
  view.setUint16(28, 24, true); // bits per pixel
  view.setUint32(34, pixelSize, true);
  view.setInt32(38, 2835, true); // 72 DPI
  view.setInt32(42, 2835, true);

  let offset = 54;
  for (let y = height - 1; y >= 0; y--) {
    let src = y * width * 4;
    for (let x = 0; x < width; x++) {
      out[offset++] = data[src + 2]!; // B
      out[offset++] = data[src + 1]!; // G
      out[offset++] = data[src]!; // R
      src += 4;
    }
    offset += rowSize - width * 3;
  }
  return out;
}
