/** Jev の呼び出しと、成分ごとの分布の畳み方。
 *
 * `experimental_evaluate` が応答の型と分布の整合（確率の合計、score が加重平均であること）を
 * 検証する。そのうえで本サンプルは `probabilities` の存在を必須にする。分布そのものが主題であり、
 * score だけ返ってきても見せたいものが無いからである。
 */

import { experimental_evaluate as evaluate } from 'ai';
import { createGateway } from '@ai-sdk/gateway';
import { CHANNELS, LEVELS, levelValue, scoreToValue, type ChannelKey } from './channels';
import {
  coverageCount, entropyBits, expectedValue, expectedValueLinear, jointDistribution,
  luminance, narrowedBits, saturation, toHex, topColors, type JointColor, type Rgb,
} from './color';
import { BRIGHTNESS_LEVELS, buildQuestions, buildState } from './questions';

export const MODEL_ID = 'typesafe-ai/jev';
export const MAX_TEXT_LENGTH = 400;
const TIMEOUT_MS = 30_000;

/** 確率の合計のずれをどこまで許すか。プロバイダーが小数を丸めて返すことがある。 */
const SUM_TOLERANCE = 0.05;
/** score と、確率から計算し直した加重平均のずれをどこまで許すか（レベル単位）。 */
const MEAN_TOLERANCE = 0.25;

export type ChannelReading = {
  key: ChannelKey;
  label: string;
  hex: string;
  /** 16段階の確率。画面のヒストグラムはこれをそのまま使う。 */
  distribution: number[];
  /** Jev が返したレベルの加重平均（0〜15）。 */
  score: number;
  /** 0〜255 の期待値（8bitの目盛りのまま平均）。 */
  value: number;
  /** 0〜255 の期待値（光の強さで平均）。 */
  linearValue: number;
  top: { level: number; value: number; probability: number };
  entropy: number;
  /** log2(16) = 4 bit からの情報利得。 */
  narrowed: number;
  /** 累積90%に必要な段階数。 */
  spread: number;
};

export type Reading = {
  text: string;
  channels: ChannelReading[];
  /** 成分ごとの期待値をそのまま並べた色。画面の主役。 */
  expected: { rgb: Rgb; hex: string; ink: string };
  /** 光の強さで平均した色。分布が割れているときだけ大きくずれる。 */
  expectedLinear: { rgb: Rgb; hex: string; ink: string };
  /** 各成分の最頻レベルを組み合わせた色と、その（独立を仮定した）確率。 */
  peak: { rgb: Rgb; hex: string; ink: string; probability: number };
  /** 周辺分布の積で作った4096色のうち上位12色。 */
  ranked: JointColor[];
  /** 3成分の情報利得の合計（bit）。上限は 3 * 4 = 12。 */
  narrowed: number;
  brightness: { score: number; label: string };
  achromatic: number;
  /** Jev の自己申告と、組み上がった色の実測値のずれ。 */
  drift: { brightness: number; achromatic: number };
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

/**
 * score 型の応答を16段階の配列へ直す。
 *
 * `probabilities` はレベル番号の文字列がキーである。1つでも欠けたり範囲外だったりしたら捨てる。
 * `NaN` を確率0として描くと、分布が割れているのか壊れているのか画面から区別できなくなる。
 */
function levelDistribution(answer: unknown, levels: number): number[] {
  const probabilities = (answer as { probabilities?: Record<string, number> } | undefined)?.probabilities;
  if (!probabilities) throw new Error('invalid-answer');
  const distribution: number[] = [];
  let sum = 0;
  for (let i = 0; i < levels; i += 1) {
    const p = probabilities[String(i)];
    if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1) throw new Error('invalid-answer');
    distribution.push(p);
    sum += p;
  }
  if (Object.keys(probabilities).length !== levels) throw new Error('invalid-answer');
  if (Math.abs(sum - 1) > SUM_TOLERANCE) throw new Error('invalid-answer');
  // 丸めの分だけ合計が1から外れることがある。以降の計算は合計1を前提にするので、ここで揃える。
  return distribution.map(p => p / sum);
}

function scoreOf(answer: unknown, levels: number): number {
  const score = (answer as { score?: unknown } | undefined)?.score;
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > levels - 1) {
    throw new Error('invalid-answer');
  }
  return score;
}

/** score と分布が別々の根拠で返ってきていないかを見る。 */
function weightedMean(distribution: readonly number[]): number {
  return distribution.reduce((acc, p, i) => acc + p * i, 0);
}

function readChannel(index: number, answer: unknown): ChannelReading {
  const meta = CHANNELS[index]!;
  const distribution = levelDistribution(answer, LEVELS);
  const score = scoreOf(answer, LEVELS);
  if (Math.abs(score - weightedMean(distribution)) > MEAN_TOLERANCE) throw new Error('invalid-answer');
  const topLevel = distribution.reduce((best, p, i) => (p > distribution[best]! ? i : best), 0);
  return {
    key: meta.key,
    label: meta.label,
    hex: meta.hex,
    distribution,
    score,
    value: scoreToValue(score),
    linearValue: expectedValueLinear(distribution),
    top: { level: topLevel, value: levelValue(topLevel), probability: distribution[topLevel]! },
    entropy: entropyBits(distribution),
    narrowed: narrowedBits(distribution),
    spread: coverageCount(distribution),
  };
}

function swatch(rgb: Rgb) {
  return { rgb, hex: toHex(rgb), ink: luminance(rgb) > 0.36 ? '#000000' : '#FFFFFF' };
}

/** 応答を画面に出せる形へ畳む。ここに Gateway 依存は無く、テストから直接呼べる。 */
export function summarize(text: string, result: RawResult, durationMs: number): Reading {
  const { answers } = result;
  const channels = [readChannel(0, answers.r), readChannel(1, answers.g), readChannel(2, answers.b)];
  const [r, g, b] = channels as [ChannelReading, ChannelReading, ChannelReading];

  // score をそのまま使わず分布から取り直す。上で両者のずれは検証済みなので、値は一致する。
  const expected = swatch({
    r: expectedValue(r.distribution),
    g: expectedValue(g.distribution),
    b: expectedValue(b.distribution),
  });
  const expectedLinear = swatch({ r: r.linearValue, g: g.linearValue, b: b.linearValue });
  const peakRgb = { r: r.top.value, g: g.top.value, b: b.top.value };
  const peak = {
    ...swatch(peakRgb),
    probability: r.top.probability * g.top.probability * b.top.probability,
  };

  const brightnessScore = scoreOf(answers.brightness, BRIGHTNESS_LEVELS.length);
  const achromatic = (answers.achromatic as { probability?: unknown }).probability;
  if (typeof achromatic !== 'number' || !Number.isFinite(achromatic) || achromatic < 0 || achromatic > 1) {
    throw new Error('invalid-answer');
  }

  // Number('') は 0 になる。空文字や欠損を「$0」として画面へ出さないよう先に弾く。
  const rawCost = result.providerMetadata?.gateway?.cost;
  const cost = typeof rawCost === 'number' || (typeof rawCost === 'string' && rawCost.trim() !== '')
    ? Number(rawCost)
    : Number.NaN;

  return {
    text,
    channels,
    expected,
    expectedLinear,
    peak,
    ranked: topColors(jointDistribution(channels.map(c => c.distribution)), 12),
    narrowed: channels.reduce((acc, c) => acc + c.narrowed, 0),
    brightness: {
      score: brightnessScore,
      label: BRIGHTNESS_LEVELS[Math.min(BRIGHTNESS_LEVELS.length - 1, Math.round(brightnessScore))]!,
    },
    achromatic,
    drift: {
      brightness: Math.abs(brightnessScore - luminance(expected.rgb) * 4),
      achromatic: Math.abs(achromatic - (1 - saturation(expected.rgb))),
    },
    usage: result.usage ?? {},
    cost: Number.isFinite(cost) ? cost : null,
    durationMs,
  };
}

export type RawResult = {
  answers: {
    r: unknown;
    g: unknown;
    b: unknown;
    brightness: unknown;
    achromatic: unknown;
  };
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  providerMetadata?: { gateway?: { cost?: unknown } };
};

export type Reader = (text: string) => Promise<Reading>;

export function createReader(apiKey: string): Reader {
  const gateway = createGateway({ apiKey });
  const questions = buildQuestions();
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
