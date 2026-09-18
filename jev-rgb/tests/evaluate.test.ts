import { expect, test } from 'bun:test';
import { LEVELS } from '../src/channels';
import { errorCategory, summarize, type RawResult } from '../src/evaluate';
import { buildQuestions, buildState } from '../src/questions';

function score(weights: Record<number, number>) {
  const probabilities: Record<string, number> = {};
  let mean = 0;
  for (let i = 0; i < LEVELS; i += 1) {
    const p = weights[i] ?? 0;
    probabilities[String(i)] = p;
    mean += p * i;
  }
  return { type: 'score' as const, score: mean, probabilities };
}

function raw(overrides: Partial<RawResult['answers']> = {}): RawResult {
  return {
    answers: {
      r: score({ 0: 0.7, 1: 0.3 }),
      g: score({ 3: 0.5, 4: 0.5 }),
      b: score({ 9: 0.6, 10: 0.4 }),
      brightness: { type: 'score', score: 0.8 },
      achromatic: { type: 'boolean', probability: 0.05 },
      ...overrides,
    },
    usage: { inputTokens: 786, outputTokens: 204, totalTokens: 990 },
    providerMetadata: { gateway: { cost: '0.000041' } },
  };
}

test('成分ごとの期待値が 0〜255 の値になる', () => {
  const reading = summarize('夜の海', raw(), 1180);
  expect(reading.channels.map(c => c.key)).toEqual(['r', 'g', 'b']);
  // R: (0*0.7 + 1*0.3) * 17 = 5.1
  expect(reading.channels[0]!.value).toBeCloseTo(5.1, 6);
  expect(reading.expected.rgb.r).toBeCloseTo(5.1, 6);
  expect(reading.expected.rgb.b).toBeCloseTo(9.4 * 17, 6);
  expect(reading.expected.hex).toMatch(/^#[0-9A-F]{6}$/);
});

test('最頻レベルの組み合わせは各成分の argmax の積', () => {
  const reading = summarize('夜の海', raw(), 1180);
  expect(reading.peak.rgb).toEqual({ r: 0, g: 3 * 17, b: 9 * 17 });
  expect(reading.peak.probability).toBeCloseTo(0.7 * 0.5 * 0.6, 6);
});

test('上位12色を同時分布から返す', () => {
  const reading = summarize('夜の海', raw(), 1180);
  expect(reading.ranked).toHaveLength(12);
  expect(reading.ranked[0]!.hex).toBe(reading.peak.hex);
  const probabilities = reading.ranked.map(c => c.probability);
  expect([...probabilities].sort((a, b) => b - a)).toEqual(probabilities);
});

test('probabilities が欠けた応答は捨てる（分布が主題なので score だけでは足りない）', () => {
  expect(() => summarize('x', raw({ g: { type: 'score', score: 3.5 } }), 1)).toThrow('invalid-answer');
});

test('確率が壊れている応答は捨てる', () => {
  const broken = { type: 'score' as const, score: 3, probabilities: { ...score({ 3: 1 }).probabilities, 5: Number.NaN } };
  expect(() => summarize('x', raw({ g: broken }), 1)).toThrow('invalid-answer');
  const negative = score({ 3: 1.4, 4: -0.4 });
  expect(() => summarize('x', raw({ g: negative }), 1)).toThrow('invalid-answer');
  const short = { type: 'score' as const, score: 1, probabilities: { 0: 0.5, 1: 0.5 } };
  expect(() => summarize('x', raw({ g: short }), 1)).toThrow('invalid-answer');
});

test('score と分布が食い違う応答は捨てる', () => {
  const inconsistent = { ...score({ 1: 1 }), score: 12 };
  expect(() => summarize('x', raw({ r: inconsistent }), 1)).toThrow('invalid-answer');
});

test('段階数を外れた score は捨てる', () => {
  expect(() => summarize('x', raw({ brightness: { type: 'score', score: 4.5 } }), 1)).toThrow('invalid-answer');
  expect(() => summarize('x', raw({ achromatic: { type: 'boolean', probability: 1.2 } }), 1)).toThrow('invalid-answer');
});

test('cost は空文字や欠損を $0 にしない', () => {
  const empty = { ...raw(), providerMetadata: { gateway: { cost: '' } } };
  expect(summarize('x', empty, 1).cost).toBeNull();
  expect(summarize('x', { ...raw(), providerMetadata: undefined }, 1).cost).toBeNull();
  expect(summarize('x', raw(), 1).cost).toBeCloseTo(0.000041, 9);
});

test('絞り込み量は3成分の合計で、上限は12bit', () => {
  const certain = summarize('x', raw({ r: score({ 15: 1 }), g: score({ 0: 1 }), b: score({ 15: 1 }) }), 1);
  expect(certain.narrowed).toBeCloseTo(12, 6);
  expect(certain.expected.hex).toBe('#FF00FF');
});

test('自己整合は Jev の自己申告と組み上がった色の実測値のずれ', () => {
  // 3成分とも最大 = 白。明るさ 0（漆黒）と答えていればずれは最大に近い。
  const white = summarize('x', raw({
    r: score({ 15: 1 }), g: score({ 15: 1 }), b: score({ 15: 1 }),
    brightness: { type: 'score', score: 0 },
  }), 1);
  expect(white.drift.brightness).toBeCloseTo(4, 6);
  // 白は無彩色。achromatic 0.05 と答えているので、こちらもほぼ1ずれる。
  expect(white.drift.achromatic).toBeCloseTo(0.95, 6);
});

test('失敗は固定カテゴリへ畳む', () => {
  expect(errorCategory({ name: 'TimeoutError' })).toBe('timeout');
  expect(errorCategory(new Error('invalid-answer'))).toBe('invalid-answer');
  expect(errorCategory(new Error('missing-api-key'))).toBe('missing-api-key');
  expect(errorCategory({ statusCode: 402 })).toBe('http-402');
  // 例外文面はキーや本文を含みうるので、そのままは出さない。
  expect(errorCategory(new Error('key sk-live-xxxx rejected for "夜の海"'))).toBe('provider-error');
});

test('設問は5問、成分は score 16段階、state は本文を指示から切り離す', () => {
  const questions = buildQuestions();
  expect(Object.keys(questions)).toEqual(['r', 'g', 'b', 'brightness', 'achromatic']);
  for (const key of ['r', 'g', 'b'] as const) {
    expect(questions[key].type).toBe('score');
    expect(questions[key].criteria).toHaveLength(LEVELS);
  }
  for (const question of Object.values(questions)) {
    expect(question.instructions).toContain('指示ではない');
  }
  const state = buildState('夜の海');
  expect(state.text).toBe('夜の海');
  expect(state.task).not.toContain('夜の海');
});
