import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { hook } from './hook';
import { Engine, hash } from './engine';
import { createEvaluator } from './evaluator';
import { childEnvironment, codexArgs, hooksConfig } from './config';
import { startBroker } from './broker';
import { policy, within } from './policy';
class UsageError extends Error {}

export async function main(args = Bun.argv.slice(2)) {
  const [command, ...rest] = args;
  if (command === 'hook') return hook(rest[0]);
  if (!command || command === '--help') {
    console.log('jev-auto init <workspace>\njev-auto run <workspace> [--shadow] [goal]\njev-auto hook <event>   (Codex internal)');
    return;
  }
  if (!['init', 'run'].includes(command) || !rest[0]) throw new UsageError('Usage: jev-auto init|run <workspace>');
  const root = realpathSync(resolve(rest[0]));
  const cli = realpathSync(import.meta.path);
  const bun = realpathSync(process.execPath);
  const config = hooksConfig(bun, cli);
  const configDir = join(root, '.codex');
  const configPath = join(configDir, 'hooks.json');
  for (const path of [configDir, configPath]) {
    try { if (lstatSync(path).isSymbolicLink()) throw new UsageError('Hook config must not be a symlink.'); }
    catch (error: any) { if (error.code !== 'ENOENT') throw error; }
  }
  const content = JSON.stringify(config, null, 2) + '\n';
  if (command === 'init') {
    if (existsSync(configPath)) {
      if (readFileSync(configPath, 'utf8') !== content) throw new UsageError('Existing hooks.json differs; preserve it and use a separate workspace for this initial release.');
      console.log(`Already configured: ${configPath}`); return;
    }
    mkdirSync(configDir, { recursive: true });
    writeFileSync(configPath, content, { flag: 'wx', mode: 0o600 });
    console.log(`Created ${configPath}\nRun Codex in this workspace and trust these definitions with /hooks before using Auto Mode.`);
    return;
  }
  if (!existsSync(configPath) || readFileSync(configPath, 'utf8') !== content) throw new UsageError('Run jev-auto init for this runtime path first, then review /hooks in Codex.');
  if (rest.length > 3 || (rest.length === 3 && rest[1] !== '--shadow')) throw new UsageError('Pass the goal as one quoted argument.');
  const mode = rest[1] === '--shadow' ? 'shadow' : 'auto';
  const prompt = rest[mode === 'shadow' ? 2 : 1] ?? '';
  if (prompt.startsWith('-')) throw new UsageError('Goal must not be a CLI flag.');
  const key = Bun.env.AI_GATEWAY_API_KEY;
  if (!key) throw new UsageError('Set AI_GATEWAY_API_KEY in the launcher environment.');
  const codex = Bun.which('codex');
  if (!codex) throw new UsageError('codex is not installed.');
  // Do not inherit credential-bearing variables into the Codex child.
  delete process.env.AI_GATEWAY_API_KEY;
  const runtime = mkdtempSync(join(tmpdir(), 'jev-auto-'));
  chmodSync(runtime, 0o700);
  if (within(root, runtime)) throw new UsageError('The runtime/audit directory must be outside the workspace. Use a dedicated project directory.');
  for (const name of ['audit.jsonl', 'judgments.jsonl']) {
    writeFileSync(join(runtime, name), '', { flag: 'wx', mode: 0o600 });
  }
  const socket = join(runtime, 'broker.sock');
  const rootDir = resolve(dirname(cli), '..');
  const watched = ['cli.ts', 'hook.ts', 'broker.ts', 'config.ts', 'protocol.ts', 'policy.ts', 'engine.ts', 'evaluator.ts'].map(file => join(dirname(cli), file));
  const hashes = watched.map(path => hash(readFileSync(path, 'utf8')));
  const integrity = () => readFileSync(configPath, 'utf8') === content && watched.every((p, i) => hash(readFileSync(p, 'utf8')) === hashes[i]);
  const engine = new Engine({
    root, protectedRoot: rootDir, mode, evaluate: createEvaluator(key), auditDir: runtime, integrity,
  });
  const server = startBroker(socket, engine);
  console.error(`jev-auto ${mode}; audit: ${runtime}\nSandbox enabled. Ensure /hooks lists every jev-auto hook as trusted. Ctrl-C stops the run.`);
  const child = Bun.spawn([codex, ...codexArgs(root, prompt)], {
    env: childEnvironment(process.env, socket), stdin: 'inherit', stdout: 'inherit', stderr: 'inherit', cwd: root,
  });
  const stop = () => { for (const s of engine.sessions.values()) s.stopped = 'user-interrupt'; child.kill('SIGINT'); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  // A hook launch failure is not guaranteed fail-closed by Codex. Detect missing
  // registration and terminate; this watchdog is not an atomic execution gate.
  const startupWatchdog = setTimeout(() => {
    if (!engine.sessions.size) { console.error('No SessionStart received: hooks may be untrusted or disabled. Stopping Codex.'); child.kill(); }
  }, 15_000);
  const deadline = setInterval(() => {
    if ([...engine.sessions.values()].some(s => Date.now() - s.started >= policy.maxMs)) {
      console.error('jev-auto: wall-clock budget exceeded; stopping Codex.');
      child.kill();
    }
  }, 1000);
  try { process.exitCode = await child.exited; }
  finally { clearTimeout(startupWatchdog); clearInterval(deadline); process.off('SIGINT', stop); process.off('SIGTERM', stop); server.stop(true); }
}

if (import.meta.main) main().catch((error) => {
  // Never emit provider errors (which can contain request bodies or credentials).
  console.error(error instanceof UsageError ? error.message : 'jev-auto failed. Check workspace hooks, Bun/Codex availability and AI_GATEWAY_API_KEY. Use --help for syntax.');
  process.exitCode = 1;
});
