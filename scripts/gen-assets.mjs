/**
 * Gera todos os icones e splash screens do app Android + os assets da ficha da
 * Play Store, sem dependencias nativas.
 *
 * Cada densidade e renderizada no tamanho nativo (nao ha reducao de imagem
 * grande), com supersampling 3x3 nas bordas do glifo para antialiasing.
 *
 * Uso: node scripts/gen-assets.mjs
 */
import zlib from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RES = join(root, 'android', 'app', 'src', 'main', 'res');
const STORE = join(root, 'store');

// ===== PALETA (derivada do gradiente do header do jogo) =====
const BG_TOP = [0xff, 0x9a, 0x76];
const BG_BOTTOM = [0xe6, 0x4a, 0x19];
const BRAND_SOLID = '#EF6A3E'; // cor de fundo do adaptive icon e do splash v31
const GLYPH = [0xff, 0xff, 0xff];
const SPLASH_TOP = [0xff, 0xf7, 0xe0]; // mesmo creme da tela inicial do jogo
const SPLASH_BOTTOM = [0xff, 0xd1, 0x94];
const SPLASH_GLYPH = [0xe6, 0x4a, 0x19];

// ===== PNG =====
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** rgba: Uint8Array com w*h*4 bytes. hasAlpha=false grava PNG RGB (exigido pela Play para o icone 512). */
function encodePng(w, h, rgba, hasAlpha = true) {
  const channels = hasAlpha ? 4 : 3;
  const stride = w * channels;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (stride + 1);
    raw[o] = 0; // filtro none
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      const d = o + 1 + x * channels;
      raw[d] = rgba[s];
      raw[d + 1] = rgba[s + 1];
      raw[d + 2] = rgba[s + 2];
      if (hasAlpha) raw[d + 3] = rgba[s + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = hasAlpha ? 6 : 2; // color type: RGBA / RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ===== GLIFO: duas notas unidas por uma barra (♫) =====
// Definido em espaco proprio; a bbox abaixo foi calculada a partir das formas.
const G = {
  head1: { cx: 0.33, cy: 0.70 },
  head2: { cx: 0.67, cy: 0.62 },
  rx: 0.105,
  ry: 0.078,
  rot: -0.35, // mesma inclinacao da cabeca de nota desenhada no canvas do jogo
  stemW: 0.030,
  stem1: { cx: 0.419, top: 0.285, bottom: 0.705 },
  stem2: { cx: 0.759, top: 0.205, bottom: 0.625 },
  beam: { ax: 0.419, ay: 0.285, bx: 0.759, by: 0.205, half: 0.045 },
  bbox: { x0: 0.228, y0: 0.160, x1: 0.804, y1: 0.782 },
};
const COS_R = Math.cos(G.rot);
const SIN_R = Math.sin(G.rot);

function inEllipse(x, y, c) {
  const dx = x - c.cx;
  const dy = y - c.cy;
  const rxp = dx * COS_R + dy * SIN_R;
  const ryp = -dx * SIN_R + dy * COS_R;
  return (rxp * rxp) / (G.rx * G.rx) + (ryp * ryp) / (G.ry * G.ry) <= 1;
}

function inStem(x, y, s) {
  const hw = G.stemW / 2;
  return x >= s.cx - hw && x <= s.cx + hw && y >= s.top && y <= s.bottom;
}

function inBeam(x, y) {
  const { ax, ay, bx, by, half } = G.beam;
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  let t = ((x - ax) * vx + (y - ay) * vy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const px = x - (ax + t * vx);
  const py = y - (ay + t * vy);
  return px * px + py * py <= half * half;
}

function inGlyph(x, y) {
  return (
    inEllipse(x, y, G.head1) ||
    inEllipse(x, y, G.head2) ||
    inStem(x, y, G.stem1) ||
    inStem(x, y, G.stem2) ||
    inBeam(x, y)
  );
}

// ===== RENDER =====
const lerp = (a, b, t) => a + (b - a) * t;

function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/**
 * @param {object} o
 * @param {number} o.w largura em px
 * @param {number} o.h altura em px
 * @param {'gradient'|'transparent'} o.bg
 * @param {[number,number,number]} [o.top] cor do topo do gradiente
 * @param {[number,number,number]} [o.bottom] cor da base do gradiente
 * @param {'square'|'circle'|'roundrect'} [o.shape] mascara aplicada ao fundo
 * @param {number} o.frac fracao do menor lado ocupada pelo glifo
 * @param {[number,number,number]} [o.glyph] cor do glifo
 * @param {boolean} [o.staff] desenha 5 linhas de pauta ao fundo
 */
function render(o) {
  const { w, h, frac } = o;
  const bgTop = o.top || BG_TOP;
  const bgBottom = o.bottom || BG_BOTTOM;
  const glyphColor = o.glyph || GLYPH;
  const shape = o.shape || 'square';
  const px = new Uint8Array(w * h * 4);

  const minSide = Math.min(w, h);
  const gh = G.bbox.y1 - G.bbox.y0;
  const gw = G.bbox.x1 - G.bbox.x0;
  const scale = (frac * minSide) / Math.max(gw, gh); // px por unidade de glifo
  const gcx = (G.bbox.x0 + G.bbox.x1) / 2;
  const gcy = (G.bbox.y0 + G.bbox.y1) / 2;
  // Canvas px -> espaco do glifo
  const toG = (X, Y) => [(X - w / 2) / scale + gcx, (Y - h / 2) / scale + gcy];

  // bbox do glifo em px, com folga de 2px para o antialiasing
  const gx0 = w / 2 + (G.bbox.x0 - gcx) * scale - 2;
  const gx1 = w / 2 + (G.bbox.x1 - gcx) * scale + 2;
  const gy0 = h / 2 + (G.bbox.y0 - gcy) * scale - 2;
  const gy1 = h / 2 + (G.bbox.y1 - gcy) * scale + 2;

  const cx = w / 2;
  const cy = h / 2;
  const radius = minSide / 2;
  const rrRadius = minSide * 0.22; // raio do canto do roundrect
  const SS = 3; // supersampling NxN

  // Cobertura da mascara de fundo (1 = opaco).
  function bgCoverage(X, Y) {
    if (shape === 'square') return 1;
    let hit = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const x = X + (sx + 0.5) / SS;
        const y = Y + (sy + 0.5) / SS;
        if (shape === 'circle') {
          const dx = x - cx;
          const dy = y - cy;
          if (dx * dx + dy * dy <= radius * radius) hit++;
        } else {
          // roundrect
          const dx = Math.abs(x - cx) - (w / 2 - rrRadius);
          const dy = Math.abs(y - cy) - (h / 2 - rrRadius);
          if (dx <= 0 || dy <= 0) {
            if (x >= 0 && x <= w && y >= 0 && y <= h) hit++;
          } else if (dx * dx + dy * dy <= rrRadius * rrRadius) hit++;
        }
      }
    }
    return hit / (SS * SS);
  }

  for (let Y = 0; Y < h; Y++) {
    const t = h === 1 ? 0 : Y / (h - 1);
    let br = lerp(bgTop[0], bgBottom[0], t);
    let bgc = lerp(bgTop[1], bgBottom[1], t);
    let bb = lerp(bgTop[2], bgBottom[2], t);

    for (let X = 0; X < w; X++) {
      let r = br;
      let g = bgc;
      let b = bb;
      let a = o.bg === 'transparent' ? 0 : 255 * bgCoverage(X, Y);

      // Linhas de pauta (feature graphic): 5 linhas horizontais suaves.
      if (o.staff && o.bg !== 'transparent') {
        const lineSpacing = h * 0.085;
        const first = h / 2 - lineSpacing * 2;
        for (let i = 0; i < 5; i++) {
          const ly = first + i * lineSpacing;
          const d = Math.abs(Y + 0.5 - ly);
          const thickness = Math.max(1.5, h * 0.004);
          if (d <= thickness) {
            const k = 0.22 * (1 - d / thickness);
            r = lerp(r, 255, k);
            g = lerp(g, 255, k);
            b = lerp(b, 255, k);
          }
        }
      }

      // Glifo
      if (X + 1 >= gx0 && X <= gx1 && Y + 1 >= gy0 && Y <= gy1) {
        let hit = 0;
        for (let sy = 0; sy < SS; sy++) {
          for (let sx = 0; sx < SS; sx++) {
            const [ux, uy] = toG(X + (sx + 0.5) / SS, Y + (sy + 0.5) / SS);
            if (inGlyph(ux, uy)) hit++;
          }
        }
        if (hit > 0) {
          const cov = hit / (SS * SS);
          // Composita o glifo sobre o fundo, preservando alpha correto quando
          // o fundo e transparente (adaptive icon foreground).
          const outA = a + 255 * cov * (1 - a / 255);
          if (outA > 0) {
            const fa = (255 * cov) / outA;
            r = lerp(r, glyphColor[0], fa);
            g = lerp(g, glyphColor[1], fa);
            b = lerp(b, glyphColor[2], fa);
          }
          a = outA;
        }
      }

      const i = (Y * w + X) * 4;
      px[i] = Math.round(r);
      px[i + 1] = Math.round(g);
      px[i + 2] = Math.round(b);
      px[i + 3] = Math.round(a);
    }
  }
  return px;
}

async function write(path, w, h, px, hasAlpha = true) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, encodePng(w, h, px, hasAlpha));
  console.log(`  ${path.replace(root + '\\', '').replace(root + '/', '')}  (${w}x${h})`);
}

// ===== TABELAS DE DENSIDADE =====
const LAUNCHER = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const FOREGROUND = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
const SPLASH_PORT = {
  mdpi: [320, 480],
  hdpi: [480, 800],
  xhdpi: [720, 1280],
  xxhdpi: [960, 1600],
  xxxhdpi: [1280, 1920],
};

console.log('Icones do launcher (legacy, API 23-25):');
for (const [d, size] of Object.entries(LAUNCHER)) {
  await write(
    join(RES, `mipmap-${d}`, 'ic_launcher.png'),
    size,
    size,
    render({ w: size, h: size, bg: 'gradient', shape: 'roundrect', frac: 0.62 })
  );
  await write(
    join(RES, `mipmap-${d}`, 'ic_launcher_round.png'),
    size,
    size,
    render({ w: size, h: size, bg: 'gradient', shape: 'circle', frac: 0.58 })
  );
}

console.log('Foreground do adaptive icon (API 26+, glifo dentro da safe zone de 72/108dp):');
for (const [d, size] of Object.entries(FOREGROUND)) {
  await write(
    join(RES, `mipmap-${d}`, 'ic_launcher_foreground.png'),
    size,
    size,
    render({ w: size, h: size, bg: 'transparent', frac: 0.42 })
  );
}

console.log('Splash screens:');
const splashOpts = {
  bg: 'gradient',
  top: SPLASH_TOP,
  bottom: SPLASH_BOTTOM,
  glyph: SPLASH_GLYPH,
  frac: 0.34,
};
for (const [d, [pw, ph]] of Object.entries(SPLASH_PORT)) {
  await write(
    join(RES, `drawable-port-${d}`, 'splash.png'),
    pw,
    ph,
    render({ ...splashOpts, w: pw, h: ph })
  );
  await write(
    join(RES, `drawable-land-${d}`, 'splash.png'),
    ph,
    pw,
    render({ ...splashOpts, w: ph, h: pw, frac: 0.30 })
  );
}
await write(join(RES, 'drawable', 'splash.png'), 480, 800, render({ ...splashOpts, w: 480, h: 800 }));

console.log('Assets da ficha da Play Store (store/):');
// Play exige 512x512, PNG 32-bit, SEM transparencia e sem cantos arredondados.
await write(
  join(STORE, 'play-icon-512.png'),
  512,
  512,
  render({ w: 512, h: 512, bg: 'gradient', shape: 'square', frac: 0.60 }),
  false
);
await write(
  join(STORE, 'play-feature-graphic-1024x500.png'),
  1024,
  500,
  render({ w: 1024, h: 500, bg: 'gradient', shape: 'square', frac: 0.55, staff: true }),
  false
);
// Icone mestre, caso queira reprocessar em outra ferramenta depois.
await write(
  join(STORE, 'icon-master-1024.png'),
  1024,
  1024,
  render({ w: 1024, h: 1024, bg: 'gradient', shape: 'square', frac: 0.60 })
);

console.log(`\nCor de marca do adaptive icon / splash v31: ${BRAND_SOLID}`);
console.log(`(rgb ${hexToRgb(BRAND_SOLID).join(', ')})`);
console.log('Assets gerados com sucesso.');
