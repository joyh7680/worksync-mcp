import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { demoSettings } from '../src/notion/mock.js';
import { gitInput, collectGitEvidence } from '../src/git/git-reader.js';
import { sensitivePath } from '../src/git/commit-parser.js';
const run = promisify(execFile);
let dir: string;
const git = async (args: string[], env: NodeJS.ProcessEnv = {}) =>
  (await run('git', args, { cwd: dir, env: { ...process.env, ...env }, windowsHide: true })).stdout;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'worksync-git-'));
  await git(['init', '-b', 'main']);
  await git(['config', 'user.name', '민수']);
  await git(['config', 'user.email', 'me@example.com']);
  await mkdir(join(dir, 'src'));
  const commit = async (
    file: string,
    text: string,
    date: string,
    author = '민수 <me@example.com>',
    authored = date,
  ) => {
    await writeFile(join(dir, file), text);
    await git(['add', '--', file]);
    await git(['commit', '-m', '작업 ' + file, '--author=' + author], {
      GIT_AUTHOR_DATE: authored,
      GIT_COMMITTER_DATE: date,
    });
  };
  await commit('src/a.ts', 'const a=1;', '2026-11-01T23:59:59+09:00');
  await commit('src/a.ts', 'const a=2;', '2026-11-02T00:00:00+09:00');
  await commit('note.md', 'content', '2026-11-03T12:00:00+09:00', '다른 사람 <other@example.com>');
  await commit(
    'src/b.ts',
    'const b=1;',
    '2026-11-08T23:59:59+09:00',
    '민수 <me@example.com>',
    '2026-10-31T10:00:00+09:00',
  );
  await commit('.env', 'NOTION_TOKEN=secret_private_token', '2026-11-04T12:00:00+09:00');
  await commit('src/c.ts', 'const c=3;', '2026-11-09T00:00:00+09:00');
}, 30_000);
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});
const collect = (extra: object = {}) => {
  const s = demoSettings(join(dir, 'state'));
  s.git = {
    defaultRepository: dir,
    allowedRepositories: [dir],
    defaultBranch: 'main',
    author: 'me@example.com',
  };
  return collectGitEvidence(
    gitInput.parse({ startDate: '2026-11-02', endDate: '2026-11-08', ...extra }),
    s,
  );
};
describe('실제 임시 Git 저장소 읽기', () => {
  it('환경별 .env 및 자격 증명 파일·디렉터리를 제외', () => {
    for (const path of [
      '.env',
      '.env.local',
      'config/.env.production',
      'credentials.json',
      'config/secrets.yaml',
      '.aws/credentials',
      '.npmrc',
      'private.key',
      'node_modules/lib/file.ts',
    ])
      expect(sensitivePath(path), path).toBe(true);
    expect(sensitivePath('src/editor.ts')).toBe(false);
  });
  it('작성자와 서울 날짜 경계 필터 및 민감 파일 제외', async () => {
    const r = await collect();
    expect(r.commits).toHaveLength(2);
    expect(r.commits.every((c) => c.authorEmail === 'me@example.com')).toBe(true);
    expect(r.commits.flatMap((c) => c.files)).not.toContain('.env');
    expect(JSON.stringify(r)).not.toContain('secret_private_token');
    expect(r.commits.every((c) => c.url === null)).toBe(true);
  });
  it('이름으로 필터; 하위 폴더 실제 변경 파일과 diff 조회', async () => {
    const r = await collect({ author: '민수', subfolder: 'src', includeDiff: true });
    expect(r.commits).toHaveLength(2);
    expect(r.commits.every((c) => c.files.every((f) => f.startsWith('src/')))).toBe(true);
    expect(Object.values(r.commits[0].diffs)[0]).toContain('const');
    expect(new Set(r.commits.map((c) => c.hash)).size).toBe(r.commits.length);
  });
  it('작성자 날짜와 커밋 날짜를 분리', async () => {
    const r = await collect({ dateField: 'authored', subfolder: 'src' });
    expect(r.commits).toHaveLength(1);
    expect(r.dateField).toBe('authored');
    const c = await collect({ subfolder: 'src' });
    expect(c.commits.some((c) => c.authoredAt !== c.committedAt)).toBe(true);
  });
  it('저장소 외부 경로 및 옵션 주입과 반쪽 기간 거부', async () => {
    await expect(collect({ subfolder: '..' })).rejects.toThrow('밖');
    await expect(collect({ branch: '--all' })).rejects.toThrow();
    const s = demoSettings(join(dir, 'state'));
    s.git.allowedRepositories = [];
    await expect(collectGitEvidence(gitInput.parse({ repositoryPath: dir }), s)).rejects.toThrow(
      '허용',
    );
  });
  it('실제 merge commit은 제외하고 미확인 원격 URL을 생성하지 않음', async () => {
    await git(['checkout', '-b', 'feature']);
    await writeFile(join(dir, 'merge-note.md'), 'side work');
    await git(['add', 'merge-note.md']);
    await git(['commit', '-m', '동료 작업', '--author=동료 <other@example.com>'], {
      GIT_AUTHOR_DATE: '2026-11-05T10:00:00+09:00',
      GIT_COMMITTER_DATE: '2026-11-05T10:00:00+09:00',
    });
    await git(['checkout', 'main']);
    await git(['merge', '--no-ff', 'feature', '-m', 'merge should be excluded'], {
      GIT_AUTHOR_DATE: '2026-11-06T10:00:00+09:00',
      GIT_COMMITTER_DATE: '2026-11-06T10:00:00+09:00',
    });
    await git(['remote', 'add', 'origin', 'https://github.com/example/not-pushed.git']);
    const r = await collect();
    expect(r.commits).toHaveLength(2);
    expect(r.commits.every((c) => c.url === null)).toBe(true);
    expect(r.commits.some((c) => c.subject.includes('merge should'))).toBe(false);
  });
});
