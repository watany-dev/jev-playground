import { expect, test } from 'bun:test';
import { MAX_TEXT_LENGTH, type Reading } from '../src/evaluate';
import { createHandler, parseText } from '../src/server';

const reading = { text: 'x', channels: [], narrowed: 0 } as unknown as Reading;
const post = (body: unknown) =>
  new Request('http://127.0.0.1/api/read', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

test('入力は課金の前に長さで止める', () => {
  expect(parseText({ text: ' 夜の海 ' })).toBe('夜の海');
  expect(() => parseText({ text: '   ' })).toThrow('invalid-input');
  expect(() => parseText({ text: 'あ'.repeat(MAX_TEXT_LENGTH + 1) })).toThrow('invalid-input');
  expect(() => parseText({ text: 42 })).toThrow('invalid-input');
  expect(() => parseText(null)).toThrow('invalid-input');
});

test('長すぎる入力では Jev を呼ばない', async () => {
  let called = 0;
  const handler = createHandler(async () => {
    called += 1;
    return reading;
  });
  const response = await handler(post({ text: 'あ'.repeat(MAX_TEXT_LENGTH + 1) }));
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'invalid-input' });
  expect(called).toBe(0);
});

test('同時実行が上限を超えたら 429 を返し、Jev を呼ばない', async () => {
  let called = 0;
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const handler = createHandler(async () => {
    called += 1;
    await gate;
    return reading;
  });
  const inFlight = Array.from({ length: 4 }, () => handler(post({ text: '夜の海' })));
  const rejected = await handler(post({ text: '夜の海' }));
  expect(rejected.status).toBe(429);
  expect(await rejected.json()).toEqual({ error: 'busy' });
  expect(called).toBe(4);
  release();
  await Promise.all(inFlight);
  // 終わった分は席が空く。
  expect((await handler(post({ text: '夜の海' }))).status).toBe(200);
});

test('失敗しても例外文面は外へ出さない', async () => {
  const handler = createHandler(async () => {
    throw new Error('key sk-live-xxxx rejected for "夜の海"');
  });
  const response = await handler(post({ text: '夜の海' }));
  expect(response.status).toBe(502);
  const body = await response.text();
  expect(body).toBe(JSON.stringify({ error: 'provider-error' }));
});

test('GET / は HTML、それ以外の経路は 404', async () => {
  const handler = createHandler(async () => reading);
  const html = await handler(new Request('http://127.0.0.1/'));
  expect(html.headers.get('content-type')).toContain('text/html');
  const body = await html.text();
  expect(body).toContain('JevにRGBを0〜255で決めさせる');
  expect((await handler(new Request('http://127.0.0.1/api/read'))).status).toBe(404);
  expect((await handler(new Request('http://127.0.0.1/nope', { method: 'POST' }))).status).toBe(404);
});
