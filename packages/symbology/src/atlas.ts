/**
 * Symbol atlas for deck.gl IconLayer. Symbols are rendered once by milsymbol (MIL-STD-2525E
 * artwork) and shelf-packed into one canvas; changing values (callsign, speed, age) are drawn
 * by separate layers so the atlas stays small.
 *
 * Colours here are the standard's identity fills (milsymbol colour modes). They are
 * documented artwork, not UI tokens (FDS G1 note: literals allowed for artwork).
 */
import ms from 'milsymbol';

export interface IconMapping {
  x: number;
  y: number;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  mask: false;
}

export interface AtlasOptions {
  /** milsymbol size (px at 1×). */
  size?: number;
  /** Device scale for crispness. */
  scale?: number;
  colorMode?: 'Light' | 'Medium' | 'Dark';
  maxWidth?: number;
}

export interface Atlas {
  canvas: HTMLCanvasElement;
  mapping: Record<string, IconMapping>;
  /** Bumps whenever the canvas is rebuilt. */
  version: number;
}

interface Rendered {
  key: string;
  canvas: HTMLCanvasElement;
  anchor: { x: number; y: number };
}

const PAD = 2;

/** Atlas that grows by rebuilding (debounced) when new SIDCs appear. */
export class SymbolAtlas {
  private rendered = new Map<string, Rendered>();
  private current: Atlas | null = null;
  private dirty = false;
  private version = 0;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly opts: AtlasOptions = {}) {}

  /** Request symbols; returns true if all are already in the current atlas. */
  ensure(sidcs: Iterable<string>): boolean {
    let missing = false;
    for (const s of sidcs) {
      if (!this.rendered.has(s)) {
        this.rendered.set(s, this.render(s));
        missing = true;
      }
    }
    if (missing) {
      this.dirty = true;
      if (!this.current) this.rebuild();
      else this.schedule();
    }
    return !missing || this.current?.mapping !== undefined;
  }

  get atlas(): Atlas | null {
    return this.current;
  }

  onChange(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.dirty) this.rebuild();
    }, 120);
  }

  private render(sidc: string): Rendered {
    const scale = this.opts.scale ?? 2;
    const sym = new ms.Symbol(sidc, {
      size: this.opts.size ?? 22,
      colorMode: this.opts.colorMode ?? 'Medium',
      outlineWidth: 2,
      outlineColor: 'rgba(8,12,16,0.85)',
    });
    const canvas = sym.asCanvas(scale);
    const a = sym.getAnchor();
    return { key: sidc, canvas, anchor: { x: a.x * scale, y: a.y * scale } };
  }

  private rebuild(): void {
    const maxW = this.opts.maxWidth ?? 2048;
    const items = [...this.rendered.values()].sort((a, b) => b.canvas.height - a.canvas.height);
    // Shelf packing.
    let x = PAD;
    let y = PAD;
    let shelfH = 0;
    const placed: Array<{ r: Rendered; x: number; y: number }> = [];
    for (const r of items) {
      const w = r.canvas.width;
      const h = r.canvas.height;
      if (x + w + PAD > maxW) {
        x = PAD;
        y += shelfH + PAD;
        shelfH = 0;
      }
      placed.push({ r, x, y });
      x += w + PAD;
      shelfH = Math.max(shelfH, h);
    }
    const height = nextPow2(y + shelfH + PAD);
    const canvas = document.createElement('canvas');
    canvas.width = maxW;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const mapping: Record<string, IconMapping> = {};
    for (const { r, x: px, y: py } of placed) {
      ctx.drawImage(r.canvas, px, py);
      mapping[r.key] = {
        x: px,
        y: py,
        width: r.canvas.width,
        height: r.canvas.height,
        anchorX: r.anchor.x,
        anchorY: r.anchor.y,
        mask: false,
      };
    }
    this.version += 1;
    this.current = { canvas, mapping, version: this.version };
    this.dirty = false;
    for (const l of this.listeners) l();
  }
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** SVG markup for a symbol (UI glyphs: inspector header, legends). Cached. */
const svgCache = new Map<string, string>();
export function symbolSvg(sidc: string, size = 18): string {
  const key = `${sidc}|${size}`;
  let s = svgCache.get(key);
  if (!s) {
    s = new ms.Symbol(sidc, { size, colorMode: 'Medium', outlineWidth: 1, outlineColor: 'rgba(8,12,16,0.85)' }).asSVG();
    svgCache.set(key, s);
  }
  return s;
}

export function isValidSidc(sidc: string): boolean {
  try {
    return new ms.Symbol(sidc, {}).isValid() === true;
  } catch {
    return false;
  }
}
