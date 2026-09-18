/** Gateway へ接続せずに画面だけを見るためのスタブ。
 *
 * Jev は有料クレジットのある Gateway アカウントでしか動かないため、
 * UI の確認や画面の手直しのたびに課金したくない。ここでは固定の分布を返し、
 * `createHandler` から先を本番と同じ経路で動かす。
 * 返す分布は作り物であり、Jev の実際の出力ではない。
 */

import { createHandler } from '../src/server';
import { summarize, type RawResult } from '../src/evaluate';
import { LEVELS } from '../src/channels';

/** 中心 center のまわりに width の広がりを持つ分布。合計は1に揃える。 */
function bell(center: number, width: number): { probabilities: Record<string, number>; score: number } {
  const raw = Array.from({ length: LEVELS }, (_, i) => Math.exp(-((i - center) ** 2) / (2 * width ** 2)));
  const total = raw.reduce((a, b) => a + b, 0);
  const probabilities: Record<string, number> = {};
  let score = 0;
  raw.forEach((v, i) => {
    probabilities[String(i)] = v / total;
    score += (v / total) * i;
  });
  return { probabilities, score };
}

// 「夜の海」に対してありそうな形: 赤はほぼ無く、緑は低め、青は高いが上端まで振り切らない。
const raw: RawResult = {
  answers: {
    r: { type: 'score', ...bell(1.1, 1.0) },
    g: { type: 'score', ...bell(3.4, 1.4) },
    b: { type: 'score', ...bell(9.2, 2.1) },
    brightness: { type: 'score', score: 0.8 },
    achromatic: { type: 'boolean', probability: 0.06 },
  },
  usage: { inputTokens: 786, outputTokens: 204, totalTokens: 990 },
  providerMetadata: { gateway: { cost: '0.000041' } },
};

const port = Number(process.env.JEV_RGB_PORT ?? 8788);
Bun.serve({ port, fetch: createHandler(async text => summarize(text, raw, 1180)) });
console.log(`jev-rgb (stub, Gatewayへ接続しない): http://127.0.0.1:${port}`);
