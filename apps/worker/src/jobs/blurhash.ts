const BASE83 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~";

function encode83(value: number, length: number): string {
  let result = "";
  for (let index = 1; index <= length; index += 1) {
    const digit = Math.floor(value / 83 ** (length - index)) % 83;
    result += BASE83.charAt(digit);
  }
  return result;
}

function signPow(value: number, exponent: number): number {
  return Math.sign(value) * Math.abs(value) ** exponent;
}

function toLinear(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

/**
 * Minimal BlurHash encoder (4x3 components, RGBA input). Missing alpha is
 * treated as opaque.
 */
export function encodeBlurhash(
  pixels: Uint8Array,
  width: number,
  height: number,
  channels = 4,
): string {
  const componentsX = 4;
  const componentsY = 3;
  if (width === 0 || height === 0) {
    throw new RangeError("BlurHash input must not be empty");
  }

  const factorAt = (componentX: number, componentY: number): [number, number, number] => {
    let r = 0;
    let g = 0;
    let b = 0;
    const normalisation = componentX === 0 && componentY === 0 ? 1 : 2;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * channels;
        const basis =
          Math.cos((Math.PI * componentX * x) / width) *
          Math.cos((Math.PI * componentY * y) / height);
        r += basis * toLinear(pixels[offset] ?? 0);
        g += basis * toLinear(pixels[offset + 1] ?? 0);
        b += basis * toLinear(pixels[offset + 2] ?? 0);
      }
    }
    const scale = normalisation / (width * height);
    return [r * scale, g * scale, b * scale];
  };

  let hash = encode83((componentsX - 1) + (componentsY - 1) * 9, 1);
  let dc: [number, number, number] = [0, 0, 0];
  for (let y = 0; y < componentsY; y += 1) {
    for (let x = 0; x < componentsX; x += 1) {
      const factor = factorAt(x, y);
      if (x === 0 && y === 0) {
        dc = factor;
        continue;
      }
      const quantR = Math.max(0, Math.min(18, Math.floor(signPow(factor[0], 0.5) * 9 + 9.5)));
      const quantG = Math.max(0, Math.min(18, Math.floor(signPow(factor[1], 0.5) * 9 + 9.5)));
      const quantB = Math.max(0, Math.min(18, Math.floor(signPow(factor[2], 0.5) * 9 + 9.5)));
      hash += encode83(quantR * 19 * 19 + quantG * 19 + quantB, 2);
    }
  }

  const dcValue =
    (Math.floor((dc[0] + 1) / 2 * 361) << 16) +
    (Math.floor((dc[1] + 1) / 2 * 361) << 8) +
    Math.floor((dc[2] + 1) / 2 * 361);
  return hash + encode83(dcValue, 4);
}
