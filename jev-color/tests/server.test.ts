import { expect, test } from 'bun:test';
import { COLORS } from '../src/palette';
import { summarize, type RawResult } from '../src/evaluate';
import { createHandler, parseText, present } from '../src/server';

const answers: RawResult = {
  answers: {
    color: { choice: '藍色', probabilities: Object.fromEntries(COLORS.map(c => [c.name, c.name === '藍色' ? 1 : 0])) },
    family: { choice: 'navy', probabilities: { red: 0, pink: 0, orange: 0, brown: 0, yellow: 0, yellowgreen: 0, green: 0, bluegreen: 0, blue: 0, navy: 1, purple: 0, mono: 0 } },
    tone: { score: 1 },
    vividness: { score: 2 },
    colorless: { probability: 0.02 },
  },
  usage: { inputTokens: 4200, outputTokens: 300, totalTokens: 4500 },
  providerMetadata: { gateway: { cost: '0.00017' } },
};

const ok = createHandler(async text => summarize(text, answers, 10));
const post = (body: unknown) =>
  new Request('http://localhost/api/read', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('GET / は画面を返し、255色ぶんのセルの材料を含む', async () => {
  const response = await ok(new Request('http://localhost/'));
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/html');
  const html = await response.text();
  expect(html).toContain('藍色');
  expect(html).toContain('#B7282E');
  // 画面は利用者の入力を埋め込まない。描画は必ずクライアント側の textContent を通る。
  expect(html).not.toContain('innerHTML');
});

test('POST /api/read は読み取り結果と表示用の文字色を返す', async () => {
  const response = await ok(post({ text: '  夜の海  ' }));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.text).toBe('夜の海');
  expect(body.top.name).toBe('藍色');
  expect(body.top.ink).toBe('#FFFFFF');
  expect(body.expectedInk).toBe('#FFFFFF');
  expect(body.distribution.length).toBe(255);
});

test('空・長すぎ・文字列でない入力は Jev を呼ばずに弾く', async () => {
  let called = 0;
  const handler = createHandler(async text => { called += 1; return summarize(text, answers, 1); });
  for (const body of [{ text: '   ' }, { text: 'あ'.repeat(401) }, { text: 42 }, {}]) {
    const response = await handler(post(body));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('invalid-input');
  }
  expect(called).toBe(0);
  expect(parseText({ text: 'あ'.repeat(400) }).length).toBe(400);
});

test('壊れた JSON でも 400 で止まる', async () => {
  const response = await ok(new Request('http://localhost/api/read', { method: 'POST', body: '{' }));
  expect(response.status).toBe(400);
});

test('失敗は固定カテゴリだけを返し、例外文面を漏らさない', async () => {
  const handler = createHandler(async () => { throw new Error('Bearer sk-live-secret'); });
  const response = await handler(post({ text: '夜の海' }));
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error: 'provider-error' });
});

test('同時実行が上限を超えたら課金前に 429 で返す', async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const handler = createHandler(async text => { await gate; return summarize(text, answers, 1); });
  const running = Array.from({ length: 4 }, () => handler(post({ text: '夜の海' })));
  const rejected = await handler(post({ text: '夜の海' }));
  expect(rejected.status).toBe(429);
  expect((await rejected.json()).error).toBe('busy');
  release();
  for (const response of await Promise.all(running)) expect(response.status).toBe(200);
});

test('それ以外の経路は 404', async () => {
  expect((await ok(new Request('http://localhost/api/read'))).status).toBe(404);
  expect((await ok(new Request('http://localhost/secret'))).status).toBe(404);
});

test('present は読み取り結果を壊さない', () => {
  const reading = summarize('夜の海', answers, 10);
  expect(present(reading).distribution).toEqual(reading.distribution);
});
