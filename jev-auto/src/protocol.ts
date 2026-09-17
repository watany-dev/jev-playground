export const events = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PreCompact', 'PostCompact', 'SubagentStart', 'SubagentStop', 'Stop', 'Interrupt', 'SessionEnd'] as const;
export type EventName = typeof events[number];
export type HookEvent = {
  hook_event_name: EventName;
  session_id: string;
  cwd: string;
  turn_id?: string;
  tool_name?: string;
  tool_use_id?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: unknown;
  prompt?: string;
  source?: string;
  permission_mode?: string;
  stop_hook_active?: boolean;
  last_assistant_message?: string | null;
};
export type Output = Record<string, unknown>;
export const MAX_INPUT = 128 * 1024;

export function parseEvent(value: unknown, expected?: string): HookEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid-event');
  const e = value as HookEvent;
  if (!events.includes(e.hook_event_name) || (expected && expected !== e.hook_event_name) ||
      typeof e.session_id !== 'string' || !e.session_id || e.session_id.length > 256 ||
      typeof e.cwd !== 'string' || !e.cwd.startsWith('/')) throw new Error('invalid-event');
  if (e.tool_input !== undefined && (!e.tool_input || typeof e.tool_input !== 'object' || Array.isArray(e.tool_input))) throw new Error('invalid-input');
  if (e.prompt !== undefined && typeof e.prompt !== 'string') throw new Error('invalid-prompt');
  if (e.last_assistant_message != null && typeof e.last_assistant_message !== 'string') throw new Error('invalid-message');
  return e;
}

export function deny(event: string, reason: string): Output {
  if (event === 'PreToolUse') return { hookSpecificOutput: { hookEventName: event, permissionDecision: 'deny', permissionDecisionReason: reason } };
  if (event === 'PermissionRequest') return { hookSpecificOutput: { hookEventName: event, decision: { behavior: 'deny', message: reason } } };
  if (event === 'UserPromptSubmit' || event === 'PostToolUse') return { decision: 'block', reason };
  if (event === 'Interrupt' || event === 'SessionEnd' || event === 'SubagentStart') return { systemMessage: reason };
  return { continue: false, stopReason: reason };
}

export function context(event: string, message: string): Output {
  return { hookSpecificOutput: { hookEventName: event, additionalContext: message } };
}

export async function readBounded(stream: ReadableStream<Uint8Array> | null, max = MAX_INPUT, timeoutMs = 1000): Promise<string> {
  if (!stream) throw new Error('missing-input');
  const reader = stream.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('input-timeout')), timeoutMs); });
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      size += value.length;
      if (size > max) throw new Error('input-too-large');
      chunks.push(value);
    }
  } finally { clearTimeout(timer!); void reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks).toString('utf8');
}
