import { inflateSync } from "node:zlib";

export interface DecodedImage {
  width: number;
  height: number;
  channels: number;
  pixels: Buffer;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function decodePng(file: Buffer): DecodedImage {
  if (!file.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("Not a PNG file");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat: Buffer[] = [];

  while (offset < file.length) {
    const length = file.readUInt32BE(offset);
    const type = file.toString("ascii", offset + 4, offset + 8);
    const data = file.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
      interlace = data.readUInt8(12);
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  if (bitDepth !== 8) throw new Error(`Unsupported PNG bit depth ${bitDepth}, expected 8`);
  if (interlace !== 0) throw new Error("Interlaced PNGs are not supported");

  const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : 0;
  if (channels === 0) throw new Error(`Unsupported PNG colour type ${colorType}, expected RGB or RGBA`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);

  let rawAt = 0;
  for (let row = 0; row < height; row++) {
    const filter = raw[rawAt++];
    const rowStart = row * stride;
    const previousStart = rowStart - stride;

    for (let index = 0; index < stride; index++) {
      const value = raw[rawAt + index];
      const left = index >= channels ? pixels[rowStart + index - channels] : 0;
      const up = row > 0 ? pixels[previousStart + index] : 0;
      const upLeft = row > 0 && index >= channels ? pixels[previousStart + index - channels] : 0;

      let restored: number;
      switch (filter) {
        case 0:
          restored = value;
          break;
        case 1:
          restored = value + left;
          break;
        case 2:
          restored = value + up;
          break;
        case 3:
          restored = value + ((left + up) >> 1);
          break;
        case 4:
          restored = value + paeth(left, up, upLeft);
          break;
        default:
          throw new Error(`Unknown PNG row filter ${filter}`);
      }
      pixels[rowStart + index] = restored & 0xff;
    }
    rawAt += stride;
  }

  return { width, height, channels, pixels };
}
