import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

// 通过简单的矢量线段生成插件 PNG 图标，不需要额外图像依赖
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, content) {
  const label = Buffer.from(type);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(content.length);
  const check = Buffer.alloc(4);
  check.writeUInt32BE(crc32(Buffer.concat([label, content])));
  return Buffer.concat([size, label, content, check]);
}

function distance(x, y, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t);
}

const lines = [
  [[8, 23], [8, 9], 1.7], [[8, 9], [24, 9], 1.7], [[8, 16], [20, 16], 1.7],
  [[20, 23], [24, 19], 1.2], [[24, 19], [28, 23], 1.2],
];
await mkdir('public/icons', { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const colors = [0, 0, 0, 0];
      for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) {
        const px = (x + (sx + 0.5) / 3) * 32 / size;
        const py = (y + (sy + 0.5) / 3) * 32 / size;
        const cx = Math.max(9, Math.min(23, px));
        const cy = Math.max(9, Math.min(23, py));
        const opaque = Math.hypot(px - cx, py - cy) <= 9;
        const ink = lines.some(([a, b, radius]) => distance(px, py, a, b) <= radius);
        const rgb = ink ? [223, 235, 200] : [53, 95, 71];
        for (let c = 0; c < 3; c++) colors[c] += rgb[c] / 9;
        colors[3] += opaque ? 255 / 9 : 0;
      }
      const at = y * (size * 4 + 1) + 1 + x * 4;
      colors.forEach((value, index) => { pixels[at + index] = Math.round(value); });
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  await writeFile(`public/icons/${size}.png`, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0)),
  ]));
}
console.log('FlowWord icons generated');
