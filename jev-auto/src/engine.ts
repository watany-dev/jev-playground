import { createHash } from 'node:crypto';
import { appendFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { context, deny, type HookEvent, type Output } from './protocol';
import { inspect, hasSecret, redact, policy, words } from './policy';
import type { Evaluator, Verdict } from './evaluator';
import { shellQuote } from './config';

export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export type Session = {
  started: number; goal: string; tools: number; evaluations: number; cost: number;
  continuations: number; chain: number; jevErrors: number; stopped: string | null;
  changedPaths: string[]; changedLines: number; errors: Record<string, number>;
  recent: string[]; observed: number; lastContinuedAt: number; continuationPrompt: string;
};
export type EngineOptions = {
  root: string; protectedRoot: string; evaluate: Evaluator; mode: 'shadow' | 'auto';
  auditDir?: string; now?: () => number; integrity?: () => boolean;
};

export class Engine {
  sessions = new Map<string, Session>();
  private queue: Promise<unknown> = Promise.resolve();
  private fatal = false;
  readonly now: () => number;
  constructor(readonly options: EngineOptions) { this.now = options.now ?? Date.now; }

  // The broker owns state and serializes all events, including parallel tools.
  handle(event: HookEvent): Promise<Output> {
    const run = this.queue.then(() => this.transaction(event));
    this.queue = run.catch(() => {});
    return run;
  }

  private async transaction(e: HookEvent): Promise<Output> {
    if (this.fatal) return deny(e.hook_event_name, 'jev-auto: audit/state unavailable');
    try {
      if (this.options.integrity && !this.options.integrity()) {
        this.fatal = true;
        return deny(e.hook_event_name, 'jev-auto: runtime integrity changed');
      }
      const output = await this.decide(e);
      const id = hash(e.session_id);
      const s = this.sessions.get(id);
      if (this.options.auditDir) {
        // No raw goal, command, output, secret or provider error in the audit log.
        appendFileSync(join(this.options.auditDir, 'audit.jsonl'), JSON.stringify({
          at: this.now(), session: id, event: e.hook_event_name,
          turn: hash(String(e.turn_id ?? '')), tool: hash(String(e.tool_use_id ?? '')),
          input: hash(JSON.stringify(e)), decision: output,
          policy: policy.version, mode: this.options.mode,
          counts: s && { tools: s.tools, evaluations: s.evaluations, cost: s.cost, continuations: s.continuations },
        }) + '\n', { mode: 0o600 });
        if (s) {
          // Snapshot contains only redacted context; never used as authority on restart.
          const path = join(this.options.auditDir, `${id}.json`);
          writeFileSync(`${path}.tmp`, JSON.stringify(s), { mode: 0o600 });
          renameSync(`${path}.tmp`, path);
        }
      }
      return output;
    } catch {
      this.fatal = true;
      return deny(e.hook_event_name, 'jev-auto: internal failure; session halted');
    }
  }

  private limit(s: Session): string | null {
    if (s.stopped) return s.stopped;
    if (this.now() - s.started >= policy.maxMs) return 'time-budget';
    if (s.tools >= policy.maxTools) return 'tool-budget';
    if (s.evaluations >= policy.maxEvaluations) return 'evaluation-budget';
    if (s.cost + policy.requestReserve > policy.maxCost) return 'cost-budget';
    if (s.changedPaths.length > policy.maxChangedFiles || s.changedLines > policy.maxChangedLines) return 'patch-budget';
    if (s.jevErrors >= policy.maxJevErrors) return 'jev-circuit-open';
    return null;
  }

  private async judge(s: Session, data: Record<string, unknown>, purpose: 'tool' | 'stop'): Promise<Verdict | null> {
    s.evaluations++;
    s.cost += policy.requestReserve;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const v = await Promise.race([
        this.options.evaluate(data, purpose),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), policy.timeoutMs); }),
      ]);
      if (s.stopped) return null;
      if (!Number.isFinite(v.cost) || v.cost < 0) throw new Error('invalid-cost');
      s.cost += v.cost - policy.requestReserve;
      s.jevErrors = 0;
      if (this.options.auditDir) appendFileSync(join(this.options.auditDir, 'judgments.jsonl'), JSON.stringify({
        at: this.now(), input: hash(JSON.stringify(data)), purpose, probabilities: v.probabilities, cost: v.cost,
      }) + '\n', { mode: 0o600 });
      if (s.cost >= policy.maxCost) { s.stopped = 'cost-budget'; return null; }
      return v;
    } catch {
      // Keep the reservation: a failed/timeout request may still have been billed.
      s.jevErrors++;
      return null;
    } finally { if (timer) clearTimeout(timer); }
  }

  private async decide(e: HookEvent): Promise<Output> {
    const name = e.hook_event_name;
    const id = hash(e.session_id);
    let s = this.sessions.get(id);
    if (name === 'SessionStart' && !s) {
      s = { started: this.now(), goal: '', tools: 0, evaluations: 0, cost: 0, continuations: 0, chain: 0,
        jevErrors: 0, stopped: null, changedPaths: [], changedLines: 0, errors: {}, recent: [], observed: 0,
        lastContinuedAt: 0, continuationPrompt: '' };
      this.sessions.set(id, s);
    }
    if (!s) return deny(name, 'jev-auto: no active session; start with jev-auto run');
    if (['Interrupt', 'SessionEnd'].includes(name)) {
      s.stopped = name === 'Interrupt' ? 'user-interrupt' : 'session-ended';
      return {};
    }
    if (e.permission_mode === 'bypassPermissions') { s.stopped = 'bypass-mode'; return deny(name, 'jev-auto: bypass mode forbidden'); }
    const limit = this.limit(s);
    if (limit) { s.stopped = limit; return deny(name, `jev-auto: ${limit}`); }
    if (name === 'UserPromptSubmit') {
      if (!e.prompt || e.prompt.length > 8000 || hasSecret(e.prompt)) return deny(name, 'jev-auto: empty/oversized prompt or secret detected');
      if (e.prompt !== s.continuationPrompt) {
        s.goal = redact(e.prompt).slice(0, 8000);
        s.chain = 0;
        s.continuationPrompt = '';
      }
      return context(name, 'Jev Auto: keep the user goal unchanged; single noninteractive shell commands only. Network, elevation, deletion, subagents and external tools are disabled. Prefer apply_patch for edits.');
    }
    if (['SessionStart', 'PreCompact', 'PostCompact'].includes(name)) {
      return context(name, `Jev Auto ${this.options.mode}; budgets persist across compaction/resume. Tools ${s.tools}/${policy.maxTools}; continuations ${s.continuations}/${policy.maxContinuations}.`);
    }
    if (name === 'SubagentStart' || name === 'SubagentStop') return deny(name, 'jev-auto: subagents are disabled in this release');
    if (name === 'PermissionRequest') {
      // Shadow leaves the ordinary approval prompt; auto never escalates.
      return this.options.mode === 'shadow' ? {} : deny(name, 'jev-auto: elevation and external permissions are disabled');
    }
    if (!s.goal) return deny(name, 'jev-auto: no user goal captured');
    if (name === 'PreToolUse') {
      const result = inspect(e, this.options.root, this.options.protectedRoot);
      if (result.kind === 'deny') return deny(name, `jev-auto: ${result.rule}`);
      s.tools++;
      if (result.paths) {
        const next = [...new Set([...s.changedPaths, ...result.paths])];
        if (next.length > policy.maxChangedFiles || s.changedLines + (result.lines ?? 0) > policy.maxChangedLines) {
          s.stopped = 'patch-budget';
          return deny(name, 'jev-auto: patch-budget');
        }
      }
      let output: Output = {};
      if (result.kind === 'review') {
        const verdict = await this.judge(s, { goal: s.goal, workspace: this.options.root,
          tool: e.tool_name, input: e.tool_input, recent: s.recent, rule: result.rule }, 'tool');
        if (this.options.mode === 'auto' && !verdict?.safe) return deny(name, 'jev-auto: Jev rejected or evaluation unavailable');
        if (this.options.mode === 'shadow') output = { systemMessage: `jev-auto shadow: ${verdict?.safe ? 'would allow' : 'would deny'}` };
      }
      if (result.paths) {
        s.changedPaths = [...new Set([...s.changedPaths, ...result.paths])];
        s.changedLines += result.lines ?? 0;
      }
      if (e.tool_name === 'Bash') {
        let command = String(e.tool_input?.command);
        const args = words(command)!;
        if (args[0] === 'git') command = 'git --no-pager --no-optional-locks -c core.fsmonitor=false -c log.showSignature=false -c diff.external= -c diff.trustExitCode=false ' + args.slice(1).map(shellQuote).join(' ') + (args[1] === 'diff' ? ' --no-ext-diff --no-textconv' : '');
        output.hookSpecificOutput = { hookEventName: name, permissionDecision: 'allow',
          updatedInput: { ...e.tool_input, command, login: false, tty: false } };
      }
      return output;
    }
    if (name === 'PostToolUse') {
      const raw = JSON.stringify(e.tool_response ?? null);
      if (hasSecret(raw)) { s.stopped = 'secret-in-output'; return deny(name, 'jev-auto: sensitive output suppressed; review required'); }
      const summary = redact(raw).slice(0, 2000);
      s.recent = [...s.recent.slice(-3), summary];
      s.observed++;
      const value: any = e.tool_response;
      const exit = value?.exit_code ?? value?.exitCode;
      const failed = value?.isError === true || (typeof exit === 'number' && exit !== 0) || /(?:exited with code|exit code:|Process exited with code) [1-9]\d*/i.test(raw);
      if (failed) {
        const fingerprint = hash(`${e.tool_name}:${summary.replace(/\d+/g, '#')}`);
        s.errors[fingerprint] = (s.errors[fingerprint] ?? 0) + 1;
        if (s.errors[fingerprint] >= policy.maxFailures) {
          s.stopped = 'repeated-failure';
          return deny(name, 'jev-auto: repeated failure; stop and report the blocker');
        }
      }
      return {};
    }
    if (name === 'Stop') {
      if (this.options.mode === 'shadow') return {};
      if (s.continuations >= policy.maxContinuations || s.chain >= policy.maxChainContinuations) {
        s.stopped = 'continuation-budget'; return deny(name, 'jev-auto: continuation-budget');
      }
      if (s.observed <= s.lastContinuedAt) return {};
      if (hasSecret(e.last_assistant_message ?? '')) { s.stopped = 'secret-in-summary'; return deny(name, 'jev-auto: sensitive summary'); }
      const verdict = await this.judge(s, { goal: s.goal, recent: s.recent,
        lastAssistantMessage: redact(e.last_assistant_message ?? '').slice(0, 4000),
        remainingContinuations: policy.maxContinuations - s.continuations }, 'stop');
      if (!verdict) return deny(name, 'jev-auto: completion evaluation unavailable');
      if (verdict.complete || !verdict.canContinue) return {};
      s.continuations++; s.chain++; s.lastContinuedAt = s.observed;
      // Fixed text, never promote model/tool output into a new user instruction.
      s.continuationPrompt = `Jev Auto continuation ${s.continuations}: Continue only the original user goal. Use the latest observed results to perform one remaining step and verify it. Do not expand scope. If blocked, report the blocker and stop.`;
      return { decision: 'block', reason: s.continuationPrompt };
    }
    return deny(name, 'jev-auto: unsupported event');
  }
}
