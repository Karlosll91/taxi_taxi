import * as THREE from 'three';
import { mulberry32 } from '../core/math';

/**
 * All surface textures are painted at load time on canvases, so the game ships
 * no image files. Facades get a second map carrying roughness (green) and
 * metalness (blue) so glass reflects the sky while brick and plaster stay matt.
 */

let ANISO = 4;
export const setAnisotropy = (n: number) => (ANISO = n);

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toTex(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = ANISO;
  return t;
}

/** Tileable noise fill: per-pixel grain plus a few low-frequency waves. */
function grain(ctx: CanvasRenderingContext2D, base: [number, number, number], amp: number, blotch: number, seed: number) {
  const { width: w, height: h } = ctx.canvas;
  const rng = mulberry32(seed);
  const img = ctx.createImageData(w, h);
  const waves: number[][] = [];
  for (let i = 0; i < 6; i++) waves.push([Math.round(rng() * 6 - 3), Math.round(rng() * 6 - 3), rng() * 6.28]);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let lf = 0;
      for (const wv of waves) lf += Math.sin(((wv[0] * x) / w + (wv[1] * y) / h) * 6.2832 + wv[2]);
      const v = (rng() - 0.5) * amp + (lf / 6) * blotch;
      const i = (y * w + x) * 4;
      d[i] = base[0] + v;
      d[i + 1] = base[1] + v;
      d[i + 2] = base[2] + v;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Runs a draw function nine times so shapes crossing an edge wrap around. */
function wrapDraw(ctx: CanvasRenderingContext2D, fn: () => void) {
  const { width: w, height: h } = ctx.canvas;
  for (let ox = -1; ox <= 1; ox++) {
    for (let oy = -1; oy <= 1; oy++) {
      ctx.save();
      ctx.translate(ox * w, oy * h);
      fn();
      ctx.restore();
    }
  }
}

/** Builds a tangent-space normal map from the brightness of a canvas. */
function normalFrom(src: HTMLCanvasElement, strength: number): THREE.CanvasTexture {
  const w = src.width;
  const h = src.height;
  const s = src.getContext('2d')!.getImageData(0, 0, w, h).data;
  const out = makeCanvas(w, h);
  const octx = out.getContext('2d')!;
  const img = octx.createImageData(w, h);
  const lum = (x: number, y: number) => s[(((y + h) % h) * w + ((x + w) % w)) * 4 + 1] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (lum(x + 1, y) - lum(x - 1, y)) * strength;
      const dy = (lum(x, y + 1) - lum(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      img.data[i] = (-dx / l) * 127 + 128;
      img.data[i + 1] = (dy / l) * 127 + 128;
      img.data[i + 2] = (1 / l) * 127 + 128;
      img.data[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return toTex(out, false);
}

/** Paints colour and roughness/metalness in step. */
class Dual {
  a: CanvasRenderingContext2D;
  m: CanvasRenderingContext2D;
  ca: HTMLCanvasElement;
  cm: HTMLCanvasElement;
  constructor(w: number, h: number) {
    this.ca = makeCanvas(w, h);
    this.cm = makeCanvas(w, h);
    this.a = this.ca.getContext('2d')!;
    this.m = this.cm.getContext('2d')!;
    this.m.fillStyle = 'rgb(0,230,0)';
    this.m.fillRect(0, 0, w, h);
  }
  rect(x: number, y: number, w: number, h: number, color: string, rough = 0.9, metal = 0) {
    this.a.fillStyle = color;
    this.a.fillRect(x, y, w, h);
    this.m.fillStyle = `rgb(0,${Math.round(rough * 255)},${Math.round(metal * 255)})`;
    this.m.fillRect(x, y, w, h);
  }
  glass(x: number, y: number, w: number, h: number, color: string, rough = 0.08) {
    this.rect(x, y, w, h, color, rough, 0.9);
  }
  textures(): FacadeTex {
    return { map: toTex(this.ca), rm: toTex(this.cm, false) };
  }
}

export interface FacadeTex {
  map: THREE.CanvasTexture;
  rm: THREE.CanvasTexture;
}

const CELL = 128;

function brickFacade(): FacadeTex {
  const d = new Dual(512, 512);
  const rng = mulberry32(11);
  d.rect(0, 0, 512, 512, '#8f8478', 0.95);
  for (let row = 0; row < 86; row++) {
    const off = row % 2 ? 8 : 0;
    for (let col = -1; col < 33; col++) {
      const l = 36 + rng() * 14;
      d.rect(col * 16 + off, row * 6, 15, 5, `hsl(${14 + rng() * 8},${48 + rng() * 14}%,${l}%)`, 0.92);
    }
  }
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const x = c * CELL;
      const y = 512 - (r + 1) * CELL;
      d.rect(x, y + CELL - 9, CELL, 9, '#b9b3a8', 0.85);
      const balcony = c % 2 === 1;
      const wx = x + (balcony ? 14 : 26);
      const ww = balcony ? 100 : 76;
      const wy = y + (balcony ? 18 : 26);
      const wh = balcony ? 101 : 62;
      d.rect(wx - 3, wy - 3, ww + 6, wh + 6, '#e6e1d6', 0.6);
      d.glass(wx, wy, ww, wh, `hsl(${200 + rng() * 14},${18 + rng() * 14}%,${40 + rng() * 16}%)`);
      d.rect(wx + ww / 2 - 1, wy, 3, wh, '#e6e1d6', 0.6);
      if (rng() < 0.45) d.rect(wx + 2, wy + 2, ww / 2 - 4, wh * (0.4 + rng() * 0.5), `hsl(${30 + rng() * 30},25%,${70 + rng() * 15}%)`, 0.9);
      if (balcony) {
        d.rect(x + 6, y + CELL - 14, CELL - 12, 6, '#8d8980', 0.8);
        for (let b = 0; b < 15; b++) d.rect(x + 8 + b * 8, y + CELL - 44, 2, 30, '#2e2f31', 0.5, 0.6);
        d.rect(x + 6, y + CELL - 46, CELL - 12, 3, '#2e2f31', 0.5, 0.6);
        if (rng() < 0.5) {
          d.a.fillStyle = `hsl(${95 + rng() * 30},45%,30%)`;
          d.a.beginPath();
          d.a.arc(x + 20 + rng() * 80, y + CELL - 50, 9, 0, 7);
          d.a.fill();
        }
      }
    }
  }
  return d.textures();
}

function glassFacade(): FacadeTex {
  const d = new Dual(512, 512);
  const rng = mulberry32(23);
  for (let r = 0; r < 4; r++) {
    const y = 512 - (r + 1) * CELL;
    for (let p = 0; p < 8; p++) {
      const x = p * 64;
      const hue = 198 + rng() * 14;
      d.glass(x, y, 64, 96, `hsl(${hue},${30 + rng() * 14}%,${46 + rng() * 12}%)`, 0.05 + rng() * 0.06);
      d.glass(x, y + 96, 64, 32, `hsl(${hue},24%,${28 + rng() * 6}%)`, 0.3);
      if (rng() < 0.12) d.rect(x + 4, y + 6, 56, 40 + rng() * 40, '#cfd4d6', 0.7, 0.2);
      d.rect(x, y, 3, CELL, '#262b31', 0.45, 0.7);
    }
    d.rect(0, y + 94, 512, 3, '#262b31', 0.45, 0.7);
    d.rect(0, y + CELL - 2, 512, 2, '#262b31', 0.45, 0.7);
  }
  return d.textures();
}

function plasterFacade(): FacadeTex {
  const d = new Dual(512, 512);
  const rng = mulberry32(37);
  grain(d.a, [238, 234, 226], 14, 10, 5);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const x = c * CELL;
      const y = 512 - (r + 1) * CELL;
      d.rect(x, y + CELL - 5, CELL, 5, '#d9d4c8', 0.9);
      const door = rng() < 0.35;
      const wx = x + 32;
      const wy = y + (door ? 22 : 34);
      const wh = door ? 98 : 58;
      d.rect(wx - 4, wy - 4, 72, wh + 8, '#fbf9f4', 0.8);
      d.glass(wx, wy, 64, wh, `hsl(205,22%,${30 + rng() * 14}%)`, 0.12);
      d.rect(wx + 31, wy, 2, wh, '#fbf9f4', 0.8);
      const wood = `hsl(${22 + rng() * 10},40%,${26 + rng() * 10}%)`;
      if (rng() < 0.6) {
        d.rect(wx - 20, wy, 16, wh, wood, 0.8);
        d.rect(wx + 68, wy, 16, wh, wood, 0.8);
      }
      if (door) {
        d.rect(x + 14, y + CELL - 10, 100, 5, '#9b958b', 0.8);
        for (let b = 0; b < 12; b++) d.rect(x + 16 + b * 8.6, y + CELL - 40, 2, 30, '#1f2022', 0.5, 0.5);
        d.rect(x + 14, y + CELL - 42, 100, 3, '#1f2022', 0.5, 0.5);
        for (let k = 0; k < 3; k++) {
          d.a.fillStyle = `hsl(${90 + rng() * 40},50%,${26 + rng() * 10}%)`;
          d.a.beginPath();
          d.a.arc(x + 24 + rng() * 80, y + CELL - 44, 7 + rng() * 4, 0, 7);
          d.a.fill();
        }
      }
    }
  }
  return d.textures();
}

function officeFacade(): FacadeTex {
  const d = new Dual(512, 512);
  const rng = mulberry32(41);
  grain(d.a, [196, 193, 186], 16, 12, 9);
  for (let r = 0; r < 4; r++) {
    const y = 512 - (r + 1) * CELL;
    for (let p = 0; p < 16; p++) {
      d.glass(p * 32, y + 28, 32, 66, `hsl(${204 + rng() * 8},${22 + rng() * 10}%,${36 + rng() * 14}%)`, 0.1);
      d.rect(p * 32, y + 28, 2, 66, '#3a3d40', 0.5, 0.5);
      if (rng() < 0.2) d.rect(p * 32 + 3, y + 30, 28, 20 + rng() * 30, '#d8d6cf', 0.8);
    }
    d.rect(0, y + 26, 512, 2, '#8a877f', 0.8);
    d.rect(0, y + 94, 512, 3, '#8a877f', 0.8);
  }
  return d.textures();
}

const SHOP_NAMES = ['PANADERÍA', 'CAFÉ', 'FARMACIA', 'AREPAS', 'RESTAURANTE', 'MERCADO', 'FRUTAS', 'BAR', 'HELADOS', 'LIBRERÍA', 'FLORES', 'EMPANADAS', 'BARBERÍA', 'MODA', 'PELUQUERÍA', 'JUGOS'];

function shopFacade(): FacadeTex {
  const W = 2048;
  const H = 256;
  const BAY = 128;
  const d = new Dual(W, H);
  const rng = mulberry32(53);
  d.rect(0, 0, W, H, '#d8d2c6', 0.9);
  for (let b = 0; b < W / BAY; b++) {
    const x = b * BAY;
    const hue = Math.floor(rng() * 360);
    d.rect(x + 6, 12, BAY - 12, 44, `hsl(${hue},${40 + rng() * 30}%,${28 + rng() * 22}%)`, 0.6);
    d.a.fillStyle = '#fff';
    d.a.textAlign = 'center';
    d.a.textBaseline = 'middle';
    const name = SHOP_NAMES[b % SHOP_NAMES.length];
    d.a.font = `bold ${name.length > 8 ? 17 : 24}px system-ui, sans-serif`;
    d.a.fillText(name, x + BAY / 2, 35, BAY - 18);
    const door = rng() < 0.55;
    d.rect(x + 8, 66, BAY - 16, 172, '#2a2c2e', 0.5, 0.5);
    d.glass(x + 12, 70, BAY - 24, 164, `hsl(${195 + rng() * 20},18%,${22 + rng() * 14}%)`, 0.07);
    if (door) {
      d.rect(x + 60, 70, 4, 164, '#2a2c2e', 0.5, 0.5);
      d.rect(x + 12, 120, BAY - 24, 3, '#2a2c2e', 0.5, 0.5);
    } else {
      d.rect(x + 12, 200, BAY - 24, 34, '#6d665b', 0.9);
      for (let k = 0; k < 4; k++) d.rect(x + 20 + k * 24, 150 + rng() * 30, 16, 20 + rng() * 26, `hsl(${rng() * 360},45%,${45 + rng() * 25}%)`, 0.8);
    }
    if (rng() < 0.5) {
      const ah = (hue + 180) % 360;
      for (let k = 0; k < 8; k++) d.rect(x + 4 + k * 15, 60, 15, 30, k % 2 ? '#f4f1ea' : `hsl(${ah},55%,42%)`, 0.85);
    }
    d.rect(x, 0, 5, H, '#c4bdb0', 0.9);
  }
  d.rect(0, H - 16, W, 16, '#6b675f', 0.9);
  const t = d.textures();
  t.map.wrapT = t.rm.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

function asphalt() {
  const c = makeCanvas(512, 512);
  const ctx = c.getContext('2d')!;
  grain(ctx, [62, 63, 66], 30, 16, 3);
  const rng = mulberry32(7);
  wrapDraw(ctx, () => {
    const r = mulberry32(8);
    for (let i = 0; i < 9; i++) {
      ctx.fillStyle = `rgba(${r() < 0.5 ? '20,20,22' : '110,110,112'},${0.03 + r() * 0.05})`;
      ctx.fillRect(r() * 512, r() * 512, 40 + r() * 120, 30 + r() * 80);
    }
    ctx.strokeStyle = 'rgba(15,15,16,0.4)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 7; i++) {
      let x = r() * 512;
      let y = r() * 512;
      let a = r() * 6.28;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 22; k++) {
        a += (r() - 0.5) * 1.2;
        x += Math.cos(a) * 5;
        y += Math.sin(a) * 5;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  });
  void rng;
  return { map: toTex(c), normal: normalFrom(c, 1.5) };
}

function sidewalk() {
  const c = makeCanvas(256, 256);
  const ctx = c.getContext('2d')!;
  grain(ctx, [150, 146, 138], 22, 10, 13);
  const rng = mulberry32(14);
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      ctx.fillStyle = rng() < 0.5 ? `rgba(0,0,0,${rng() * 0.06})` : `rgba(255,255,255,${rng() * 0.06})`;
      ctx.fillRect(i * 32, j * 32, 32, 32);
    }
  }
  ctx.fillStyle = 'rgba(70,66,60,0.5)';
  for (let i = 0; i < 8; i++) {
    ctx.fillRect(i * 32, 0, 1.5, 256);
    ctx.fillRect(0, i * 32, 256, 1.5);
  }
  return { map: toTex(c), normal: normalFrom(c, 1.6) };
}

function grass() {
  const c = makeCanvas(512, 512);
  const ctx = c.getContext('2d')!;
  grain(ctx, [74, 108, 48], 34, 22, 17);
  const rng = mulberry32(18);
  wrapDraw(ctx, () => {
    const r = mulberry32(19);
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `hsla(${70 + r() * 50},${35 + r() * 25}%,${18 + r() * 26}%,0.35)`;
      ctx.fillRect(r() * 512, r() * 512, 2 + r() * 4, 2 + r() * 5);
    }
  });
  void rng;
  return toTex(c);
}

function leaves() {
  const c = makeCanvas(256, 256);
  const ctx = c.getContext('2d')!;
  grain(ctx, [44, 84, 34], 30, 26, 21);
  wrapDraw(ctx, () => {
    const r = mulberry32(22);
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = `hsla(${85 + r() * 40},${40 + r() * 25}%,${16 + r() * 34}%,0.5)`;
      ctx.beginPath();
      ctx.arc(r() * 256, r() * 256, 3 + r() * 8, 0, 7);
      ctx.fill();
    }
  });
  return toTex(c);
}

function roof() {
  const c = makeCanvas(128, 128);
  grain(c.getContext('2d')!, [120, 118, 114], 34, 14, 25);
  return toTex(c);
}

function hazard() {
  const c = makeCanvas(128, 128);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f2c417';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#1b1b1c';
  for (let i = -2; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 64, 0);
    ctx.lineTo(i * 64 + 32, 0);
    ctx.lineTo(i * 64 + 160, 128);
    ctx.lineTo(i * 64 + 128, 128);
    ctx.fill();
  }
  return toTex(c);
}

function glow() {
  const c = makeCanvas(4, 128);
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 128, 0, 0);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.08, 'rgba(255,255,255,0.5)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.22)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A flat sign with centred text, used for landmark names and the taxi roof light. */
export function textSign(text: string, bg: string, fg: string, w = 512, h = 128): THREE.CanvasTexture {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.round(h * 0.52)}px system-ui, sans-serif`;
  ctx.fillText(text, w / 2, h / 2 + 2, w - 24);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = ANISO;
  return t;
}

export interface Textures {
  brick: FacadeTex;
  glass: FacadeTex;
  plaster: FacadeTex;
  office: FacadeTex;
  shop: FacadeTex;
  asphalt: { map: THREE.Texture; normal: THREE.Texture };
  sidewalk: { map: THREE.Texture; normal: THREE.Texture };
  grass: THREE.Texture;
  leaves: THREE.Texture;
  roof: THREE.Texture;
  hazard: THREE.Texture;
  glow: THREE.Texture;
}

export function buildTextures(): Textures {
  return {
    brick: brickFacade(),
    glass: glassFacade(),
    plaster: plasterFacade(),
    office: officeFacade(),
    shop: shopFacade(),
    asphalt: asphalt(),
    sidewalk: sidewalk(),
    grass: grass(),
    leaves: leaves(),
    roof: roof(),
    hazard: hazard(),
    glow: glow(),
  };
}
