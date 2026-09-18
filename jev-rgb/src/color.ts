/** 分布を「1つの色」や「1つの数」へ畳むための計算だけを置く。Gateway 依存は無い。
 *
 * このサンプルの主題は、Jev が返す成分ごとの分布（16段階 × 3成分）を
 * 0〜255 の3つの数へどう畳むか、そして畳む前の形をどう見せるかである。
 */

import { LEVELS, STEP, levelValue } from './channels';

export type Rgb = { r: number; g: number; b: number };

export function clamp255(v: number): number {
  return Math.min(255, Math.max(0, v));
}

export function toHex({ r, g, b }: Rgb): string {
  const part = (v: number) => Math.round(clamp255(v)).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase();
}

/** sRGB のガンマを外す。光として平均を取るときは必ずこの空間で行う。 */
export function toLinear(v: number): number {
  const c = clamp255(v) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function fromLinear(v: number): number {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return clamp255(c * 255);
}

/**
 * 16段階の確率分布 → 0〜255 の期待値（8bit の目盛りのまま平均する）。
 *
 * Jev の `score` は同じ平均を返すので、本来この関数は要らない。
 * それでも自前で計算するのは、`score` と `probabilities` が食い違っていないかを
 * 突き合わせる（`evaluate.ts` の検証）ためである。
 */
export function expectedValue(distribution: readonly number[]): number {
  let total = 0;
  let sum = 0;
  for (let i = 0; i < distribution.length; i += 1) {
    const p = distribution[i]!;
    if (!(p > 0)) continue;
    sum += levelValue(i) * p;
    total += p;
  }
  return total === 0 ? 0 : sum / total;
}

/**
 * 同じ分布を、光の強さ（線形sRGB）で平均してから8bitへ戻した値。
 *
 * 「0と255が半々」を8bitの目盛りで平均すると127.5（中間のグレー）だが、
 * 光として平均すると187.5になる。どちらが正しいという話ではなく、
 * 8bitの目盛りは知覚に合わせて曲げてあるので、平均の意味が変わるというだけである。
 * 画面ではこの2つを並べて出す。
 */
export function expectedValueLinear(distribution: readonly number[]): number {
  let total = 0;
  let sum = 0;
  for (let i = 0; i < distribution.length; i += 1) {
    const p = distribution[i]!;
    if (!(p > 0)) continue;
    sum += toLinear(levelValue(i)) * p;
    total += p;
  }
  return total === 0 ? 0 : fromLinear(sum / total);
}

/** 分布のシャノンエントロピー（bit）。確率0の項は寄与0として扱う。 */
export function entropyBits(distribution: readonly number[]): number {
  let h = 0;
  for (const p of distribution) {
    if (p > 0) h -= p * Math.log2(p);
  }
  return h;
}

/** 一様分布からの情報利得（bit）。16段階なら上限 log2(16) = 4。 */
export function narrowedBits(distribution: readonly number[]): number {
  return Math.max(0, Math.log2(distribution.length) - entropyBits(distribution));
}

/** 上位から累積確率が threshold を超えるまでに必要な段階数。 */
export function coverageCount(distribution: readonly number[], threshold = 0.9): number {
  const sorted = [...distribution].sort((a, b) => b - a);
  let acc = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    acc += sorted[i]!;
    if (acc >= threshold) return i + 1;
  }
  return sorted.length;
}

/** 相対輝度（0〜1）。自己整合の検算と、文字色の判定に使う。 */
export function luminance({ r, g, b }: Rgb): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function readableInk(rgb: Rgb): '#000000' | '#FFFFFF' {
  return luminance(rgb) > 0.36 ? '#000000' : '#FFFFFF';
}

/** 彩度（HSL の S、0〜1）。無彩色かどうかの検算に使う。 */
export function saturation({ r, g, b }: Rgb): number {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  if (max === min) return 0;
  return (max - min) / (1 - Math.abs(2 * l - 1));
}

export type JointColor = { rgb: Rgb; hex: string; probability: number };

/**
 * 3本の周辺分布から、16^3 = 4096色の同時分布を積で組み立てる。
 *
 * 注意: これは Jev が返した同時分布ではない。Jev は成分ごとに独立した設問へ答えており、
 * 成分間の相関は応答に含まれていない。ここで作っているのは「相関を捨てたらこうなる」であって、
 * 本物の同時分布ではない。画面でもそう書く。
 */
export function jointDistribution(channels: readonly (readonly number[])[]): number[] {
  const [pr, pg, pb] = channels;
  if (!pr || !pg || !pb) throw new Error('need exactly three channel distributions');
  const out = new Array<number>(LEVELS ** 3);
  for (let r = 0; r < LEVELS; r += 1) {
    for (let g = 0; g < LEVELS; g += 1) {
      for (let b = 0; b < LEVELS; b += 1) {
        out[(r * LEVELS + g) * LEVELS + b] = pr[r]! * pg[g]! * pb[b]!;
      }
    }
  }
  return out;
}

/** 同時分布の上位 count 色。 */
export function topColors(joint: readonly number[], count: number): JointColor[] {
  return joint
    .map((probability, index) => {
      const b = index % LEVELS;
      const g = Math.floor(index / LEVELS) % LEVELS;
      const r = Math.floor(index / (LEVELS * LEVELS));
      const rgb = { r: r * STEP, g: g * STEP, b: b * STEP };
      return { rgb, hex: toHex(rgb), probability };
    })
    .sort((a, b) => b.probability - a.probability)
    .slice(0, count);
}
