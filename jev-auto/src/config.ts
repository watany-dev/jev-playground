import { events } from './protocol';
export const shellQuote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
export function hooksConfig(bun: string, cli: string) {
  return {
    description: 'jev-auto managed by local launcher; review and trust with /hooks',
    hooks: Object.fromEntries(events.map(event => [event, [{
      matcher: '*', hooks: [{ type: 'command',
        command: `${shellQuote(bun)} ${shellQuote(cli)} hook ${event}`,
        timeout: ['Interrupt', 'SessionEnd'].includes(event) ? 3 : 12,
      }],
    }]])),
  };
}

export function codexArgs(root: string, prompt: string): string[] {
  return ['--cd', root, '--sandbox', 'workspace-write', '--ask-for-approval', 'on-request',
    '--strict-config',
    '-c', 'approvals_reviewer="user"',
    '-c', 'sandbox_workspace_write.network_access=false',
    '-c', 'allow_login_shell=false',
    '-c', 'web_search="disabled"',
    '-c', 'features.hooks=true',
    '-c', 'features.apps=false',
    '-c', 'features.browser_use=false',
    '-c', 'features.computer_use=false',
    '-c', 'features.multi_agent=false',
    '-c', 'features.multi_agent_v2=false',
    '-c', 'tui.alternate_screen="never"',
    '-c', 'shell_environment_policy.inherit="all"',
    '-c', 'shell_environment_policy.include_only=["PATH","HOME","TMPDIR","LANG","TERM"]',
    ...(prompt ? [prompt] : []),
  ];
}

export function childEnvironment(source: Record<string, string | undefined>, socket: string): Record<string, string> {
  const env: Record<string, string> = { JEV_AUTO_SOCKET: socket };
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'TERM', 'COLORTERM', 'CODEX_HOME']) {
    if (source[key]) env[key] = source[key]!;
  }
  return env;
}
