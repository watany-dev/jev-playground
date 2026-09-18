import { expect, test } from 'bun:test';
import { LEVELS } from '../src/channels';
import {
  coverageCount, entropyBits, expectedValue, expectedValueLinear, jointDistribution,
  narrowedBits, saturation, toHex, topColors,
} from '../src/color';

const spike = (level: number) => Array.from({ length: LEVELS }, (_, i) => (i === level ? 1 : 0));
const uniform = Array.from({ length: LEVELS }, () => 1 / LEVELS);

test('1点に確信した分布は、その段階の値をそのまま返す', () => {
  expect(expectedValue(spike(15))).toBe(255);
  expect(expectedValue(spike(0))).toBe(0);
  expect(expectedValueLinear(spike(15))).toBeCloseTo(255, 6);
});

test('8bitの平均と光の平均は、分布が割れたときにずれる', () => {
  const split = Array.from({ length: LEVELS }, (_, i) => (i === 0 || i === 15 ? 0.5 : 0));
  expect(expectedValue(split)).toBeCloseTo(127.5, 6);
  // 光として平均すると明るい側へ寄る。どちらが正しいかではなく、平均の意味が違う。
  expect(expectedValueLinear(split)).toBeGreaterThan(180);
});

test('絞り込み量は一様で0、確信で4bit', () => {
  expect(entropyBits(uniform)).toBeCloseTo(4, 6);
  expect(narrowedBits(uniform)).toBeCloseTo(0, 6);
  expect(narrowedBits(spike(7))).toBeCloseTo(4, 6);
});

test('累積90%に必要な段階数', () => {
  expect(coverageCount(spike(3))).toBe(1);
  expect(coverageCount(uniform)).toBe(15);
});

test('同時分布は3本の積で、上位は最頻の組み合わせ', () => {
  const joint = jointDistribution([spike(15), spike(0), spike(15)]);
  expect(joint).toHaveLength(LEVELS ** 3);
  expect(joint.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  const [top] = topColors(joint, 12);
  expect(top!.hex).toBe('#FF00FF');
  expect(top!.probability).toBeCloseTo(1, 6);
});

test('hex は 0〜255 へ丸めて収める', () => {
  expect(toHex({ r: 255, g: 0, b: 128 })).toBe('#FF0080');
  expect(toHex({ r: 300, g: -5, b: 127.6 })).toBe('#FF0080');
});

test('彩度は3成分が揃うほど0に近づく', () => {
  expect(saturation({ r: 120, g: 120, b: 120 })).toBe(0);
  expect(saturation({ r: 255, g: 0, b: 0 })).toBeCloseTo(1, 6);
});
