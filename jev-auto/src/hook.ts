import { deny, events, MAX_INPUT, parseEvent, readBounded } from './protocol';

export async function hook(expected: string): Promise<void> {
  // A process that successfully starts always returns an event-appropriate error.
  // Kill-before-start / SIGKILL / hooks disabled cannot be repaired by this wrapper.
  let output;
  try {
    if (!events.includes(expected as any)) throw new Error('event');
    const event = parseEvent(JSON.parse(await readBounded(Bun.stdin.stream())), expected);
    const socket = Bun.env.JEV_AUTO_SOCKET;
    if (!socket) throw new Error('missing-broker');
    const response = await fetch('http://localhost/event', {
      unix: socket, method: 'POST', body: JSON.stringify(event),
      signal: AbortSignal.timeout(expected === 'Interrupt' || expected === 'SessionEnd' ? 500 : 8000),
    });
    if (!response.ok) throw new Error('broker-error');
    output = JSON.parse(await readBounded(response.body, MAX_INPUT));
    if (!output || typeof output !== 'object' || Array.isArray(output)) throw new Error('broker-schema');
  } catch { output = deny(expected, 'jev-auto: hook/broker unavailable; operation not authorized'); }
  console.log(JSON.stringify(output));
}
