/** Jev の呼び出しと、255個の確率の畳み方。
 *
 * AI SDK の `experimental_evaluate` が応答の型と分布の整合（合計1、argmax、
 * score の加重平均）を検証する。ただし `probabilities` は型の上では省略可能なので、
 * 分布そのものを主題にする本サンプルでは欠けていたら失敗として扱う。
 */

import { experimental_evaluate as evaluate } from 'ai';
import { createGateway } from '@ai-sdk/gateway';
import { COLORS, BY_NAME, FAMILIES, MAX_CHOICES, type Color, type Family } from './palette';
import { coverageCount, entropyBits, mix, narrowedBits, toHsl } from './color';
import { TONE_LEVELS, VIVIDNESS_LEVELS, buildQuestions, buildState } from './questions';

export const MODEL_ID = 'typesafe-ai/jev';
export const MAX_TEXT_LENGTH = 400;
const TIMEOUT_MS = 30_000;

export type Ranked = { name: string; hex: string; probability: number };

export type Reading = {
  text: string;
  /** COLORS と同じ並びの255個の確率。格子表示はこれをそのまま使う。 */
  distribution: number[];
  top: { name: string; hex: string; hint: string; family: Family; probability: number };
  ranked: Ranked[];
  /** 255色を確率で混ぜた色。分布が割れるほど灰へ寄る。 */
  expected: string;
  entropy: number;
  narrowed: number;
  /** 累積90%に必要な色数。 */
  spread: number;
  family: { key: Family; label: string; probability: number };
  tone: { score: number; label: string };
  vividness: { score: number; label: string };
  colorless: number;
  /** Jev の tone/vividness と、選んだ色の実測 HSL のずれ（0〜4段階のまま）。 */
  drift: { tone: number; vividness: number };
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  cost: number | null;
  durationMs: number;
};

/** 外へ出してよい固定カテゴリだけを返す。例外文面はキーや本文を含みうる。 */
export function errorCategory(error: unknown): string {
  const e = error as { name?: string; message?: string; statusCode?: number } | null;
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return 'timeout';
  if (e?.message === 'invalid-answer') return 'invalid-answer';
  if (e?.message === 'missing-api-key') return 'missing-api-key';
  if (Number.isInteger(e?.statusCode) && e!.statusCode! >= 400 && e!.statusCode! <= 599) return `http-${e!.statusCode}`;
  return 'provider-error';
}

function distributionOf(answer: unknown, keys: readonly string[]): Record<string, number> {
  const probabilities = (answer as { probabilities?: Record<string, number> } | undefined)?.probabilities;
  if (!probabilities) throw new Error('invalid-answer');
  for (const key of keys) {
    const p = probabilities[key];
    if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1) throw new Error('invalid-answer');
  }
  return probabilities;
}

/** 応答を画面に出せる形へ畳む。ここに Gateway 依存は無く、テストから直接呼べる。 */
export function summarize(text: string, result: RawResult, durationMs: number): Reading {
  const { answers } = result;
  const colorProbabilities = distributionOf(answers.color, COLORS.map(c => c.name));
  const familyProbabilities = distributionOf(answers.family, Object.keys(FAMILIES));
  const top = BY_NAME.get(answers.color.choice);
  if (!top) throw new Error('invalid-answer');

  const distribution = COLORS.map(c => colorProbabilities[c.name] ?? 0);
  const sorted = [...distribution].sort((a, b) => b - a);
  const ranked = COLORS
    .map((c, i) => ({ name: c.name, hex: c.hex, probability: distribution[i]! }))
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 12);

  const familyKey = answers.family.choice as Family;
  const hsl = toHsl(top.hex);
  const scoreOf = (answer: { score: number }, levels: readonly string[]) => {
    const score = answer.score;
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > levels.length - 1) {
      throw new Error('invalid-answer');
    }
    return { score, label: levels[Math.min(levels.length - 1, Math.round(score))]! };
  };
  const tone = scoreOf(answers.tone, TONE_LEVELS);
  const vividness = scoreOf(answers.vividness, VIVIDNESS_LEVELS);
  const colorless = answers.colorless.probability;
  if (typeof colorless !== 'number' || !Number.isFinite(colorless) || colorless < 0 || colorless > 1) {
    throw new Error('invalid-answer');
  }

  // Number('') は 0 になる。空文字や欠損を「$0」として画面へ出さないよう先に弾く。
  const rawCost = result.providerMetadata?.gateway?.cost;
  const cost = typeof rawCost === 'number' || (typeof rawCost === 'string' && rawCost.trim() !== '')
    ? Number(rawCost)
    : Number.NaN;

  return {
    text,
    distribution,
    top: { name: top.name, hex: top.hex, hint: top.hint, family: top.family, probability: colorProbabilities[top.name]! },
    ranked,
    expected: mix(COLORS.map((c, i) => ({ hex: c.hex, weight: distribution[i]! }))),
    entropy: entropyBits(distribution),
    narrowed: narrowedBits(distribution),
    spread: coverageCount(sorted),
    family: { key: familyKey, label: FAMILIES[familyKey] ?? familyKey, probability: familyProbabilities[familyKey] ?? 0 },
    tone,
    vividness,
    colorless,
    drift: {
      tone: Math.abs(tone.score - hsl.l * 4),
      vividness: Math.abs(vividness.score - hsl.s * 4),
    },
    usage: result.usage ?? {},
    cost: Number.isFinite(cost) ? cost : null,
    durationMs,
  };
}

export type RawResult = {
  answers: {
    color: { choice: string; probabilities?: Record<string, number> };
    family: { choice: string; probabilities?: Record<string, number> };
    tone: { score: number };
    vividness: { score: number };
    colorless: { probability: number };
  };
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  providerMetadata?: { gateway?: { cost?: unknown } };
};

export type Reader = (text: string) => Promise<Reading>;

export function createReader(apiKey: string): Reader {
  const gateway = createGateway({ apiKey });
  const questions = buildQuestions();
  if (Object.keys(questions.color.criteria).length > MAX_CHOICES) throw new Error('invalid-answer');
  return async text => {
    const started = Date.now();
    const result = await evaluate({
      model: gateway.evaluationModel(MODEL_ID),
      state: buildState(text),
      questions,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      // 検証済みのプロバイダーだけに固定する（jev-auto/docs/REPORT.md と同じ方針）。
      providerOptions: { gateway: { only: ['typesafe-ai'] } },
    });
    return summarize(text, result as unknown as RawResult, Date.now() - started);
  };
}

export function readApiKey(env: Record<string, string | undefined>): string {
  const key = env.AI_GATEWAY_API_KEY?.trim();
  if (!key) throw new Error('missing-api-key');
  return key;
}

export type { Color };
