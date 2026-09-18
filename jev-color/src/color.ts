/** 色の計算。255個の確率を「1つの色」や「1つの数」へ畳むための道具だけを置く。
 *
 * このサンプルの主張は「argmax だけ見るなら 255択である必要はない」という点にある。
 * そこで分布そのものを使う操作を2つ用意する。
 *
 * - `expectedColor`: 255色を確率で加重混合した色。分布が割れるほど濁る。
 * - `entropyBits`: 分布の散らばり。255択の上限 log2(255) ≒ 7.99 bit から、
 *   Jev が何ビット絞り込めたかを出す。
 */

export type Rgb = { r: number; g: number; b: number };
export type Hsl = { h: number; s: number; l: number };

export function parseHex(hex: string): Rgb {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`invalid hex: ${hex}`);
  const n = Number.parseInt(m[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function toHex({ r, g, b }: Rgb): string {
  const part = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase();
}

/** sRGB のガンマを外す。混色をここで行わないと、明るい色が不当に沈む。 */
function toLinear(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function fromLinear(v: number): number {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return c * 255;
}

/** 確率で重み付けした混色。重みの合計が0なら黒を返す。 */
export function mix(parts: readonly { hex: string; weight: number }[]): string {
  let total = 0;
  const sum = { r: 0, g: 0, b: 0 };
  for (const { hex, weight } of parts) {
    if (!(weight > 0)) continue;
    const { r, g, b } = parseHex(hex);
    sum.r += toLinear(r) * weight;
    sum.g += toLinear(g) * weight;
    sum.b += toLinear(b) * weight;
    total += weight;
  }
  if (total === 0) return '#000000';
  return toHex({ r: fromLinear(sum.r / total), g: fromLinear(sum.g / total), b: fromLinear(sum.b / total) });
}

export function toHsl(hex: string): Hsl {
  const { r, g, b } = parseHex(hex);
  const [rn, gn, bn] = [r / 255, g / 255, b / 255] as const;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h *= 60;
  return { h: h < 0 ? h + 360 : h, s, l };
}

/** 白文字と黒文字のどちらが載るか。見出しの可読性のためだけに使う。 */
export function readableInk(hex: string): '#000000' | '#FFFFFF' {
  const { r, g, b } = parseHex(hex);
  const luminance = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return luminance > 0.36 ? '#000000' : '#FFFFFF';
}

/** 分布のシャノンエントロピー（bit）。確率0の項は寄与0として扱う。 */
export function entropyBits(probabilities: readonly number[]): number {
  let h = 0;
  for (const p of probabilities) {
    if (p > 0) h -= p * Math.log2(p);
  }
  return h;
}

/** 候補数 n の一様分布からの情報利得（bit）。255択なら最大 log2(255) ≒ 7.994。 */
export function narrowedBits(probabilities: readonly number[]): number {
  const max = Math.log2(probabilities.length);
  return Math.max(0, max - entropyBits(probabilities));
}

/** 上位から累積確率が threshold を超えるまでに何色必要か（分布の実効的な広さ）。 */
export function coverageCount(sorted: readonly number[], threshold = 0.9): number {
  let acc = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    acc += sorted[i]!;
    if (acc >= threshold) return i + 1;
  }
  return sorted.length;
}
