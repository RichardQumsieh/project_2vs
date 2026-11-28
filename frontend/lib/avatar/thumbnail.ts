import type { AvatarConfig } from "./config";
import { avatarCacheKey } from "./config";
import { bakeAvatar, buildAvatar } from "./geometry";
import { cross, dot, normalize, type Vec3 } from "./mat4";

const THUMB_SIZE = 64;
const cache = new Map<string, string>();

function rasterize(config: AvatarConfig, size: number): Uint8Array {
  const baked = bakeAvatar(buildAvatar(config));
  const rgba = new Uint8Array(size * size * 4);
  const depth = new Float32Array(size * size);
  depth.fill(-1e9);
  const x0 = -0.48;
  const x1 = 0.48;
  const y0 = 0.82;
  const y1 = 1.98;
  const light = normalize([0.25, 0.7, 0.7]);
  const { positions, colors, indices } = baked;
  for (let triangle = 0; triangle < indices.length; triangle += 3) {
    const ia = indices[triangle]!;
    const ib = indices[triangle + 1]!;
    const ic = indices[triangle + 2]!;
    const ax = positions[ia * 3]!;
    const ay = positions[ia * 3 + 1]!;
    const az = positions[ia * 3 + 2]!;
    const bx = positions[ib * 3]!;
    const by = positions[ib * 3 + 1]!;
    const bz = positions[ib * 3 + 2]!;
    const cx = positions[ic * 3]!;
    const cy = positions[ic * 3 + 1]!;
    const cz = positions[ic * 3 + 2]!;
    const ab: Vec3 = [bx - ax, by - ay, bz - az];
    const ac: Vec3 = [cx - ax, cy - ay, cz - az];
    const normal = normalize(cross(ab, ac));
    if (normal[0] === 0 && normal[1] === 0 && normal[2] === 0) continue;
    const shade = Math.max(0.38, Math.abs(dot(normal, light)));
    const red = Math.min(255, colors[ia * 3]! * shade * 255);
    const green = Math.min(255, colors[ia * 3 + 1]! * shade * 255);
    const blue = Math.min(255, colors[ia * 3 + 2]! * shade * 255);
    const project = (x: number, y: number) => ({
      x: ((x - x0) / (x1 - x0)) * (size - 1),
      y: (1 - (y - y0) / (y1 - y0)) * (size - 1),
    });
    const pa = project(ax, ay);
    const pb = project(bx, by);
    const pc = project(cx, cy);
    const minX = Math.max(0, Math.floor(Math.min(pa.x, pb.x, pc.x)));
    const maxX = Math.min(size - 1, Math.ceil(Math.max(pa.x, pb.x, pc.x)));
    const minY = Math.max(0, Math.floor(Math.min(pa.y, pb.y, pc.y)));
    const maxY = Math.min(size - 1, Math.ceil(Math.max(pa.y, pb.y, pc.y)));
    const area = (pb.x - pa.x) * (pc.y - pa.y) - (pc.x - pa.x) * (pb.y - pa.y);
    if (Math.abs(area) < 0.01) continue;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const px = x + 0.5;
        const py = y + 0.5;
        const w0 = ((pb.x - px) * (pc.y - py) - (pc.x - px) * (pb.y - py)) / area;
        const w1 = ((pc.x - px) * (pa.y - py) - (pa.x - px) * (pc.y - py)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * az + w1 * bz + w2 * cz;
        const pixel = y * size + x;
        if (z <= depth[pixel]!) continue;
        depth[pixel] = z;
        const offset = pixel * 4;
        rgba[offset] = red;
        rgba[offset + 1] = green;
        rgba[offset + 2] = blue;
        rgba[offset + 3] = 255;
      }
    }
  }
  return rgba;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const value of bytes) {
    a = (a + value) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out[4] = type.charCodeAt(0);
  out[5] = type.charCodeAt(1);
  out[6] = type.charCodeAt(2);
  out[7] = type.charCodeAt(3);
  out.set(data, 8);
  const crc = crc32(out.subarray(4, 8 + data.length));
  view.setUint32(8 + data.length, crc);
  return out;
}

function zlibStore(data: Uint8Array): Uint8Array {
  const blocks: Uint8Array[] = [];
  let offset = 0;
  while (offset < data.length) {
    const length = Math.min(65535, data.length - offset);
    const last = offset + length >= data.length;
    const block = new Uint8Array(5 + length);
    block[0] = last ? 1 : 0;
    block[1] = length & 255;
    block[2] = length >> 8;
    const nlen = (~length) & 0xffff;
    block[3] = nlen & 255;
    block[4] = nlen >> 8;
    block.set(data.subarray(offset, offset + length), 5);
    blocks.push(block);
    offset += length;
  }
  const checksum = adler32(data);
  const size = 2 + blocks.reduce((sum, block) => sum + block.length, 0) + 4;
  const out = new Uint8Array(size);
  out[0] = 0x78;
  out[1] = 0x01;
  let cursor = 2;
  for (const block of blocks) {
    out.set(block, cursor);
    cursor += block.length;
  }
  const view = new DataView(out.buffer);
  view.setUint32(cursor, checksum);
  return out;
}

export function pngFromRgba(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 4);
    raw[row] = 0;
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), row + 1);
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [signature, chunk("IHDR", ihdr), chunk("IDAT", zlibStore(raw)), chunk("IEND", new Uint8Array())];
  const png = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let cursor = 0;
  for (const part of parts) {
    png.set(part, cursor);
    cursor += part.length;
  }
  return png;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary);
}

export function renderAvatarPng(config: AvatarConfig, size = THUMB_SIZE): Uint8Array {
  return pngFromRgba(size, size, rasterize(config, size));
}

export function renderAvatarRgba(config: AvatarConfig, size = THUMB_SIZE): Uint8Array {
  return rasterize(config, size);
}

export function thumbnailDataUrl(config: AvatarConfig): string {
  const key = avatarCacheKey(config);
  const cached = cache.get(key);
  if (cached) return cached;
  const url = `data:image/png;base64,${bytesToBase64(renderAvatarPng(config))}`;
  if (cache.size > 240) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, url);
  return url;
}

export function clearThumbnailCache() {
  cache.clear();
}
