import { Container, Graphics, Texture } from 'pixi.js';

type AppLike = { renderer: { generateTexture: (g: Container) => Texture } };

interface AvatarDesign {
  bg: number;
  drawIcon: (g: Graphics, cx: number, cy: number, r: number) => void;
}

const DESIGNS: AvatarDesign[] = [
  // 0: Star (teal)
  { bg: 0x0d9488, drawIcon: (g, cx, cy, r) => { drawStar(g, cx, cy, r * 0.55, 5, 0xffffff); } },
  // 1: Crown (coral)
  { bg: 0xf97316, drawIcon: (g, cx, cy, r) => { drawCrown(g, cx, cy, r * 0.5, 0xffffff); } },
  // 2: Lightning (purple)
  { bg: 0x8b5cf6, drawIcon: (g, cx, cy, r) => { drawLightning(g, cx, cy, r * 0.55, 0xffffff); } },
  // 3: Diamond (amber)
  { bg: 0xd97706, drawIcon: (g, cx, cy, r) => { drawDiamond(g, cx, cy, r * 0.5, 0xffffff); } },
  // 4: Heart (rose)
  { bg: 0xe11d48, drawIcon: (g, cx, cy, r) => { drawHeart(g, cx, cy, r * 0.45, 0xffffff); } },
  // 5: Shield (blue)
  { bg: 0x2563eb, drawIcon: (g, cx, cy, r) => { drawShield(g, cx, cy, r * 0.5, 0xffffff); } },
  // 6: Flame (red-orange)
  { bg: 0xdc2626, drawIcon: (g, cx, cy, r) => { drawFlame(g, cx, cy, r * 0.5, 0xffffff); } },
  // 7: Moon (indigo)
  { bg: 0x4338ca, drawIcon: (g, cx, cy, r) => { drawMoon(g, cx, cy, r * 0.5, 0xffffff); } },
  // 8: Sun (yellow)
  { bg: 0xca8a04, drawIcon: (g, cx, cy, r) => { drawSun(g, cx, cy, r * 0.45, 0xffffff); } },
  // 9: Gear (slate)
  { bg: 0x475569, drawIcon: (g, cx, cy, r) => { drawGear(g, cx, cy, r * 0.5, 0xffffff); } },
  // 10: Music note (pink)
  { bg: 0xdb2777, drawIcon: (g, cx, cy, r) => { drawMusicNote(g, cx, cy, r * 0.5, 0xffffff); } },
  // 11: Leaf (green)
  { bg: 0x16a34a, drawIcon: (g, cx, cy, r) => { drawLeaf(g, cx, cy, r * 0.5, 0xffffff); } },
  // 12: Anchor (navy)
  { bg: 0x1e3a5f, drawIcon: (g, cx, cy, r) => { drawAnchor(g, cx, cy, r * 0.5, 0xffffff); } },
  // 13: Skull (dark gray)
  { bg: 0x374151, drawIcon: (g, cx, cy, r) => { drawSkull(g, cx, cy, r * 0.45, 0xffffff); } },
  // 14: Cat (warm purple)
  { bg: 0x7c3aed, drawIcon: (g, cx, cy, r) => { drawCat(g, cx, cy, r * 0.5, 0xffffff); } },
  // 15: Robot (cyan)
  { bg: 0x0891b2, drawIcon: (g, cx, cy, r) => { drawRobot(g, cx, cy, r * 0.45, 0xffffff); } },
];

// --- Icon drawing functions ---

function drawStar(g: Graphics, cx: number, cy: number, r: number, points: number, color: number) {
  const inner = r * 0.45;
  g.moveTo(cx, cy - r);
  for (let i = 0; i < points; i++) {
    const outerAngle = (Math.PI * 2 * i) / points - Math.PI / 2;
    const innerAngle = outerAngle + Math.PI / points;
    g.lineTo(cx + Math.cos(outerAngle) * r, cy + Math.sin(outerAngle) * r);
    g.lineTo(cx + Math.cos(innerAngle) * inner, cy + Math.sin(innerAngle) * inner);
  }
  g.closePath();
  g.fill(color);
}

function drawCrown(g: Graphics, cx: number, cy: number, r: number, color: number) {
  const w = r * 1.6, h = r * 1.2;
  const left = cx - w / 2, top = cy - h / 2 + 1;
  g.moveTo(left, top + h);
  g.lineTo(left, top + h * 0.35);
  g.lineTo(left + w * 0.25, top + h * 0.55);
  g.lineTo(cx, top);
  g.lineTo(left + w * 0.75, top + h * 0.55);
  g.lineTo(left + w, top + h * 0.35);
  g.lineTo(left + w, top + h);
  g.closePath();
  g.fill(color);
}

function drawLightning(g: Graphics, cx: number, cy: number, r: number, color: number) {
  g.moveTo(cx + r * 0.1, cy - r);
  g.lineTo(cx - r * 0.5, cy + r * 0.1);
  g.lineTo(cx - r * 0.05, cy + r * 0.1);
  g.lineTo(cx - r * 0.2, cy + r);
  g.lineTo(cx + r * 0.5, cy - r * 0.1);
  g.lineTo(cx + r * 0.05, cy - r * 0.1);
  g.closePath();
  g.fill(color);
}

function drawDiamond(g: Graphics, cx: number, cy: number, r: number, color: number) {
  g.moveTo(cx, cy - r);
  g.lineTo(cx + r * 0.7, cy);
  g.lineTo(cx, cy + r);
  g.lineTo(cx - r * 0.7, cy);
  g.closePath();
  g.fill(color);
}

function drawHeart(g: Graphics, cx: number, cy: number, r: number, color: number) {
  const s = r * 0.9;
  g.moveTo(cx, cy + s);
  g.bezierCurveTo(cx - s * 2, cy - s * 0.5, cx - s * 0.6, cy - s * 1.5, cx, cy - s * 0.5);
  g.bezierCurveTo(cx + s * 0.6, cy - s * 1.5, cx + s * 2, cy - s * 0.5, cx, cy + s);
  g.fill(color);
}

function drawShield(g: Graphics, cx: number, cy: number, r: number, color: number) {
  g.moveTo(cx, cy - r);
  g.lineTo(cx + r * 0.8, cy - r * 0.5);
  g.lineTo(cx + r * 0.7, cy + r * 0.3);
  g.bezierCurveTo(cx + r * 0.5, cy + r * 0.8, cx, cy + r, cx, cy + r);
  g.bezierCurveTo(cx, cy + r, cx - r * 0.5, cy + r * 0.8, cx - r * 0.7, cy + r * 0.3);
  g.lineTo(cx - r * 0.8, cy - r * 0.5);
  g.closePath();
  g.fill(color);
}

function drawFlame(g: Graphics, cx: number, cy: number, r: number, color: number) {
  g.moveTo(cx, cy - r * 1.1);
  g.bezierCurveTo(cx + r * 0.2, cy - r * 0.5, cx + r * 0.8, cy - r * 0.3, cx + r * 0.6, cy + r * 0.3);
  g.bezierCurveTo(cx + r * 0.5, cy + r * 0.8, cx + r * 0.2, cy + r, cx, cy + r);
  g.bezierCurveTo(cx - r * 0.2, cy + r, cx - r * 0.5, cy + r * 0.8, cx - r * 0.6, cy + r * 0.3);
  g.bezierCurveTo(cx - r * 0.8, cy - r * 0.3, cx - r * 0.2, cy - r * 0.5, cx, cy - r * 1.1);
  g.fill(color);
}

function drawMoon(g: Graphics, cx: number, cy: number, r: number, color: number) {
  // Full circle then cut out a smaller offset circle
  g.circle(cx - r * 0.15, cy, r);
  g.fill(color);
  // "Cut" with bg color - approximate by drawing inner circle
  g.circle(cx + r * 0.35, cy - r * 0.1, r * 0.75);
  g.fill(DESIGNS[7].bg); // indigo bg
}

function drawSun(g: Graphics, cx: number, cy: number, r: number, color: number) {
  // Center circle
  g.circle(cx, cy, r * 0.5);
  g.fill(color);
  // Rays
  for (let i = 0; i < 8; i++) {
    const angle = (Math.PI * 2 * i) / 8;
    const x1 = cx + Math.cos(angle) * r * 0.6;
    const y1 = cy + Math.sin(angle) * r * 0.6;
    const x2 = cx + Math.cos(angle) * r;
    const y2 = cy + Math.sin(angle) * r;
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke({ color, width: 2 });
  }
}

function drawGear(g: Graphics, cx: number, cy: number, r: number, color: number) {
  // Outer ring with teeth
  const teeth = 8;
  const outerR = r;
  const innerR = r * 0.7;
  const toothH = r * 0.25;
  g.moveTo(cx + outerR, cy);
  for (let i = 0; i < teeth; i++) {
    const a1 = (Math.PI * 2 * i) / teeth;
    const a2 = a1 + Math.PI / teeth * 0.4;
    const a3 = a1 + Math.PI / teeth * 0.6;
    const a4 = a1 + Math.PI / teeth;
    // Tooth outer edge
    g.lineTo(cx + Math.cos(a1) * (outerR + toothH), cy + Math.sin(a1) * (outerR + toothH));
    g.lineTo(cx + Math.cos(a2) * (outerR + toothH), cy + Math.sin(a2) * (outerR + toothH));
    // Back to body
    g.lineTo(cx + Math.cos(a3) * outerR, cy + Math.sin(a3) * outerR);
    g.lineTo(cx + Math.cos(a4) * outerR, cy + Math.sin(a4) * outerR);
  }
  g.closePath();
  g.fill(color);
  // Center hole
  g.circle(cx, cy, innerR * 0.4);
  g.fill(DESIGNS[9].bg);
}

function drawMusicNote(g: Graphics, cx: number, cy: number, r: number, color: number) {
  // Note head (oval)
  g.ellipse(cx - r * 0.2, cy + r * 0.5, r * 0.35, r * 0.25);
  g.fill(color);
  // Stem
  g.rect(cx + r * 0.1, cy - r * 0.7, r * 0.1, r * 1.25);
  g.fill(color);
  // Flag
  g.moveTo(cx + r * 0.2, cy - r * 0.7);
  g.bezierCurveTo(cx + r * 0.6, cy - r * 0.5, cx + r * 0.6, cy - r * 0.1, cx + r * 0.2, cy - r * 0.2);
  g.fill(color);
}

function drawLeaf(g: Graphics, cx: number, cy: number, r: number, color: number) {
  g.moveTo(cx, cy - r);
  g.bezierCurveTo(cx + r * 1.2, cy - r * 0.5, cx + r * 0.8, cy + r * 0.8, cx, cy + r);
  g.bezierCurveTo(cx - r * 0.8, cy + r * 0.8, cx - r * 1.2, cy - r * 0.5, cx, cy - r);
  g.fill(color);
  // Center vein
  g.moveTo(cx, cy - r * 0.7);
  g.lineTo(cx, cy + r * 0.7);
  g.stroke({ color: DESIGNS[11].bg, width: 1.5 });
}

function drawAnchor(g: Graphics, cx: number, cy: number, r: number, color: number) {
  // Ring at top
  g.circle(cx, cy - r * 0.6, r * 0.2);
  g.stroke({ color, width: 2 });
  // Vertical bar
  g.rect(cx - r * 0.06, cy - r * 0.4, r * 0.12, r * 1.2);
  g.fill(color);
  // Horizontal bar at top
  g.rect(cx - r * 0.35, cy - r * 0.2, r * 0.7, r * 0.1);
  g.fill(color);
  // Arc at bottom
  g.moveTo(cx - r * 0.6, cy + r * 0.5);
  g.bezierCurveTo(cx - r * 0.6, cy + r, cx + r * 0.6, cy + r, cx + r * 0.6, cy + r * 0.5);
  g.stroke({ color, width: 2 });
}

function drawSkull(g: Graphics, cx: number, cy: number, r: number, color: number) {
  // Head
  g.ellipse(cx, cy - r * 0.15, r * 0.75, r * 0.85);
  g.fill(color);
  // Jaw
  g.rect(cx - r * 0.45, cy + r * 0.4, r * 0.9, r * 0.35);
  g.fill(color);
  // Eye sockets (bg color)
  const bgColor = DESIGNS[13].bg;
  g.ellipse(cx - r * 0.28, cy - r * 0.2, r * 0.18, r * 0.22);
  g.fill(bgColor);
  g.ellipse(cx + r * 0.28, cy - r * 0.2, r * 0.18, r * 0.22);
  g.fill(bgColor);
  // Nose
  g.moveTo(cx, cy + r * 0.05);
  g.lineTo(cx - r * 0.08, cy + r * 0.2);
  g.lineTo(cx + r * 0.08, cy + r * 0.2);
  g.closePath();
  g.fill(bgColor);
}

function drawCat(g: Graphics, cx: number, cy: number, r: number, color: number) {
  // Head circle
  g.circle(cx, cy + r * 0.1, r * 0.7);
  g.fill(color);
  // Left ear
  g.moveTo(cx - r * 0.65, cy - r * 0.3);
  g.lineTo(cx - r * 0.35, cy - r * 0.9);
  g.lineTo(cx - r * 0.1, cy - r * 0.35);
  g.closePath();
  g.fill(color);
  // Right ear
  g.moveTo(cx + r * 0.65, cy - r * 0.3);
  g.lineTo(cx + r * 0.35, cy - r * 0.9);
  g.lineTo(cx + r * 0.1, cy - r * 0.35);
  g.closePath();
  g.fill(color);
  // Eyes (bg color)
  const bgColor = DESIGNS[14].bg;
  g.ellipse(cx - r * 0.25, cy + r * 0.0, r * 0.1, r * 0.13);
  g.fill(bgColor);
  g.ellipse(cx + r * 0.25, cy + r * 0.0, r * 0.1, r * 0.13);
  g.fill(bgColor);
  // Nose
  g.moveTo(cx, cy + r * 0.15);
  g.lineTo(cx - r * 0.06, cy + r * 0.22);
  g.lineTo(cx + r * 0.06, cy + r * 0.22);
  g.closePath();
  g.fill(bgColor);
}

function drawRobot(g: Graphics, cx: number, cy: number, r: number, color: number) {
  // Head
  g.roundRect(cx - r * 0.6, cy - r * 0.6, r * 1.2, r * 1.0, r * 0.15);
  g.fill(color);
  // Antenna
  g.rect(cx - r * 0.04, cy - r * 0.9, r * 0.08, r * 0.35);
  g.fill(color);
  g.circle(cx, cy - r * 0.9, r * 0.1);
  g.fill(color);
  // Eyes (bg color)
  const bgColor = DESIGNS[15].bg;
  g.roundRect(cx - r * 0.4, cy - r * 0.35, r * 0.3, r * 0.25, 2);
  g.fill(bgColor);
  g.roundRect(cx + r * 0.1, cy - r * 0.35, r * 0.3, r * 0.25, 2);
  g.fill(bgColor);
  // Mouth
  g.rect(cx - r * 0.3, cy + r * 0.1, r * 0.6, r * 0.08);
  g.fill(bgColor);
}

// --- Texture generation ---

const avatarTextureCache = new Map<string, Texture>();

function darkenColor(color: number, factor: number): number {
  const r = Math.floor(((color >> 16) & 0xff) * factor);
  const g = Math.floor(((color >> 8) & 0xff) * factor);
  const b = Math.floor((color & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}

function lightenColor(color: number, factor: number): number {
  const r = Math.min(255, Math.floor(((color >> 16) & 0xff) * factor));
  const g = Math.min(255, Math.floor(((color >> 8) & 0xff) * factor));
  const b = Math.min(255, Math.floor((color & 0xff) * factor));
  return (r << 16) | (g << 8) | b;
}

export function generateAvatarTexture(avatarId: number, size: number, app: AppLike): Texture {
  const key = `${avatarId}_${size}`;
  const cached = avatarTextureCache.get(key);
  if (cached) return cached;

  const design = DESIGNS[avatarId % DESIGNS.length];
  const container = new Container();
  const half = size / 2;
  const borderWidth = Math.max(2, size * 0.06);

  // Outer ring (lighter shade of bg color)
  const ring = new Graphics();
  ring.circle(half, half, half);
  ring.fill(lightenColor(design.bg, 1.4));
  container.addChild(ring);

  // Inner circle (slightly darker bg, creates depth)
  const innerR = half - borderWidth;
  const bg = new Graphics();
  bg.circle(half, half, innerR);
  bg.fill(darkenColor(design.bg, 0.75));
  container.addChild(bg);

  // Lighter center highlight for 3D effect
  const highlight = new Graphics();
  highlight.circle(half - innerR * 0.15, half - innerR * 0.15, innerR * 0.7);
  highlight.fill({ color: design.bg, alpha: 0.5 });
  container.addChild(highlight);

  // Icon (scaled to inner area)
  const icon = new Graphics();
  design.drawIcon(icon, half, half, innerR * 0.85);
  container.addChild(icon);

  const texture = app.renderer.generateTexture(container);
  container.destroy();
  avatarTextureCache.set(key, texture);
  return texture;
}

export function clearAvatarTextureCache(): void {
  avatarTextureCache.clear();
}

export const AVATAR_COUNT = DESIGNS.length;