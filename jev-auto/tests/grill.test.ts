import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { buildState, decode, validate } from '../scripts/grill-jev';

const questions = {
  keep: { type: 'boolean' as const, instructions: 'Keep the current limit?' },
  option: { type: 'choice' as const, instructions: 'Pick one.', criteria: { keep8: 'keep', lower4: 'lower', measureFirst: 'measure' } },
  risk: { type: 'score' as const, instructions: 'Rate the risk.', criteria: ['low', 'medium', 'high'] },
};

const answers = {
  keep: { type: 'boolean', probability: 0.9 },
  option: { type: 'choice', choice: 'keep8', probabilities: { keep8: 0.7, lower4: 0.2, measureFirst: 0.1 } },
  risk: { type: 'score', score: 1.2, probabilities: { '0': 0.1, '1': 0.7, '2': 0.2 } },
};

test('decodes confident answers and reports the cost', () => {
  const result = decode(answers, questions, '0.0031');
  expect(result.cost).toBe(0.0031);
  expect(result.undecided).toEqual([]);
  expect(result.answers[0]).toMatchObject({ id: 'keep', value: 'yes', probability: 0.9, decided: true });
  expect(result.answers[1]).toMatchObject({ id: 'option', value: 'keep8', decided: true });
  expect((result.answers[1] as { margin: number }).margin).toBeCloseTo(0.5, 6);
  expect(result.answers[2]).toMatchObject({ id: 'risk', value: 1.2, nearestLevel: 1, levelLabel: 'medium', decided: true });
});

test('marks weak answers undecided instead of deciding them', () => {
  const weak = {
    keep: { type: 'boolean', probability: 0.55 },
    option: { type: 'choice', choice: 'keep8', probabilities: { keep8: 0.4, lower4: 0.35, measureFirst: 0.25 } },
    risk: { type: 'score', score: 1, probabilities: { '0': 0.35, '1': 0.35, '2': 0.3 } },
  };
  expect(decode(weak, questions, 0.002).undecided).toEqual(['keep', 'option', 'risk']);
});

test('rejects malformed answers and missing cost', () => {
  expect(() => decode({ ...answers, keep: { type: 'boolean', probability: 2 } }, questions, 0.001)).toThrow('invalid-jev-answer');
  expect(() => decode({ ...answers, option: { type: 'choice', choice: 'unknown' } }, questions, 0.001)).toThrow('invalid-jev-answer');
  expect(() => decode({ ...answers, risk: { type: 'score', score: 9 } }, questions, 0.001)).toThrow('invalid-jev-answer');
  expect(() => decode(answers, questions, undefined)).toThrow('missing-jev-cost');
});

test('validates the example grill file and masks secrets in the state', () => {
  const path = `${import.meta.dir}/../../.claude/skills/gril-jev/reference/example-grill.json`;
  const grill = validate(JSON.parse(readFileSync(path, 'utf8')));
  expect(Object.keys(grill.questions)).toEqual(['evidenceSupportsKeeping', 'option', 'risk']);
  const state = buildState({ title: 't', context: { note: 'api_key: abcdefgh12345678' }, questions: grill.questions });
  expect(state).not.toContain('abcdefgh12345678');
  expect(state).toContain('[REDACTED]');
});
