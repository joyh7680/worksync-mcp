import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { demoSettings, MockNotion } from '../src/notion/mock.js';
import { LocalIdentityProvider } from '../src/config/settings.js';
import { Store } from '../src/services/store.js';
import { WorklogService } from '../src/services/worklog.js';
import { worklogSchema } from '../src/schemas/worklog.js';
export function fixture(write = true) {
  const dir = mkdtempSync(join(tmpdir(), 'worksync-unit-'));
  const s = demoSettings(dir),
    api = new MockNotion(s),
    store = new Store(dir);
  const service = new WorklogService(new LocalIdentityProvider(s), api, store, write, 'test-mock');
  const task = worklogSchema.parse({
    title: '학습 화면 개선',
    description: '사용자가 확인한 학습 화면 안내 개선',
    startDate: '2026-11-02',
    endDate: '2026-11-04',
    dateBasis: 'user_confirmed',
    status: '완료',
    statusConfirmed: true,
    statusEvidence: '사용자 확인',
    evidence: [{ kind: 'document', sourceId: 'test-docs', id: 'doc-1', note: '작성 결과 확인' }],
    parentId: s.notion.defaultParentId,
  });
  return {
    s,
    api,
    store,
    service,
    task,
    dir,
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
