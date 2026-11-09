import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const state = await mkdtemp(join(tmpdir(), 'worksync-smoke-'));
const settingsPath = join(state, 'settings.json');
const cli = (args) =>
  execFileSync(process.execPath, [join(root, 'dist/cli.js'), ...args], {
    cwd: root,
    stdio: 'pipe',
    windowsHide: true,
    env: { ...process.env, WORKSYNC_SETTINGS: settingsPath },
  });
cli(['init']);
const initialSettings = await readFile(settingsPath, 'utf8');
assert.throws(() => cli(['init']));
assert.equal(await readFile(settingsPath, 'utf8'), initialSettings);
assert.throws(() => cli(['integration'])); // Real integration requires an interactive user, even for read-only tests.
const repository = join(state, 'repo');
await mkdir(repository);
const git = (args) =>
  execFileSync('git', args, {
    cwd: repository,
    windowsHide: true,
    stdio: 'pipe',
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: '2026-11-03T10:00:00+09:00',
      GIT_COMMITTER_DATE: '2026-11-03T10:00:00+09:00',
    },
  });
git(['init', '-b', 'main']);
git(['config', 'user.name', 'Demo']);
git(['config', 'user.email', 'demo@example.com']);
await writeFile(join(repository, 'work.txt'), 'demo evidence');
git(['add', 'work.txt']);
git(['commit', '-m', '데모 업무 근거']);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, 'dist/index.js'), '--demo'],
  cwd: repository,
  env: { ...process.env, WORKSYNC_DEMO_STATE: join(state, 'db') },
  stderr: 'pipe',
});
let errors = '';
transport.stderr?.on('data', (d) => (errors += d.toString()));
const client = new Client({ name: 'worksync-smoke', version: '0.1.0' });
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const data = JSON.parse(r.content[0].text);
  return { error: !!r.isError, data };
};
try {
  await client.connect(transport);
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 6);
  assert.deepEqual(tools.tools.map((t) => t.name).sort(), [
    'collect_git_evidence',
    'find_existing_tasks',
    'get_my_settings',
    'preview_worklog',
    'save_worklog',
    'verify_worklog',
  ]);
  assert.equal((await call('get_my_settings')).data.mode, 'mock');
  const evidence = await call('collect_git_evidence', {
    startDate: '2026-11-02',
    endDate: '2026-11-08',
  });
  assert.equal(evidence.error, false, JSON.stringify(evidence.data));
  assert.equal(evidence.data.commits.length, 1);
  const existing = await call('find_existing_tasks');
  assert.equal(existing.error, false, JSON.stringify(existing.data));
  const worklog = JSON.parse(await readFile(join(root, 'examples/sample-worklog.json'), 'utf8'));
  const result = await call('preview_worklog', worklog);
  assert.equal(result.error, false);
  const p = result.data;
  assert.equal(p.items[0].action, 'create');
  const dry = await call('save_worklog', { previewId: p.previewId, digest: p.digest });
  assert.equal(dry.data.writes, 0);
  const blocked = await call('save_worklog', {
    previewId: p.previewId,
    digest: p.digest,
    dryRun: false,
  });
  assert.equal(blocked.error, true);
  assert.equal(blocked.data.code, 'APPROVAL_REQUIRED');
  const unknown = await call('verify_worklog', { operationId: '0'.repeat(64) });
  assert.equal(unknown.error, true);
  console.log(
    JSON.stringify(
      {
        transport: 'stdio',
        sdk: 'v2',
        tools: tools.tools.map((t) => t.name),
        preview: p.summary,
        gitCommits: evidence.data.commits.length,
        dryRun: dry.data.writes,
        unapprovedWrite: 'blocked',
        stderr: errors.trim() || null,
      },
      null,
      2,
    ),
  );
} finally {
  await client.close();
  await rm(state, { recursive: true, force: true });
}
