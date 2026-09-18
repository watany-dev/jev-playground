/** Gateway へ接続せずに画面だけを見るためのスタブ。
 *
 * Jev は有料クレジットのある Gateway アカウントでしか動かないため、
 * UI の確認や画面の手直しのたびに課金したくない。ここでは固定の分布を返し、
 * `createHandler` から先を本番と同じ経路で動かす。
 * 返す分布は作り物であり、Jev の実際の出力ではない。
 */

import { createHandler } from '../src/server';
import { summarize, type RawResult } from '../src/evaluate';
import { COLORS } from '../src/palette';

// 「夜の海」に対して実際にありそうな「割れた」分布を作る（夜の海 → 紺〜藍〜青に散る）。
const weights: Record<string, number> = {
  '紺青': 0.21, '藍色': 0.17, '濃紺': 0.12, 'ミッドナイトブルー': 0.09, '瑠璃色': 0.08,
  '勝色': 0.06, '群青色': 0.05, '鉄紺': 0.04, '青褐': 0.035, '藍鉄': 0.03,
  'インディゴ': 0.025, '紺色': 0.02, '漆黒': 0.02, '墨色': 0.015, '青': 0.012,
  '深縹': 0.01, '鴨の羽色': 0.008, '瑠璃紺': 0.007, '藍墨': 0.005, '鉄色': 0.005,
  '縹色': 0.004, '黒': 0.003, '藍鼠': 0.003, '紺鼠': 0.002, '天色': 0.002,
};
const total = Object.values(weights).reduce((a, b) => a + b, 0);
for (const k of Object.keys(weights)) weights[k]! /= total;

const raw: RawResult = {
  answers: {
    color: { choice: '紺青', probabilities: Object.fromEntries(COLORS.map(c => [c.name, weights[c.name] ?? 0])) },
    family: { choice: 'navy', probabilities: Object.fromEntries(['red','pink','orange','brown','yellow','yellowgreen','green','bluegreen','blue','navy','purple','mono'].map(k => [k, k === 'navy' ? 0.82 : k === 'blue' ? 0.1 : k === 'mono' ? 0.05 : 0.003])) },
    tone: { score: 0.7 },
    vividness: { score: 1.8 },
    colorless: { probability: 0.03 },
  },
  usage: { inputTokens: 4183, outputTokens: 296, totalTokens: 4479 },
  providerMetadata: { gateway: { cost: '0.000172' } },
};

Bun.serve({ port: 8788, fetch: createHandler(async text => summarize(text, raw, 1180)) });
console.log('jev-color (stub, Gatewayへ接続しない): http://127.0.0.1:8788');
