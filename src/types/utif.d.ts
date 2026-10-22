declare module 'utif' {
  export interface Ifd {
    width: number;
    height: number;
    [key: string]: unknown;
  }

  const UTIF: {
    decode(buffer: ArrayBuffer | Uint8Array): Ifd[];
    decodeImage(buffer: ArrayBuffer | Uint8Array, ifd: Ifd): void;
    toRGBA8(ifd: Ifd): Uint8Array;
    encodeImage(
      rgba: Uint8Array,
      width: number,
      height: number,
      metadata?: unknown,
    ): ArrayBuffer;
  };

  export default UTIF;
}
