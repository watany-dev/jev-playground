import { expect, test } from 'bun:test';
import { COLORS } from '../src/palette';
import { summarize, errorCategory, readApiKey, type RawResult } from '../src/evaluate';

/** 指定した色へ確率を置き、残りを0で埋めた255個の分布を作る。 */
function distribution(weights: Record<string, number>): Record<string, number> {
  return Object.fromEntries(COLORS.map(c => [c.name, weights[c.name] ?? 0]));
}

function raw(overrides: Partial<RawResult['answers']> = {}, weights: Record<string, number> = { 茜色: 1 }): RawResult {
  const probabilities = distribution(weights);
  const top = Object.entries(weights).sort((a, b) => b[1] - a[1])[0]![0];
  return {
    answers: {
      color: { choice: top, probabilities },
      family: { choice: 'red', probabilities: { red: 1, pink: 0, orange: 0, brown: 0, yellow: 0, yellowgreen: 0, green: 0, bluegreen: 0, blue: 0, navy: 0, purple: 0, mono: 0 } },
      tone: { score: 2 },
      vividness: { score: 3 },
      colorless: { probability: 0.04 },
      ...overrides,
    },
    usage: { inputTokens: 4200, outputTokens: 300, totalTokens: 4500 },
    providerMetadata: { gateway: { cost: '0.00017' } },
  };
}

test('確信している分布では最有力色と期待色が一致する', () => {
  const reading = summarize('夕焼け', raw(), 900);
  expect(reading.top.name).toBe('茜色');
  expect(reading.top.probability).toBe(1);
  expect(reading.expected).toBe('#B7282E');
  expect(reading.spread).toBe(1);
  expect(reading.narrowed).toBeCloseTo(Math.log2(255), 6);
  expect(reading.distribution.length).toBe(255);
  expect(reading.cost).toBe(0.00017);
  expect(reading.durationMs).toBe(900);
});

test('分布が割れると期待色は最有力色から離れ、絞り込み量が落ちる', () => {
  const split = summarize('よくわからない', raw({ color: { choice: '茜色', probabilities: distribution({ 茜色: 0.5, 青: 0.5 }) } }, { 茜色: 0.5, 青: 0.5 }), 900);
  expect(split.expected).not.toBe('#B7282E');
  expect(split.narrowed).toBeCloseTo(Math.log2(255) - 1, 6);
  expect(split.spread).toBe(2);
  expect(split.ranked.slice(0, 2).map(c => c.name).sort()).toEqual(['茜色', '青']);
});

test('上位は確率の降順で最大12件', () => {
  const weights = Object.fromEntries(COLORS.slice(0, 20).map((c, i) => [c.name, (20 - i) / 210]));
  const reading = summarize('赤系', raw({ color: { choice: COLORS[0]!.name, probabilities: distribution(weights) } }, weights), 1);
  expect(reading.ranked.length).toBe(12);
  for (let i = 1; i < reading.ranked.length; i += 1) {
    expect(reading.ranked[i - 1]!.probability).toBeGreaterThanOrEqual(reading.ranked[i]!.probability);
  }
});

test('Jev の明るさ・鮮やかさと選んだ色の実測値のずれを出す', () => {
  const reading = summarize('夕焼け', raw(), 1);
  // 茜色 (#B7282E) は明度0.44・彩度0.64 なので、4段階では約1.75 / 2.55。
  expect(reading.drift.tone).toBeCloseTo(Math.abs(2 - 0.4373 * 4), 1);
  expect(reading.drift.vividness).toBeCloseTo(Math.abs(3 - 0.6372 * 4), 1);
});

test('分布が欠けた応答は invalid-answer として捨てる', () => {
  expect(() => summarize('x', raw({ color: { choice: '茜色' } }), 1)).toThrow('invalid-answer');
});

test('宣言していない色を選んだ応答は捨てる', () => {
  expect(() => summarize('x', raw({ color: { choice: '虹色', probabilities: distribution({ 茜色: 1 }) } }), 1)).toThrow('invalid-answer');
});

test('範囲外の score と確率は捨てる', () => {
  expect(() => summarize('x', raw({ tone: { score: 9 } }), 1)).toThrow('invalid-answer');
  expect(() => summarize('x', raw({ colorless: { probability: 1.4 } }), 1)).toThrow('invalid-answer');
  expect(() => summarize('x', raw({ color: { choice: '茜色', probabilities: { ...distribution({ 茜色: 1 }), 青: Number.NaN } } }), 1)).toThrow('invalid-answer');
});

test('計上額が読めない応答でも表示は続けられる', () => {
  const body = { ...raw(), providerMetadata: { gateway: { cost: '' } } };
  expect(summarize('x', body, 1).cost).toBeNull();
});

test('失敗は固定カテゴリへ畳む', () => {
  expect(errorCategory({ name: 'TimeoutError' })).toBe('timeout');
  expect(errorCategory(new Error('invalid-answer'))).toBe('invalid-answer');
  expect(errorCategory({ statusCode: 403 })).toBe('http-403');
  expect(errorCategory(new Error('Bearer sk-live-secret leaked'))).toBe('provider-error');
});

test('APIキーは環境変数からのみ読む', () => {
  expect(readApiKey({ AI_GATEWAY_API_KEY: ' key ' })).toBe('key');
  expect(() => readApiKey({})).toThrow('missing-api-key');
  expect(() => readApiKey({ AI_GATEWAY_API_KEY: '  ' })).toThrow('missing-api-key');
});
