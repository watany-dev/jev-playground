import { chmodSync } from 'node:fs';
import { Engine, hash } from './engine';
import { MAX_INPUT, parseEvent, readBounded } from './protocol';

export function startBroker(socket: string, engine: Engine) {
  const server = Bun.serve({
    unix: socket, maxRequestBodySize: MAX_INPUT,
    async fetch(request) {
      if (request.method !== 'POST' || new URL(request.url).pathname !== '/event') return new Response(null, { status: 404 });
      try {
        const e = parseEvent(JSON.parse(await readBounded(request.body)));
        // Cancellation cannot wait behind an in-flight provider request.
        if (e.hook_event_name === 'Interrupt' || e.hook_event_name === 'SessionEnd') {
          const session = engine.sessions.get(hash(e.session_id));
          if (session) session.stopped = e.hook_event_name;
          return Response.json({});
        }
        return Response.json(await engine.handle(e));
      } catch { return new Response(null, { status: 400 }); }
    },
  });
  chmodSync(socket, 0o600);
  return server;
}
