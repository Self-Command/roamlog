type QrModule = boolean | null;

const RS_BLOCKS_M: readonly (readonly number[])[] = [
  [1, 26, 16],
  [1, 44, 28],
  [1, 70, 44],
  [2, 50, 32],
  [2, 67, 43],
  [4, 43, 27],
  [4, 49, 31],
  [2, 60, 38, 2, 61, 39],
  [3, 58, 36, 2, 59, 37],
  [4, 69, 43, 1, 70, 44],
  [1, 80, 50, 4, 81, 51],
  [6, 58, 36, 2, 59, 37],
  [8, 59, 37, 1, 60, 38],
  [4, 64, 40, 5, 65, 41],
  [5, 65, 41, 5, 66, 42],
  [7, 73, 45, 3, 74, 46],
  [10, 74, 46, 1, 75, 47],
  [9, 69, 43, 4, 70, 44],
  [3, 70, 44, 11, 71, 45],
  [3, 67, 41, 13, 68, 42],
  [17, 68, 42],
  [17, 74, 46],
  [4, 75, 47, 14, 76, 48],
  [6, 73, 45, 14, 74, 46],
  [8, 75, 47, 13, 76, 48],
  [19, 74, 46, 4, 75, 47],
  [22, 73, 45, 3, 74, 46],
  [3, 73, 45, 23, 74, 46],
  [21, 73, 45, 7, 74, 46],
  [19, 75, 47, 10, 76, 48],
  [2, 74, 46, 29, 75, 47],
  [10, 74, 46, 23, 75, 47],
  [14, 74, 46, 21, 75, 47],
  [14, 74, 46, 23, 75, 47],
  [12, 75, 47, 26, 76, 48],
  [6, 75, 47, 34, 76, 48],
  [29, 74, 46, 14, 75, 47],
  [13, 74, 46, 32, 75, 47],
  [40, 75, 47, 7, 76, 48],
  [18, 75, 47, 31, 76, 48],
];

const ALIGNMENT_POSITIONS: readonly (readonly number[])[] = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
  [6, 30, 54],
  [6, 32, 58],
  [6, 34, 62],
  [6, 26, 46, 66],
  [6, 26, 48, 70],
  [6, 26, 50, 74],
  [6, 30, 54, 78],
  [6, 30, 56, 82],
  [6, 30, 58, 86],
  [6, 34, 62, 90],
  [6, 28, 50, 72, 94],
  [6, 26, 50, 74, 98],
  [6, 30, 54, 78, 102],
  [6, 28, 54, 80, 106],
  [6, 32, 58, 84, 110],
  [6, 30, 58, 86, 114],
  [6, 34, 62, 90, 118],
  [6, 26, 50, 74, 98, 122],
  [6, 30, 54, 78, 102, 126],
  [6, 26, 52, 78, 104, 130],
  [6, 30, 56, 82, 108, 134],
  [6, 34, 60, 86, 112, 138],
  [6, 30, 58, 86, 114, 142],
  [6, 34, 62, 90, 118, 146],
  [6, 30, 54, 78, 102, 126, 150],
  [6, 24, 50, 76, 102, 128, 154],
  [6, 28, 54, 80, 106, 132, 158],
  [6, 32, 58, 84, 110, 136, 162],
  [6, 26, 54, 82, 110, 138, 166],
  [6, 30, 58, 86, 114, 142, 170],
];

const EXP_TABLE = new Array<number>(256);
const LOG_TABLE = new Array<number>(256);

for (let index = 0; index < 8; index += 1) {
  EXP_TABLE[index] = 1 << index;
}
for (let index = 8; index < 256; index += 1) {
  EXP_TABLE[index] =
    (EXP_TABLE[index - 4] ?? 0) ^
    (EXP_TABLE[index - 5] ?? 0) ^
    (EXP_TABLE[index - 6] ?? 0) ^
    (EXP_TABLE[index - 8] ?? 0);
}
for (let index = 0; index < 255; index += 1) {
  LOG_TABLE[EXP_TABLE[index] ?? 0] = index;
}

function gexp(value: number): number {
  let normalized = value;
  while (normalized < 0) normalized += 255;
  while (normalized >= 256) normalized -= 255;
  return EXP_TABLE[normalized] ?? 0;
}

function glog(value: number): number {
  return LOG_TABLE[value] ?? 0;
}

function gfMultiply(left: number, right: number): number {
  if (left === 0 || right === 0) return 0;
  return gexp(glog(left) + glog(right));
}

function blocksFor(version: number): Array<{ total: number; data: number }> {
  const raw = RS_BLOCKS_M[version - 1] ?? [];
  const blocks: Array<{ total: number; data: number }> = [];
  for (let index = 0; index < raw.length; index += 3) {
    const count = raw[index] ?? 0;
    const total = raw[index + 1] ?? 0;
    const data = raw[index + 2] ?? 0;
    for (let block = 0; block < count; block += 1) {
      blocks.push({ total, data });
    }
  }
  return blocks;
}

function totalDataCodewords(version: number): number {
  return blocksFor(version).reduce((total, block) => total + block.data, 0);
}

function findVersion(byteLength: number): number {
  for (let version = 1; version <= 40; version += 1) {
    const countBits = version <= 9 ? 8 : 16;
    const requiredBits = 4 + countBits + byteLength * 8;
    if (requiredBits <= totalDataCodewords(version) * 8) {
      return version;
    }
  }
  throw new Error("QR payload is too large.");
}

function appendBits(target: number[], value: number, length: number): void {
  for (let index = length - 1; index >= 0; index -= 1) {
    target.push((value >>> index) & 1);
  }
}

function generatorPolynomial(errorCodewords: number): number[] {
  let polynomial = [1];
  for (let index = 0; index < errorCodewords; index += 1) {
    const next = new Array<number>(polynomial.length + 1).fill(0);
    for (let coefficient = 0; coefficient < polynomial.length; coefficient += 1) {
      const value = polynomial[coefficient] ?? 0;
      next[coefficient] = (next[coefficient] ?? 0) ^ value;
      next[coefficient + 1] = (next[coefficient + 1] ?? 0) ^ gfMultiply(value, gexp(index));
    }
    polynomial = next;
  }
  return polynomial;
}

function errorCorrection(data: number[], errorCodewords: number): number[] {
  const generator = generatorPolynomial(errorCodewords);
  const remainder = [...data, ...new Array<number>(errorCodewords).fill(0)];

  for (let index = 0; index < data.length; index += 1) {
    const factor = remainder[index] ?? 0;
    if (factor === 0) continue;
    for (let coefficient = 0; coefficient < generator.length; coefficient += 1) {
      remainder[index + coefficient] =
        (remainder[index + coefficient] ?? 0) ^ gfMultiply(generator[coefficient] ?? 0, factor);
    }
  }

  return remainder.slice(data.length);
}

function createCodewords(payload: Uint8Array, version: number): number[] {
  const countBits = version <= 9 ? 8 : 16;
  const bits: number[] = [];
  appendBits(bits, 0b0100, 4);
  appendBits(bits, payload.length, countBits);
  for (const byte of payload) {
    appendBits(bits, byte, 8);
  }

  const dataCodewords = totalDataCodewords(version);
  const capacityBits = dataCodewords * 8;
  for (let index = 0; index < Math.min(4, capacityBits - bits.length); index += 1) {
    bits.push(0);
  }
  while (bits.length % 8 !== 0) {
    bits.push(0);
  }
  const bytes: number[] = [];
  for (let index = 0; index < bits.length; index += 8) {
    let value = 0;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value << 1) | (bits[index + bit] ?? 0);
    }
    bytes.push(value);
  }
  let padIndex = 0;
  while (bytes.length < dataCodewords) {
    bytes.push(padIndex % 2 === 0 ? 0xec : 0x11);
    padIndex += 1;
  }

  const blocks = blocksFor(version);
  let offset = 0;
  const dataBlocks: number[][] = [];
  const errorBlocks: number[][] = [];
  let maxData = 0;
  let maxError = 0;

  for (const block of blocks) {
    const data = bytes.slice(offset, offset + block.data);
    offset += block.data;
    const error = errorCorrection(data, block.total - block.data);
    dataBlocks.push(data);
    errorBlocks.push(error);
    maxData = Math.max(maxData, data.length);
    maxError = Math.max(maxError, error.length);
  }

  const interleaved: number[] = [];
  for (let index = 0; index < maxData; index += 1) {
    for (const block of dataBlocks) {
      const value = block[index];
      if (value !== undefined) interleaved.push(value);
    }
  }
  for (let index = 0; index < maxError; index += 1) {
    for (const block of errorBlocks) {
      const value = block[index];
      if (value !== undefined) interleaved.push(value);
    }
  }
  return interleaved;
}

function getBit(value: number, index: number): number {
  return (value >>> index) & 1;
}

function bchDigit(value: number): number {
  let digit = 0;
  let current = value;
  while (current !== 0) {
    digit += 1;
    current >>>= 1;
  }
  return digit;
}

function formatBits(mask: number): number {
  const generator = 0x537;
  let value = mask << 10;
  while (bchDigit(value) - bchDigit(generator) >= 0) {
    value ^= generator << (bchDigit(value) - bchDigit(generator));
  }
  return ((mask << 10) | value) ^ 0x5412;
}

function versionBits(version: number): number {
  const generator = 0x1f25;
  let value = version << 12;
  while (bchDigit(value) - bchDigit(generator) >= 0) {
    value ^= generator << (bchDigit(value) - bchDigit(generator));
  }
  return (version << 12) | value;
}

function maskApplies(mask: number, row: number, col: number): boolean {
  switch (mask) {
    case 0:
      return (row + col) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return col % 3 === 0;
    case 3:
      return (row + col) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5:
      return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6:
      return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    default:
      return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
  }
}

function setupProbe(modules: QrModule[][], row: number, col: number): void {
  const size = modules.length;
  for (let rowOffset = -1; rowOffset <= 7; rowOffset += 1) {
    if (row + rowOffset < 0 || row + rowOffset >= size) continue;
    for (let colOffset = -1; colOffset <= 7; colOffset += 1) {
      if (col + colOffset < 0 || col + colOffset >= size) continue;
      modules[row + rowOffset]![col + colOffset] =
        (rowOffset >= 0 && rowOffset <= 6 && (colOffset === 0 || colOffset === 6)) ||
        (colOffset >= 0 && colOffset <= 6 && (rowOffset === 0 || rowOffset === 6)) ||
        (rowOffset >= 2 && rowOffset <= 4 && colOffset >= 2 && colOffset <= 4);
    }
  }
}

function setupAlignment(modules: QrModule[][], version: number): void {
  const positions = ALIGNMENT_POSITIONS[version - 1] ?? [];
  for (const row of positions) {
    for (const col of positions) {
      if (modules[row]![col] !== null) continue;
      for (let rowOffset = -2; rowOffset <= 2; rowOffset += 1) {
        for (let colOffset = -2; colOffset <= 2; colOffset += 1) {
          modules[row + rowOffset]![col + colOffset] =
            rowOffset === -2 ||
            rowOffset === 2 ||
            colOffset === -2 ||
            colOffset === 2 ||
            (rowOffset === 0 && colOffset === 0);
        }
      }
    }
  }
}

function setupTiming(modules: QrModule[][]): void {
  const size = modules.length;
  for (let row = 8; row < size - 8; row += 1) {
    if (modules[row]![6] === null) modules[row]![6] = row % 2 === 0;
  }
  for (let col = 8; col < size - 8; col += 1) {
    if (modules[6]![col] === null) modules[6]![col] = col % 2 === 0;
  }
}

function setupTypeInfo(modules: QrModule[][], mask: number): void {
  const size = modules.length;
  const bits = formatBits(mask);
  for (let index = 0; index < 15; index += 1) {
    const value = getBit(bits, index) === 1;
    if (index < 6) modules[index]![8] = value;
    else if (index < 8) modules[index + 1]![8] = value;
    else modules[size - 15 + index]![8] = value;
  }
  for (let index = 0; index < 15; index += 1) {
    const value = getBit(bits, index) === 1;
    if (index < 8) modules[8]![size - index - 1] = value;
    else if (index < 9) modules[8]![15 - index - 1 + 1] = value;
    else modules[8]![15 - index - 1] = value;
  }
  modules[size - 8]![8] = true;
}

function setupVersionInfo(modules: QrModule[][], version: number): void {
  if (version < 7) return;
  const size = modules.length;
  const bits = versionBits(version);
  for (let index = 0; index < 18; index += 1) {
    const value = getBit(bits, index) === 1;
    modules[Math.floor(index / 3)]![(index % 3) + size - 11] = value;
    modules[(index % 3) + size - 11]![Math.floor(index / 3)] = value;
  }
}

function mapData(modules: QrModule[][], codewords: readonly number[], mask: number): void {
  const size = modules.length;
  let row = size - 1;
  let direction = -1;
  let byteIndex = 0;
  let bitIndex = 7;

  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1;
    while (true) {
      for (let offset = 0; offset < 2; offset += 1) {
        const targetCol = col - offset;
        if (modules[row]![targetCol] !== null) continue;
        let dark =
          byteIndex < codewords.length ? getBit(codewords[byteIndex] ?? 0, bitIndex) === 1 : false;
        if (maskApplies(mask, row, targetCol)) dark = !dark;
        modules[row]![targetCol] = dark;
        bitIndex -= 1;
        if (bitIndex < 0) {
          byteIndex += 1;
          bitIndex = 7;
        }
      }
      row += direction;
      if (row < 0 || row >= size) {
        row -= direction;
        direction = -direction;
        break;
      }
    }
  }
}

function penalty(modules: QrModule[][]): number {
  const size = modules.length;
  const dark = (row: number, col: number) => modules[row]?.[col] === true;
  let score = 0;

  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      let same = 0;
      for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
        for (let colOffset = -1; colOffset <= 1; colOffset += 1) {
          if (rowOffset === 0 && colOffset === 0) continue;
          const nextRow = row + rowOffset;
          const nextCol = col + colOffset;
          if (nextRow < 0 || nextRow >= size || nextCol < 0 || nextCol >= size) continue;
          if (dark(row, col) === dark(nextRow, nextCol)) same += 1;
        }
      }
      if (same > 5) score += 3 + same - 5;
    }
  }

  for (let row = 0; row < size - 1; row += 1) {
    for (let col = 0; col < size - 1; col += 1) {
      const count =
        Number(dark(row, col)) +
        Number(dark(row + 1, col)) +
        Number(dark(row, col + 1)) +
        Number(dark(row + 1, col + 1));
      if (count === 0 || count === 4) score += 3;
    }
  }

  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size - 6; col += 1) {
      if (
        dark(row, col) &&
        !dark(row, col + 1) &&
        dark(row, col + 2) &&
        dark(row, col + 3) &&
        dark(row, col + 4) &&
        !dark(row, col + 5) &&
        dark(row, col + 6)
      ) {
        score += 40;
      }
    }
  }
  for (let col = 0; col < size; col += 1) {
    for (let row = 0; row < size - 6; row += 1) {
      if (
        dark(row, col) &&
        !dark(row + 1, col) &&
        dark(row + 2, col) &&
        dark(row + 3, col) &&
        dark(row + 4, col) &&
        !dark(row + 5, col) &&
        dark(row + 6, col)
      ) {
        score += 40;
      }
    }
  }

  let darkCount = 0;
  for (const row of modules) {
    for (const value of row) {
      if (value === true) darkCount += 1;
    }
  }
  score += (Math.abs((100 * darkCount) / (size * size) - 50) / 5) * 10;
  return score;
}

function renderMask(codewords: readonly number[], version: number, mask: number): boolean[][] {
  const size = version * 4 + 17;
  const modules: QrModule[][] = Array.from({ length: size }, () =>
    Array<QrModule>(size).fill(null),
  );
  setupProbe(modules, 0, 0);
  setupProbe(modules, size - 7, 0);
  setupProbe(modules, 0, size - 7);
  setupAlignment(modules, version);
  setupTiming(modules);
  setupTypeInfo(modules, mask);
  setupVersionInfo(modules, version);
  mapData(modules, codewords, mask);
  return modules.map((row) => row.map((value) => value === true));
}

export function createQrMatrix(text: string, maskOverride?: number): boolean[][] {
  const payload = new TextEncoder().encode(text);
  const version = findVersion(payload.length);
  const codewords = createCodewords(payload, version);
  if (maskOverride !== undefined) {
    return renderMask(codewords, version, maskOverride);
  }
  const candidates = Array.from({ length: 8 }, (_, mask) => renderMask(codewords, version, mask));
  return candidates.reduce((best, candidate) =>
    penalty(candidate) < penalty(best) ? candidate : best,
  );
}

export function qrMatrixToSvgPath(matrix: readonly boolean[][], cellSize = 5, margin = 4): string {
  const commands: string[] = [];
  matrix.forEach((row, rowIndex) => {
    row.forEach((dark, colIndex) => {
      if (!dark) return;
      const x = (colIndex + margin) * cellSize;
      const y = (rowIndex + margin) * cellSize;
      commands.push(`M${x},${y}l${cellSize},0 0,${cellSize} -${cellSize},0 0,-${cellSize}z`);
    });
  });
  return commands.join(" ");
}
