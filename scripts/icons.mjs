import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { crc32, deflateSync, inflateSync } from "node:zlib";

const SIZES = [16, 32, 48, 128];

function chunk(type, data) {
  const typeAndData = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData) >>> 0);
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const dest = y * (stride + 1);
    raw[dest] = 0;
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), dest + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const diagonal = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= diagonal) return left;
  if (upDistance <= diagonal) return up;
  return upLeft;
}

function decodePng(file) {
  const data = readFileSync(file);
  if (data[0] !== 137 || data.toString("ascii", 1, 4) !== "PNG") throw new Error(`${file} is not a PNG.`);
  let width = 0;
  let height = 0;
  const idat = [];
  let offset = 8;
  while (offset + 8 <= data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.toString("ascii", offset + 4, offset + 8);
    const body = data.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8 || body[9] !== 6 || body[12] !== 0) {
        throw new Error(`${file} must be an 8-bit RGBA PNG.`);
      }
    } else if (type === "IDAT") {
      idat.push(body);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  const inflated = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const rgba = new Uint8Array(width * height * 4);
  let source = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[source];
    source += 1;
    const row = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const value = inflated[source + x] ?? 0;
      const left = x >= 4 ? rgba[row + x - 4] ?? 0 : 0;
      const up = y > 0 ? rgba[row - stride + x] ?? 0 : 0;
      const upLeft = y > 0 && x >= 4 ? rgba[row - stride + x - 4] ?? 0 : 0;
      let decoded = value;
      if (filter === 1) decoded = (value + left) & 255;
      else if (filter === 2) decoded = (value + up) & 255;
      else if (filter === 3) decoded = (value + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) decoded = (value + paeth(left, up, upLeft)) & 255;
      else if (filter !== 0) throw new Error(`${file} uses an unknown PNG filter.`);
      rgba[row + x] = decoded;
    }
    source += stride;
  }
  return { width, height, rgba };
}

function resize(source, size) {
  const dest = new Uint8Array(size * size * 4);
  const scaleX = source.width / size;
  const scaleY = source.height / size;
  for (let y = 0; y < size; y += 1) {
    const y0 = y * scaleY;
    const y1 = (y + 1) * scaleY;
    const top = Math.floor(y0);
    const bottom = Math.min(source.height - 1, Math.ceil(y1) - 1);
    for (let x = 0; x < size; x += 1) {
      const x0 = x * scaleX;
      const x1 = (x + 1) * scaleX;
      const left = Math.floor(x0);
      const right = Math.min(source.width - 1, Math.ceil(x1) - 1);
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      let weight = 0;
      for (let sy = top; sy <= bottom; sy += 1) {
        const rowWeight = Math.min(sy + 1, y1) - Math.max(sy, y0);
        if (rowWeight <= 0) continue;
        for (let sx = left; sx <= right; sx += 1) {
          const columnWeight = Math.min(sx + 1, x1) - Math.max(sx, x0);
          if (columnWeight <= 0) continue;
          const sample = rowWeight * columnWeight;
          const index = (sy * source.width + sx) * 4;
          const coverage = (source.rgba[index + 3] ?? 0) / 255;
          red += (source.rgba[index] ?? 0) * coverage * sample;
          green += (source.rgba[index + 1] ?? 0) * coverage * sample;
          blue += (source.rgba[index + 2] ?? 0) * coverage * sample;
          alpha += (source.rgba[index + 3] ?? 0) * sample;
          weight += sample;
        }
      }
      const out = (y * size + x) * 4;
      const averageAlpha = weight === 0 ? 0 : alpha / weight;
      dest[out + 3] = Math.round(averageAlpha);
      if (averageAlpha > 0) {
        const straight = 255 / averageAlpha;
        dest[out] = Math.min(255, Math.round((red / weight) * straight));
        dest[out + 1] = Math.min(255, Math.round((green / weight) * straight));
        dest[out + 2] = Math.min(255, Math.round((blue / weight) * straight));
      }
    }
  }
  return dest;
}

function writeSized(directory, name, source) {
  for (const size of SIZES) {
    const file = name === "default" ? `${size}.png` : `ready-${size}.png`;
    writeFileSync(`${directory}/${file}`, encodePng(size, size, resize(source, size)));
  }
}

export function writeIcons(directory) {
  mkdirSync(directory, { recursive: true });
  writeSized(directory, "default", decodePng("assets/icon_default.png"));
  writeSized(directory, "ready", decodePng("assets/icon_ready.png"));
}

if (process.argv[1] && dirname(process.argv[1]).endsWith("scripts")) {
  writeIcons(process.argv[2] ?? "dist/icons");
}
