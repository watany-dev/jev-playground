import { expect, test } from 'bun:test';
import { coverageCount, entropyBits, mix, narrowedBits, parseHex, readableInk, toHex, toHsl } from '../src/color';

test('hex の往復', () => {
  expect(toHex(parseHex('#B7282E'))).toBe('#B7282E');
  expect(() => parseHex('B7282E')).toThrow();
  expect(() => parseHex('#xyzxyz')).toThrow();
});

test('混色は線形空間で行う（単純平均より暗くならない）', () => {
  const mixed = mix([{ hex: '#000000', weight: 0.5 }, { hex: '#FFFFFF', weight: 0.5 }]);
  expect(parseHex(mixed).r).toBeGreaterThan(128);
});

test('重み0の色は混色に寄与しない', () => {
  expect(mix([{ hex: '#FF0000', weight: 1 }, { hex: '#00FF00', weight: 0 }])).toBe('#FF0000');
  expect(mix([{ hex: '#FF0000', weight: 0 }])).toBe('#000000');
});

test('対立する色を混ぜると彩度が落ちる（分布が割れるほど灰へ寄る）', () => {
  const split = mix([
    { hex: '#FF2800', weight: 0.5 },
    { hex: '#0095D9', weight: 0.5 },
  ]);
  expect(toHsl(split).s).toBeLessThan(toHsl('#FF2800').s);
});

test('HSL は無彩色で彩度0になる', () => {
  expect(toHsl('#7D7D7D').s).toBe(0);
  expect(toHsl('#FFD900').h).toBeCloseTo(51, 0);
});

test('エントロピーと絞り込み量', () => {
  expect(entropyBits([1])).toBe(0);
  expect(entropyBits([0.5, 0.5])).toBe(1);
  expect(entropyBits([0.5, 0.5, 0])).toBe(1);
  const uniform = new Array(255).fill(1 / 255);
  expect(narrowedBits(uniform)).toBeCloseTo(0, 6);
  const certain = [1, ...new Array(254).fill(0)];
  expect(narrowedBits(certain)).toBeCloseTo(Math.log2(255), 6);
});

test('累積90%に必要な色数', () => {
  expect(coverageCount([1, 0, 0])).toBe(1);
  expect(coverageCount([0.5, 0.3, 0.15, 0.05])).toBe(3);
  expect(coverageCount([0.4, 0.3])).toBe(2);
});

test('明るい色には黒、暗い色には白を載せる', () => {
  expect(readableInk('#FFFFFF')).toBe('#000000');
  expect(readableInk('#0F2350')).toBe('#FFFFFF');
});
