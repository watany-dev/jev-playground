import { expect, test } from 'bun:test';
import { CHANNELS, LEVELS, LEVEL_HINTS, levelValue, scoreToValue } from '../src/channels';

test('16段階が 0〜255 をちょうど覆う', () => {
  expect(LEVELS).toBe(16);
  expect(levelValue(0)).toBe(0);
  expect(levelValue(LEVELS - 1)).toBe(255);
  // 8bitの上限ちょうどに着地することが、この刻み（17）を選んだ理由である。
  expect(scoreToValue(LEVELS - 1)).toBe(255);
});

test('レベルの説明は段階数と一致し、値を明示している', () => {
  expect(LEVEL_HINTS).toHaveLength(LEVELS);
  LEVEL_HINTS.forEach((hint, i) => expect(hint.startsWith(`${levelValue(i)} (0x`)).toBe(true));
});

test('成分は R・G・B の3つだけ', () => {
  expect(CHANNELS.map(c => c.key)).toEqual(['r', 'g', 'b']);
});
