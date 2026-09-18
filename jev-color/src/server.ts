/** 1画面ぶんのサーバー。GET / で画面、POST /api/read で Jev を1回呼ぶ。
 *
 * POST は課金の発生する経路なので、入力長と同時実行数をここで止める。
 * 失敗は `errorCategory` の固定語だけを返し、例外文面は外へ出さない。
 */

import { readableInk } from './color';
import { MAX_TEXT_LENGTH, createReader, errorCategory, readApiKey, type Reader, type Reading } from './evaluate';
import { page } from './ui';

const MAX_IN_FLIGHT = 4;

/** 画面が使う表示用の色（白文字か黒文字か）を足して返す。 */
export function present(reading: Reading) {
  return {
    ...reading,
    top: { ...reading.top, ink: readableInk(reading.top.hex) },
    expectedInk: readableInk(reading.expected),
  };
}

export function parseText(body: unknown): string {
  const text = (body as { text?: unknown } | null)?.text;
  if (typeof text !== 'string') throw new Error('invalid-input');
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MAX_TEXT_LENGTH) throw new Error('invalid-input');
  return trimmed;
}

export function createHandler(read: Reader): (request: Request) => Promise<Response> {
  let inFlight = 0;
  const html = page();
  return async request => {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/') {
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (request.method !== 'POST' || url.pathname !== '/api/read') {
      return Response.json({ error: 'not-found' }, { status: 404 });
    }
    if (inFlight >= MAX_IN_FLIGHT) return Response.json({ error: 'busy' }, { status: 429 });

    // 本文の読み取りも await をまたぐ。数える範囲を分けると、上限の判定がすり抜ける。
    inFlight += 1;
    try {
      let text: string;
      try {
        text = parseText(await request.json());
      } catch {
        return Response.json({ error: 'invalid-input' }, { status: 400 });
      }
      return Response.json(present(await read(text)));
    } catch (error) {
      const category = errorCategory(error);
      console.error(`read failed: ${category}`);
      return Response.json({ error: category }, { status: 502 });
    } finally {
      inFlight -= 1;
    }
  };
}

if (import.meta.main) {
  const handler = createHandler(createReader(readApiKey(process.env)));
  const server = Bun.serve({
    hostname: process.env.JEV_COLOR_HOST ?? '127.0.0.1',
    port: Number(process.env.JEV_COLOR_PORT ?? 8787),
    fetch: handler,
  });
  console.log(`jev-color: http://${server.hostname}:${server.port}`);
}
