import { lstatSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import type { HookEvent } from './protocol';

export const policy = Object.freeze({
  version: 1,
  maxMs: 30 * 60_000,
  maxTools: 300,
  maxEvaluations: 500,
  maxContinuations: 20,
  maxChainContinuations: 8,
  maxChangedFiles: 50,
  maxChangedLines: 3000,
  maxCost: 0.05,
  // Reserve before a request, settle only when valid Gateway cost metadata arrives.
  requestReserve: 0.001,
  timeoutMs: 4000,
  maxFailures: 3,
  maxJevErrors: 2,
  maxRisk: 0.02,
  minProgress: 0.9,
});

const secretPattern = /(?:vck_[A-Za-z0-9]{16,}|sk-[A-Za-z0-9_-]{16,}|AKIA[A-Z0-9]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:api[_-]?key|password|secret|token)\s*[=:]\s*["']?[^\s"']{8,})/gi;
export function hasSecret(text: string): boolean { secretPattern.lastIndex = 0; return secretPattern.test(text); }
export function redact(text: string): string { secretPattern.lastIndex = 0; return text.replace(secretPattern, '[REDACTED]'); }
export function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}
export function safePath(root: string, cwd: string, path: string): boolean {
  if (!path || path.includes('\0') || /(^|[\/\\])(?:\.git|\.codex|\.agents|\.env(?:\.[^/]*)?|\.ssh|\.aws|\.npmrc|\.netrc|\.bashrc|\.profile|session-state)([\/\\]|$)/i.test(path)) return false;
  const full = resolve(cwd, path);
  if (!within(root, full)) return false;
  let current = root;
  for (const part of relative(root, full).split(sep).filter(Boolean)) {
    current = resolve(current, part);
    try { if (lstatSync(current).isSymbolicLink()) return false; }
    catch (error: any) { if (error.code !== 'ENOENT') return false; }
  }
  return true;
}

// Intentionally a small shell grammar: a single command with literal arguments.
// Expansion, redirection, pipelines, escapes and multiline commands are rejected.
export function words(command: string): string[] | null {
  if (!command || /[\n\r\0;&|<>`$\\*?{}()~]/.test(command)) return null;
  const result: string[] = [];
  let word = '', quote = '', active = false;
  for (const ch of command) {
    if (quote) { if (ch === quote) quote = ''; else word += ch; active = true; }
    else if (ch === "'" || ch === '"') { quote = ch; active = true; }
    else if (/\s/.test(ch)) { if (active) { result.push(word); word = ''; active = false; } }
    else { word += ch; active = true; }
  }
  if (quote) return null;
  if (active) result.push(word);
  return result;
}

export type StaticResult = { kind: 'deny' | 'local' | 'review'; rule: string; paths?: string[]; lines?: number };
export function inspect(e: HookEvent, root: string, protectedRoot: string): StaticResult {
  const reject = (rule: string): StaticResult => ({ kind: 'deny', rule });
  if (e.permission_mode === 'bypassPermissions') return reject('bypass-mode');
  if (!safePath(root, root, e.cwd)) return reject('cwd-out-of-scope');
  const input = e.tool_input ?? {};
  if (hasSecret(JSON.stringify(input))) return reject('secret-in-input');
  if (input.sandbox_permissions === 'require_escalated' || input.tty === true || input.login === true) return reject('elevation-or-interactive-shell');
  if (typeof input.workdir === 'string' && !safePath(root, e.cwd, input.workdir)) return reject('workdir-out-of-scope');
  const cwd = typeof input.workdir === 'string' ? resolve(e.cwd, input.workdir) : e.cwd;
  if (e.tool_name === 'update_plan') return { kind: 'local', rule: 'planning-only' };
  if (e.tool_name === 'apply_patch') {
    const patch = input.command;
    if (typeof patch !== 'string' || !patch.startsWith('*** Begin Patch\n') || !patch.trimEnd().endsWith('*** End Patch')) return reject('invalid-patch');
    const paths: string[] = [];
    for (const line of patch.split('\n')) {
      if (line.startsWith('*** Delete File:') || line.startsWith('*** Move to:')) return reject('delete-or-move');
      const match = /^\*\*\* (?:Add|Update) File: (.+)$/.exec(line);
      if (match) {
        const p = resolve(cwd, match[1]);
        if (!safePath(root, cwd, match[1]) || within(protectedRoot, p)) return reject('protected-path');
        paths.push(p);
      }
    }
    if (!paths.length) return reject('empty-patch');
    return { kind: 'review', rule: 'workspace-patch', paths, lines: patch.split('\n').filter(l => /^[+-]/.test(l)).length };
  }
  if (e.tool_name !== 'Bash') return reject('unsupported-tool');
  const args = typeof input.command === 'string' ? words(input.command) : null;
  if (!args?.length) return reject('unsupported-shell-syntax');
  const [bin, ...rest] = args;
  if (!['pwd', 'ls', 'cat', 'head', 'tail', 'wc', 'rg', 'git', 'bun'].includes(bin)) return reject('command-not-allowed');
  if (rest.some(a => /(?:https?:|ftp:|file:|^\/|^\.\.(?:\/|$)|\.\.[\/\\]|^[A-Za-z_][A-Za-z0-9_]*=)/.test(a))) return reject('external-target');
  for (const arg of rest) {
    if (!arg.startsWith('-') && !safePath(root, cwd, arg)) return reject('protected-path');
  }
  if (rest.some(a => /^--(?:pre|hostname-bin|follow|config|exec|upload|output|output-file|files-from|file|glob-file|ignore-file)(?:=|$)/.test(a) || ['-L', '-f', '--no-ignore', '--hidden'].includes(a))) return reject('unsafe-option');
  if (bin === 'pwd') return rest.length ? reject('pwd-options') : { kind: 'local', rule: 'pwd' };
  if (bin === 'git') {
    // Fixed read-only invocations. Command is normalized by the hook before execution.
    if (!['status', 'diff', 'log'].includes(rest[0]) || rest.slice(1).some(a => !['--short', '--stat', '--name-only', '--oneline', '-5'].includes(a))) return reject('git-operation');
  }
  if (bin === 'bun' && !(rest.length === 1 && rest[0] === 'test') && !(rest.length === 2 && rest[0] === 'run' && ['test', 'check', 'build', 'lint', 'typecheck'].includes(rest[1]))) return reject('bun-operation');
  if (['ls', 'cat', 'head', 'tail', 'wc', 'rg'].includes(bin) && rest.some(a => a.startsWith('-') && !/^(-[nqlcisvwh]+|--files|--count|--line-number|--max-count=\d+|--max-depth=\d+|--)$/i.test(a))) return reject('unrecognized-option');
  return { kind: 'review', rule: bin === 'bun' ? 'workspace-check' : 'workspace-read' };
}

export function canonicalRoot(path: string): string { return realpathSync(path); }
