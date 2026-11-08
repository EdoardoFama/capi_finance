// Gera os ícones PNG do PWA (sem dependências): fundo preto, anel verde e barras.
// Uso: npm run icons
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

const GREEN = [52, 211, 153];
const BG = [0, 0, 0];

// Retorna true se o ponto normalizado (0..1) pertence ao desenho
function inside(x, y) {
  const dx = x - 0.5, dy = y - 0.5;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d > 0.33 && d < 0.39) return true; // anel
  // três barras (gráfico)
  const bars = [
    [0.36, 0.44, 0.56],
    [0.46, 0.54, 0.44],
    [0.56, 0.64, 0.34],
  ];
  for (const [x0, x1, top] of bars) if (x >= x0 && x <= x1 && y >= top && y <= 0.64) return true;
  return false;
}

function png(size) {
  const SS = 4; // supersampling para anti-aliasing
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let py = 0; py < size; py++) {
    const row = py * (size * 4 + 1);
    raw[row] = 0;
    for (let px = 0; px < size; px++) {
      let hit = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++)
          if (inside((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size)) hit++;
      const a = hit / (SS * SS);
      const o = row + 1 + px * 4;
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round(BG[i] * (1 - a) + GREEN[i] * a);
      raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = new URL('../public/icons/', import.meta.url);
mkdirSync(out, { recursive: true });
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  writeFileSync(new URL(name, out), png(size));
}
console.log('Ícones gerados em public/icons/');

