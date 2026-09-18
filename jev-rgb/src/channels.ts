/** RGBの3成分を「Jevに聞ける形」へ落とすための定義。
 *
 * 8bitのRGBは各成分が 0〜255 の256段階である。一方 Jev の choice は候補を255個までしか
 * 取れないので、256段階を choice で並べることはできない（1段階足りない）。
 * そこで成分には score を使う。score は
 *
 *   - 段階数を自由に決められる（2段階以上の順序付きレベル）
 *   - `probabilities` に各レベルの確率が入り、`score` はその加重平均である
 *
 * ため、順序のある「成分の強さ」にそのまま対応する。
 *
 * レベルは16段階にし、レベル i の値を `i * 17` とした。17を掛けるのは 15 * 17 = 255 ちょうどで、
 * 0x00, 0x11, 0x22, ... 0xFF と16進2桁が同じ数字の並びになるからである。
 * これで「レベルの加重平均 × 17」がそのまま 0〜255 の期待値になる。
 */

/** レベル数。log2(16) = 4 bit が1成分あたりの上限。 */
export const LEVELS = 16;

/** レベルの刻み。15 * 17 = 255。 */
export const STEP = 17;

/** レベル番号 → 0〜255 の値。 */
export function levelValue(level: number): number {
  return level * STEP;
}

/** レベルの加重平均（score）→ 0〜255 の値。端数はそのまま残す。 */
export function scoreToValue(score: number): number {
  return score * STEP;
}

export const CHANNEL_KEYS = ['r', 'g', 'b'] as const;
export type ChannelKey = (typeof CHANNEL_KEYS)[number];

export type Channel = {
  key: ChannelKey;
  /** 画面と設問で使う名前。 */
  label: string;
  /** 設問で「この成分が強い」と言えるようにするための言い換え。 */
  sense: string;
  /** その成分だけを最大にした色。ヒストグラムの塗りに使う。 */
  hex: string;
};

export const CHANNELS: readonly Channel[] = [
  { key: 'r', label: '赤 (R)', sense: '赤・朱・炎・熱・血・夕焼けの側', hex: '#FF0000' },
  { key: 'g', label: '緑 (G)', sense: '緑・草木・若葉・自然光・明るさの芯', hex: '#00FF00' },
  { key: 'b', label: '青 (B)', sense: '青・水・空・夜・冷たさの側', hex: '#0000FF' },
];

/** 16段階それぞれの説明。値（0〜255）と16進をレベル名に明示する。 */
export const LEVEL_HINTS: readonly string[] = [
  '0 (0x00): この成分は完全に無い',
  '17 (0x11): ほぼ無い',
  '34 (0x22): わずかに混ざる程度',
  '51 (0x33): 暗く沈んだ量',
  '68 (0x44): 弱い',
  '85 (0x55): やや弱い',
  '102 (0x66): 中間より下',
  '119 (0x77): 中間のすぐ下',
  '136 (0x88): 中間のすぐ上',
  '153 (0x99): 中間より上',
  '170 (0xAA): やや強い',
  '187 (0xBB): 強い',
  '204 (0xCC): かなり強い',
  '221 (0xDD): 非常に強い',
  '238 (0xEE): ほぼ最大',
  '255 (0xFF): 最大。この成分が振り切れている',
];

if (LEVEL_HINTS.length !== LEVELS) {
  throw new Error('LEVEL_HINTS must hold exactly 16 levels');
}
