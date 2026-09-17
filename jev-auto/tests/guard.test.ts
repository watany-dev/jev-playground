import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Engine, hash } from '../src/engine';
import { inspect, policy, redact, words } from '../src/policy';
import { decode, evaluationError, type Verdict, type Evaluator } from '../src/evaluator';
import { deny, parseEvent, readBounded, type HookEvent } from '../src/protocol';
import { childEnvironment, codexArgs, hooksConfig } from '../src/config';
import { startBroker } from '../src/broker';

const dirs: string[] = [];
function temp() { const p = mkdtempSync(join(tmpdir(), 'jev-auto-test-')); dirs.push(p); return p; }
afterEach(() => { for (const p of dirs.splice(0)) rmSync(p, { recursive: true, force: true }); });
const safe: Verdict = { safe: true, complete: false, canContinue: true, cost: 0.00003, probabilities: {} };
function event(root: string, name: HookEvent['hook_event_name'], extra = {}): HookEvent {
  return { hook_event_name: name, cwd: root, session_id: 'session', turn_id: 'turn', ...extra };
}
async function setup(evaluate: Evaluator = async () => safe, mode: 'auto' | 'shadow' = 'auto') {
  const root = temp();
  const engine = new Engine({ root, protectedRoot: join(root, 'guard'), mode, evaluate });
  await engine.handle(event(root, 'SessionStart'));
  await engine.handle(event(root, 'UserPromptSubmit', { prompt: 'Implement a local feature and run its tests.' }));
  return { engine, root, state: engine.sessions.get(hash('session'))! };
}
const bash = (root: string, command: string) => event(root, 'PreToolUse', { tool_name: 'Bash', tool_input: { command } });
const patch = (root: string, path = 'src/a.ts') => event(root, 'PreToolUse', { tool_name: 'apply_patch', tool_input: { command: `*** Begin Patch\n*** Add File: ${path}\n+export const a = 1;\n*** End Patch` } });
const denied = (output: any) => output.hookSpecificOutput?.permissionDecision === 'deny';

describe('deterministic guard', () => {
  test.each(['rm -rf src', 'curl https://example.com', 'bun install', 'bun -e "process.exit()"', 'bash', 'python3 x.py', 'git push', 'git -c x=y status', 'cat .env', 'cat ../other', 'cat /etc/passwd', 'rg --pre=sh x', 'rg -f .env', 'cat x; pwd', 'cat $(pwd)', 'pwd\nrm x', 'cat > x', 'cat x | sh'])('rejects %s before Jev', command => {
    const root = temp();
    expect(inspect(bash(root, command), root, join(root, 'guard')).kind).toBe('deny');
  });
  test('rejects symlinks and protected patch targets', () => {
    const root = temp(), outside = temp();
    symlinkSync(outside, join(root, 'link'));
    for (const path of ['link/a', '../a', '.git/config', '.codex/hooks.json', 'guard/src/cli.ts']) {
      expect(inspect(patch(root, path), root, join(root, 'guard')).kind).toBe('deny');
    }
  });
  test('restricts shell parsing while preserving literal quoted arguments', () => {
    expect(words('rg -n "hello world" src')).toEqual(['rg', '-n', 'hello world', 'src']);
    expect(words('rg "unterminated')).toBeNull();
    expect(words('rg "$TOKEN"')).toBeNull();
  });
  test('unknown tools, subagents and interactive commands fail closed', () => {
    const root = temp();
    for (const name of ['mcp__x__send', 'spawn_agent', 'write_stdin', 'unknown']) {
      expect(inspect(event(root, 'PreToolUse', { tool_name: name }), root, root).kind).toBe('deny');
    }
    expect(inspect({ ...bash(root, 'pwd'), tool_input: { command: 'pwd', tty: true } }, root, root).kind).toBe('deny');
  });
});

describe('Jev response contract', () => {
  const answers = () => Object.fromEntries(['destructive', 'secretExposure', 'externalEffect', 'scopeViolation', 'injection', 'necessary', 'complete', 'safeNextStep'].map(k => [k, { type: 'boolean', probability: ['necessary', 'safeNextStep'].includes(k) ? 1 : 0 }]));
  test('accepts typed probabilities and explicit zero cost', () => {
    expect(decode(answers(), '0').safe).toBe(true);
    const a = answers(); a.destructive.probability = 0.02;
    expect(decode(a, 0.001).safe).toBe(false);
  });
  test('reports every failing condition from the smoke-test judgment', () => {
    const values = { destructive: 0.05, secretExposure: 0.24, externalEffect: 0.08,
      scopeViolation: 0.14, injection: 0.12, necessary: 0.86, complete: 0.04, safeNextStep: 0.51 };
    const verdict = decode(Object.fromEntries(Object.entries(values).map(([k, probability]) => [k, { type: 'boolean', probability }])), 0.000033054);
    expect(verdict.safe).toBe(false);
    expect(verdict.reasons).toHaveLength(6);
    expect(verdict.reasons).toContain('secretExposure=0.24 (requires < 0.02)');
    expect(verdict.reasons).toContain('necessary=0.86 (requires >= 0.9)');
  });
  test('classifies failures without exposing provider text', () => {
    expect(evaluationError({ statusCode: 401, message: 'private request body' })).toBe('http-401');
    expect(evaluationError(new DOMException('private data', 'TimeoutError'))).toBe('timeout');
    expect(evaluationError(new Error('invalid-jev-answer'))).toBe('invalid-answer');
    expect(evaluationError(new Error('missing-jev-cost'))).toBe('invalid-cost');
    expect(evaluationError(new Error('private request body'))).toBe('provider-error');
  });
  test.each([undefined, null, '', 'oops', -1, Infinity])('rejects invalid cost %s', cost => expect(() => decode(answers(), cost)).toThrow());
  test('rejects missing and invalid answers', () => {
    expect(() => decode({}, 0)).toThrow();
    const a = answers(); a.injection.probability = NaN;
    expect(() => decode(a, 0)).toThrow();
  });
});

describe('session engine', () => {
  test('allows reviewed local patches and normalizes shell settings', async () => {
    const { root, engine } = await setup();
    expect(denied(await engine.handle(patch(root)))).toBe(false);
    const result: any = await engine.handle(bash(root, '"git" diff --stat'));
    expect(result.hookSpecificOutput.updatedInput.login).toBe(false);
    expect(result.hookSpecificOutput.updatedInput.command).toContain('--no-ext-diff');
    expect(result.hookSpecificOutput.updatedInput.command).toContain('core.fsmonitor=false');
  });
  test('a rejected judgment cannot authorize an edit', async () => {
    const { root, engine } = await setup(async () => ({ ...safe, safe: false }));
    const result: any = await engine.handle(patch(root));
    expect(result.hookSpecificOutput.permissionDecisionReason).toContain('jev-auto: Jev rejected');
  });
  test('errors consume cost reservation and open the circuit', async () => {
    const { root, engine, state } = await setup(async () => { throw new Error('provider error with secret'); });
    const result: any = await engine.handle(patch(root));
    expect(result.hookSpecificOutput.permissionDecisionReason).toContain('evaluation unavailable (provider-error)');
    expect(denied(await engine.handle(patch(root)))).toBe(true);
    expect(state.cost).toBe(2 * policy.requestReserve);
    expect(denied(await engine.handle(bash(root, 'pwd')))).toBe(true);
  });
  test('timeout denies the call', async () => {
    const { root, engine, state } = await setup(() => new Promise(() => {}));
    expect(denied(await engine.handle(patch(root)))).toBe(true);
    expect(state.evaluationError).toBe('timeout');
  }, 6000);
  test('mixed static and Jev denials halt retries without another evaluation', async () => {
    let calls = 0;
    const { root, engine, state } = await setup(async () => { calls++; return { ...safe, safe: false, reasons: ['necessary=0.86 (requires >= 0.9)'] }; });
    const first: any = await engine.handle(bash(root, 'cat README.md'));
    expect(first.hookSpecificOutput.permissionDecisionReason).toContain('necessary=0.86');
    await engine.handle(bash(root, '/bin/cat README.md'));
    const third: any = await engine.handle(bash(root, 'cat ./README.md'));
    expect(third.hookSpecificOutput.permissionDecisionReason).toContain('stop and report the blocker');
    expect(state.stopped).toBe('repeated-tool-denial');
    expect(state.tools).toBe(3);
    await engine.handle(event(root, 'UserPromptSubmit', { prompt: 'Try again' }));
    expect(denied(await engine.handle(bash(root, 'cat README.md')))).toBe(true);
    expect(calls).toBe(2);
    expect((await engine.handle(event(root, 'Stop'))).continue).toBe(false);
  });
  test('three Jev denials stop even though valid responses reset provider errors', async () => {
    const { root, engine, state } = await setup(async () => ({ ...safe, safe: false }));
    for (let i = 0; i < 3; i++) await engine.handle(bash(root, 'cat README.md'));
    expect(state.jevErrors).toBe(0);
    expect(state.stopped).toBe('repeated-tool-denial');
    expect(state.evaluations).toBe(3);
    expect(denied(await engine.handle(bash(root, 'cat README.md')))).toBe(true);
    expect(state.evaluations).toBe(3);
  });
  test('an allowed call resets consecutive denials and shadow judgments do not count', async () => {
    const { root, engine, state } = await setup(async () => ({ ...safe, safe: false }));
    await engine.handle(patch(root));
    await engine.handle(bash(root, 'pwd'));
    expect(state.deniedTools).toBe(0);
    await engine.handle(patch(root));
    expect(state.stopped).toBeNull();
    const shadow = await setup(async () => ({ ...safe, safe: false }), 'shadow');
    for (let i = 0; i < 4; i++) expect(denied(await shadow.engine.handle(patch(shadow.root)))).toBe(false);
    expect(shadow.state.deniedTools).toBe(0);
  });
  test('evaluation errors are correlated and persisted without provider secrets', async () => {
    const root = temp(), audit = temp();
    const engine = new Engine({ root, protectedRoot: root, mode: 'auto', auditDir: audit,
      evaluate: async () => { throw Object.assign(new Error('private request body'), { statusCode: 503 }); } });
    await engine.handle(event(root, 'SessionStart'));
    await engine.handle(event(root, 'UserPromptSubmit', { prompt: 'Read README.md' }));
    await engine.handle({ ...bash(root, 'cat README.md'), tool_use_id: 'tool-1' });
    const raw = readFileSync(join(audit, 'judgments.jsonl'), 'utf8');
    const record = JSON.parse(raw);
    expect(record).toMatchObject({ status: 'error', error: 'http-503', session: hash('session'), turn: hash('turn'), tool: hash('tool-1') });
    expect(record.durationMs).toBeGreaterThanOrEqual(0);
    expect(raw).not.toContain('private request body');
  });
  test('parallel requests cannot exceed the tool budget', async () => {
    const { root, engine, state } = await setup();
    state.tools = policy.maxTools - 1;
    const results = await Promise.all([engine.handle(bash(root, 'pwd')), engine.handle(bash(root, 'pwd'))]);
    expect(results.filter(denied)).toHaveLength(1);
    expect(state.tools).toBe(policy.maxTools);
  });
  test('permission request never auto-escalates', async () => {
    const { root, engine } = await setup();
    const result: any = await engine.handle(event(root, 'PermissionRequest', { tool_name: 'Bash' }));
    expect(result.hookSpecificOutput.decision.behavior).toBe('deny');
  });
  test('compaction and repeated session start preserve budgets', async () => {
    const { root, engine, state } = await setup();
    state.tools = 42;
    for (const name of ['PreCompact', 'PostCompact', 'SessionStart'] as const) await engine.handle(event(root, name));
    expect(state.tools).toBe(42);
  });
  test('Stop never continues without observed progress, and preserves original goal', async () => {
    const { root, engine, state } = await setup();
    expect(await engine.handle(event(root, 'Stop'))).toEqual({});
    await engine.handle(event(root, 'PostToolUse', { tool_response: { exit_code: 0, output: 'test passed' } }));
    const result: any = await engine.handle(event(root, 'Stop', { last_assistant_message: 'More work remains' }));
    expect(result.decision).toBe('block');
    const goal = state.goal;
    await engine.handle(event(root, 'UserPromptSubmit', { prompt: result.reason }));
    expect(state.goal).toBe(goal);
    expect(state.chain).toBe(1);
    expect(await engine.handle(event(root, 'Stop'))).toEqual({});
  });
  test('continuation limit halts, completion stops, shadow does not continue', async () => {
    const { root, engine, state } = await setup();
    state.chain = policy.maxChainContinuations;
    expect((await engine.handle(event(root, 'Stop'))).continue).toBe(false);
    const done = await setup(async () => ({ ...safe, complete: true }));
    done.state.observed = 1;
    expect(await done.engine.handle(event(done.root, 'Stop'))).toEqual({});
    const shadow = await setup(async () => ({ ...safe, safe: false }), 'shadow');
    expect(denied(await shadow.engine.handle(patch(shadow.root)))).toBe(false);
    expect(await shadow.engine.handle(event(shadow.root, 'PermissionRequest'))).toEqual({});
    expect(await shadow.engine.handle(event(shadow.root, 'Stop'))).toEqual({});
  });
  test('interrupt arriving during evaluation cannot permit the call', async () => {
    let release!: (value: Verdict) => void;
    const { root, engine, state } = await setup(() => new Promise(resolve => { release = resolve; }));
    const pending = engine.handle(patch(root));
    await Bun.sleep(5);
    state.stopped = 'Interrupt';
    release(safe);
    expect(denied(await pending)).toBe(true);
  });
  test('time, cost and patch budgets deny operations', async () => {
    for (const mutate of [(s: any) => s.started -= policy.maxMs, (s: any) => s.cost = policy.maxCost, (s: any) => s.changedLines = policy.maxChangedLines]) {
      const { root, engine, state } = await setup(); mutate(state);
      expect(denied(await engine.handle(patch(root)))).toBe(true);
    }
  });
  test('three matching failures halt the session', async () => {
    const { root, engine } = await setup();
    for (let i = 0; i < 3; i++) await engine.handle(event(root, 'PostToolUse', { tool_name: 'Bash', tool_response: { exit_code: 1, output: 'failed test' } }));
    expect(denied(await engine.handle(bash(root, 'pwd')))).toBe(true);
  });
  test('secrets suppressed and audit output omits original commands', async () => {
    const root = temp(), audit = temp();
    const engine = new Engine({ root, protectedRoot: join(root, 'guard'), mode: 'auto', evaluate: async () => safe, auditDir: audit });
    await engine.handle(event(root, 'SessionStart'));
    await engine.handle(event(root, 'UserPromptSubmit', { prompt: 'Fix a file' }));
    await engine.handle(bash(root, 'pwd'));
    const secret = 'vck_' + 'a'.repeat(40);
    const out = await engine.handle(event(root, 'PostToolUse', { tool_response: { output: secret } }));
    expect(out.decision).toBe('block');
    expect(readFileSync(join(audit, 'audit.jsonl'), 'utf8')).not.toContain(secret);
    expect(redact(secret)).toBe('[REDACTED]');
  });
  test('streams audit events and valid Jev judgments to an observer', async () => {
    const root = temp(), records: Array<[string, Record<string, unknown>]> = [];
    const engine = new Engine({
      root, protectedRoot: join(root, 'guard'), mode: 'auto', evaluate: async () => safe,
      onLog: (stream, record) => records.push([stream, record]),
    });
    await engine.handle(event(root, 'SessionStart'));
    await engine.handle(event(root, 'UserPromptSubmit', { prompt: 'Read README.md' }));
    await engine.handle(bash(root, 'cat README.md'));
    expect(records.some(([stream, record]) => stream === 'audit' && record.event === 'SessionStart')).toBe(true);
    expect(records.some(([stream, record]) => stream === 'judgment' && record.purpose === 'tool')).toBe(true);
  });
  test('audit failure latches fail-closed', async () => {
    const root = temp();
    const engine = new Engine({ root, protectedRoot: root, mode: 'auto', evaluate: async () => safe, auditDir: join(root, 'missing') });
    expect((await engine.handle(event(root, 'SessionStart'))).continue).toBe(false);
    expect(denied(await engine.handle(bash(root, 'pwd')))).toBe(true);
  });
  test('judgment log failure halts instead of being classified as a provider error', async () => {
    const root = temp(), audit = temp();
    const engine = new Engine({ root, protectedRoot: root, mode: 'auto', auditDir: audit, evaluate: async () => safe });
    await engine.handle(event(root, 'SessionStart'));
    await engine.handle(event(root, 'UserPromptSubmit', { prompt: 'Read README.md' }));
    mkdirSync(join(audit, 'judgments.jsonl'));
    const result: any = await engine.handle(bash(root, 'cat README.md'));
    expect(result.hookSpecificOutput.permissionDecisionReason).toContain('internal failure');
    const state = engine.sessions.get(hash('session'))!;
    expect(state.jevErrors).toBe(0);
    expect(state.evaluationError).toBeNull();
    expect(denied(await engine.handle(bash(root, 'pwd')))).toBe(true);
  });
});

describe('protocol and launcher', () => {
  test('Stop failure stops rather than accidentally continuing', () => {
    expect(deny('Stop', 'failure')).toEqual({ continue: false, stopReason: 'failure' });
    expect(deny('PreToolUse', 'failure')).not.toHaveProperty('continue');
    expect(() => parseEvent({ hook_event_name: 'Fake' })).toThrow();
  });
  test('bounded input rejects oversize', async () => {
    await expect(readBounded(new Response('12345').body, 4)).rejects.toThrow();
  });
  test('bounded input rejects a writer that never closes stdin', async () => {
    await expect(readBounded(new ReadableStream({ start() {} }), 100, 10)).rejects.toThrow('input-timeout');
  });
  test('child never inherits Gateway, cloud or other API credentials', () => {
    const env = childEnvironment({ HOME: '/home/test', PATH: '/bin', AI_GATEWAY_API_KEY: 'secret', AWS_SECRET_ACCESS_KEY: 'secret', OPENAI_API_KEY: 'secret' }, '/tmp/x.sock');
    expect(Object.keys(env).sort()).toEqual(['HOME', 'JEV_AUTO_SOCKET', 'PATH']);
    expect(codexArgs('/work', 'test')).not.toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(codexArgs('/work', 'test')).toContain('tui.alternate_screen="never"');
  });
  test('all hook commands quote absolute paths and use synchronous handlers', () => {
    const cfg = hooksConfig('/tmp/bun path', "/tmp/it's a file.ts");
    expect(Object.keys(cfg.hooks)).toHaveLength(12);
    expect(cfg.hooks.PreToolUse[0].hooks[0].command).toContain("'\\''");
    expect(cfg.hooks.PreToolUse[0].hooks[0]).not.toHaveProperty('async');
  });
  test('real hook process denies malformed input and missing broker', async () => {
    for (const input of ['{bad json', JSON.stringify(event(temp(), 'PreToolUse'))]) {
      const child = Bun.spawn([process.execPath, resolve('src/cli.ts'), 'hook', 'PreToolUse'], { stdin: new Response(input), stdout: 'pipe', stderr: 'pipe', env: {} });
      const output = await new Response(child.stdout).json();
      expect(await child.exited).toBe(0);
      expect(denied(output)).toBe(true);
    }
  });
  test('real hook process and Unix broker exercise the lifecycle without a paid API', async () => {
    const root = temp(), audit = temp();
    const engine = new Engine({ root, protectedRoot: join(root, 'guard'), mode: 'auto', evaluate: async () => safe, auditDir: audit });
    const socket = join(audit, 'broker.sock');
    const server = startBroker(socket, engine);
    const invoke = async (e: HookEvent) => {
      const child = Bun.spawn([process.execPath, resolve('src/cli.ts'), 'hook', e.hook_event_name], {
        stdin: new Response(JSON.stringify(e)), stdout: 'pipe', stderr: 'pipe', env: { JEV_AUTO_SOCKET: socket },
      });
      const result = await new Response(child.stdout).json();
      expect(await child.exited).toBe(0);
      return result as any;
    };
    try {
      expect((await invoke(event(root, 'SessionStart'))).hookSpecificOutput).toBeDefined();
      await invoke(event(root, 'UserPromptSubmit', { prompt: 'Fix a local feature' }));
      expect(denied(await invoke(patch(root)))).toBe(false);
      expect(denied(await invoke(bash(root, 'rm -rf src')))).toBe(true);
      await invoke(event(root, 'PostToolUse', { tool_response: { exit_code: 0, output: 'checks pass' } }));
      expect((await invoke(event(root, 'Stop'))).decision).toBe('block');
      await invoke(event(root, 'Interrupt'));
      expect(denied(await invoke(patch(root)))).toBe(true);
      expect(readFileSync(join(audit, 'audit.jsonl'), 'utf8')).toContain('PreToolUse');
    } finally { server.stop(true); }
    expect(denied(await invoke(patch(root)))).toBe(true);
  });
  test('changed runtime integrity prevents dispatch', async () => {
    const root = temp(); let valid = true;
    const engine = new Engine({ root, protectedRoot: root, mode: 'auto', evaluate: async () => safe, integrity: () => valid });
    await engine.handle(event(root, 'SessionStart'));
    valid = false;
    expect(denied(await engine.handle(bash(root, 'pwd')))).toBe(true);
  });
  test('init is idempotent and preserves unrelated hook definitions', async () => {
    const { main } = await import('../src/cli');
    const root = temp();
    await main(['init', root]);
    const path = join(root, '.codex/hooks.json');
    const first = readFileSync(path, 'utf8');
    await main(['init', root]);
    expect(readFileSync(path, 'utf8')).toBe(first);
    writeFileSync(path, '{"hooks": {}}');
    await expect(main(['init', root])).rejects.toThrow('Existing hooks');
    expect(readFileSync(path, 'utf8')).toBe('{"hooks": {}}');
  });
  test('init refuses a config directory redirected outside the target', async () => {
    const { main } = await import('../src/cli');
    const root = temp(), outside = temp();
    symlinkSync(outside, join(root, '.codex'));
    await expect(main(['init', root])).rejects.toThrow('symlink');
  });
});
