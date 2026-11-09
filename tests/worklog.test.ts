import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixture } from './helpers.js';
import { approveInteractively, requirePreview } from '../src/services/approval.js';
import { hash } from '../src/services/validation.js';
import { Store } from '../src/services/store.js';
import { WorklogService } from '../src/services/worklog.js';
import { LocalIdentityProvider } from '../src/config/settings.js';
import { metadata } from '../src/notion/task-mapper.js';
import { relationOf } from '../src/notion/types.js';
describe('미리보기, 승인, 저장 및 검증', () => {
  let f: ReturnType<typeof fixture>;
  beforeEach(() => {
    f = fixture();
  });
  afterEach(() => f.close());
  const approve = (f: ReturnType<typeof fixture>, p: { previewId: string; digest: string }) =>
    approveInteractively(f.store, p.previewId, p.digest, '승인 ' + p.digest.slice(0, 12), true);
  async function create() {
    const p = await f.service.preview({ tasks: [f.task] });
    approve(f, p);
    await f.service.save(p.previewId, p.digest, false);
    return p;
  }
  it('새 업무를 한국어로 미리보기하고 기본 Dry Run은 쓰기를 하지 않는다', async () => {
    const p = await f.service.preview({ tasks: [f.task] });
    expect(p.summary['신규 생성']).toBe(1);
    const r = await f.service.save(p.previewId, p.digest);
    expect(r).toMatchObject({ dryRun: true, writes: 0 });
    expect(f.api.writes).toBe(0);
  });
  it('approved true 같은 외부 값 없이 별도 승인 기록이 필수', async () => {
    const p = await f.service.preview({ tasks: [f.task] });
    await expect(f.service.save(p.previewId, p.digest, false)).rejects.toMatchObject({
      code: 'APPROVAL_REQUIRED',
    });
    expect(f.api.writes).toBe(0);
  });
  it('다른 digest, 내용 변조, 만료 및 비대화형 승인 차단', async () => {
    const p = await f.service.preview({ tasks: [f.task] });
    expect(() => requirePreview(f.store, p.previewId, '0'.repeat(64))).toThrow();
    expect(() =>
      approveInteractively(f.store, p.previewId, p.digest, '승인 ' + p.digest.slice(0, 12), false),
    ).toThrow();
    expect(() => approveInteractively(f.store, p.previewId, p.digest, '승인', true)).toThrow();
    f.store.db.prepare('UPDATE previews SET data=? WHERE id=?').run('{}', p.previewId);
    expect(() => requirePreview(f.store, p.previewId, p.digest)).toThrow();
    const q = await f.service.preview({ tasks: [f.task] });
    f.store.db.prepare('UPDATE previews SET expires=0 WHERE id=?').run(q.previewId);
    expect(() => requirePreview(f.store, q.previewId, q.digest)).toThrow();
  });
  it('승인 후 생성하고 실제 날짜·부모 양방향 관계·담당자·팀을 재조회 검증', async () => {
    const p = await create();
    expect(f.api.writes).toBe(1);
    const result = await f.service.verify(p.items[0].operationId);
    expect(result.ok).toBe(true);
    expect(result.timelineUi).toBe('미검증');
    expect(result.checks).toMatchObject({
      reciprocalParentLink: true,
      시작일: true,
      종료일: true,
      참여자: true,
      팀: true,
      uniqueEvidence: true,
    });
    expect(relationOf((await f.api.getPage(result.pageId)).properties['상위 항목'])).toEqual([
      f.task.parentId,
    ]);
  });
  it('동일 저장 요청 재시도는 동일 페이지 반환; 새 미리보기는 중복 제외', async () => {
    const p = await create();
    await f.service.save(p.previewId, p.digest, false);
    expect(f.api.writes).toBe(1);
    const q = await f.service.preview({ tasks: [f.task] });
    expect(q.items[0].action).toBe('duplicate');
  });
  it('동일 Git 커밋은 제목을 바꿔도 새 업무로 생성하지 않음', async () => {
    const t = {
      ...f.task,
      evidence: [
        {
          kind: 'git',
          sourceId: 'https://github.com/example/repo',
          id: 'a'.repeat(40),
          note: '실제 커밋을 나타내는 Mock 근거',
        },
      ],
    };
    const p = await f.service.preview({ tasks: [t] });
    approve(f, p);
    await f.service.save(p.previewId, p.digest, false);
    const q = await f.service.preview({ tasks: [{ ...t, title: '다른 제목' }] });
    expect(q.items[0].action).toBe('duplicate');
    expect(f.api.writes).toBe(1);
  });
  it('설정 변경으로 승인 재사용 차단', async () => {
    const p = await f.service.preview({ tasks: [f.task] });
    approve(f, p);
    const s = structuredClone(f.s);
    s.team = '02. 콘텐츠';
    const other = new WorklogService(
      new LocalIdentityProvider(s),
      f.api,
      f.store,
      true,
      'test-mock',
    );
    await expect(other.save(p.previewId, p.digest, false)).rejects.toThrow('설정');
    expect(f.api.writes).toBe(0);
  });
  it('동일 배치의 근거 재사용과 허용되지 않은 부모, 불명확한 날짜·상태 차단', async () => {
    const p = await f.service.preview({ tasks: [f.task, f.task] });
    expect(p.items[1].action).toBe('needs_confirmation');
    const q = await f.service.preview({
      tasks: [{ ...f.task, startDate: null, dateBasis: 'unknown' }],
    });
    expect(q.items[0].action).toBe('needs_confirmation');
    const r = await f.service.preview({ tasks: [{ ...f.task, statusConfirmed: false }] });
    expect(r.items[0].action).toBe('needs_confirmation');
    const x = await f.service.preview({
      tasks: [{ ...f.task, parentId: '99999999-9999-4999-8999-999999999999' }],
    });
    expect(x.items[0].action).toBe('needs_confirmation');
    expect(() => approve(f, x)).toThrow();
  });
  it('알 수 없는 상태 옵션과 하위 항목 속성을 임의 생성하지 않음', async () => {
    const p = await f.service.preview({ tasks: [{ ...f.task, status: '새 옵션' }] });
    expect(p.items[0].action).toBe('needs_confirmation');
    f.api.schema.properties['하위 항목'].relation = {};
    const q = await f.service.preview({ tasks: [f.task] });
    expect(q.items[0].reason).toContain('관계');
    expect(f.api.writes).toBe(0);
  });
  it('제목만 같으면 자동 병합하지 않음', async () => {
    await create();
    const t = { ...f.task, evidence: [{ ...f.task.evidence[0], id: 'unrelated' }] };
    const p = await f.service.preview({ tasks: [t] });
    expect(p.items[0].action).toBe('needs_confirmation');
    expect(p.items[0].reason).toContain('제목');
  });
  it('추가 근거는 본인 기존 업무 수정 후보; 기존 날짜 변경은 새 승인 필요', async () => {
    const p = await create();
    const pageId = (await f.service.verify(p.items[0].operationId)).pageId;
    const t = {
      ...f.task,
      evidence: [...f.task.evidence, { ...f.task.evidence[0], id: 'doc-2' }],
      endDate: '2026-11-05',
    };
    const q = await f.service.preview({ tasks: [t] });
    expect(q.items[0].reason).toContain('기존 일정');
    const r = await f.service.preview({ tasks: [{ ...t, allowDateOverwrite: true }] });
    expect(r.items[0]).toMatchObject({ action: 'update', targetId: pageId });
    approve(f, r);
    await f.service.save(r.previewId, r.digest, false);
    expect(f.api.pages.size).toBe(2);
    expect(f.api.writes).toBe(2);
    expect(metadata(await f.api.getPage(pageId), f.s)?.keys).toHaveLength(2);
  });
  it('다른 사람 업무를 수정하지 않음', async () => {
    const p = await create();
    const pageId = (await f.service.verify(p.items[0].operationId)).pageId;
    f.api.pages.get(pageId)!.properties['참여자'].people = [
      { id: '99999999-9999-4999-8999-999999999999' },
    ];
    const q = await f.service.preview({
      tasks: [{ ...f.task, updatePageId: pageId, description: '변경' }],
    });
    expect(q.items[0].action).toBe('needs_confirmation');
  });
  it('승인 후 다른 사용자가 수정하면 새 미리보기 필요', async () => {
    const p = await create();
    const pageId = (await f.service.verify(p.items[0].operationId)).pageId;
    const q = await f.service.preview({
      tasks: [{ ...f.task, updatePageId: pageId, description: '후속 수정' }],
    });
    approve(f, q);
    f.api.pages.get(pageId)!.properties['설명'].rich_text = [{ text: { content: '외부 수정' } }];
    await expect(f.service.save(q.previewId, q.digest, false)).rejects.toMatchObject({
      code: 'STALE_PREVIEW',
    });
    expect(f.api.writes).toBe(1);
  });
  it('기본 쓰기 비활성화는 승인을 받아도 실제 저장을 차단', async () => {
    const p = await f.service.preview({ tasks: [f.task] });
    approve(f, p);
    const readOnly = new WorklogService(
      new LocalIdentityProvider(f.s),
      f.api,
      f.store,
      false,
      'test-mock',
    );
    await expect(readOnly.save(p.previewId, p.digest, false)).rejects.toMatchObject({
      code: 'WRITE_DISABLED',
    });
  });
  it('응답 유실 후 자동 재생성하지 않으며 원격 마커로 복구 가능', async () => {
    const original = f.api.create.bind(f.api);
    vi.spyOn(f.api, 'create').mockImplementationOnce(async (ds, props) => {
      await original(ds, props);
      throw new Error('network timeout');
    });
    const p = await f.service.preview({ tasks: [f.task] });
    approve(f, p);
    await expect(f.service.save(p.previewId, p.digest, false)).rejects.toMatchObject({
      code: 'SAVE_UNCERTAIN',
    });
    expect(f.api.writes).toBe(1);
    await f.service.save(p.previewId, p.digest, false);
    expect(f.api.writes).toBe(1);
  });
  it('불명확한 오류로 근거 예약이 남으면 새 내용으로도 중복 생성 불가', async () => {
    vi.spyOn(f.api, 'create').mockRejectedValue(new Error('timeout'));
    const p = await f.service.preview({ tasks: [f.task] });
    approve(f, p);
    await expect(f.service.save(p.previewId, p.digest, false)).rejects.toThrow();
    await expect(f.service.save(p.previewId, p.digest, false)).rejects.toMatchObject({
      code: 'SAVE_UNCERTAIN',
    });
    const q = await f.service.preview({ tasks: [{ ...f.task, title: '다른 제목' }] });
    expect(q.items[0].action).toBe('needs_confirmation');
    expect(f.api.create).toHaveBeenCalledTimes(1);
  });
  it('승인 만료 후에도 원격 쓰기 없이 응답 유실 작업을 재조회·복구', async () => {
    const original = f.api.create.bind(f.api);
    vi.spyOn(f.api, 'create').mockImplementationOnce(async (ds, props) => {
      await original(ds, props);
      throw new Error('lost response');
    });
    const p = await f.service.preview({ tasks: [f.task] });
    approve(f, p);
    await expect(f.service.save(p.previewId, p.digest, false)).rejects.toMatchObject({
      code: 'SAVE_UNCERTAIN',
    });
    f.store.db.prepare('UPDATE previews SET expires=0 WHERE id=?').run(p.previewId);
    const result = await f.service.verify(p.items[0].operationId);
    expect(result.ok).toBe(true);
    expect(f.api.writes).toBe(1);
    expect(f.store.operation(p.items[0].operationId)?.state).toBe('verified');
  });
  it('배치 일부 실패는 완료 결과를 반환하고 재시도해도 기존 성공을 중복 생성하지 않음', async () => {
    const second = {
      ...f.task,
      title: '다른 기능',
      evidence: [{ ...f.task.evidence[0], id: 'second-document' }],
    };
    const original = f.api.create.bind(f.api);
    vi.spyOn(f.api, 'create')
      .mockImplementationOnce(original)
      .mockRejectedValueOnce(new Error('timeout'));
    const p = await f.service.preview({ tasks: [f.task, second] });
    approve(f, p);
    await expect(f.service.save(p.previewId, p.digest, false)).rejects.toMatchObject({
      code: 'SAVE_UNCERTAIN',
      details: { completed: [{ ok: true }] },
    });
    await expect(f.service.save(p.previewId, p.digest, false)).rejects.toMatchObject({
      code: 'SAVE_UNCERTAIN',
    });
    expect(f.api.writes).toBe(1);
  });
  it('문서 식별자의 일부 문자열 일치만으로 기존 업무를 수정하지 않음', async () => {
    const p = await f.service.preview({
      tasks: [{ ...f.task, evidence: [{ ...f.task.evidence[0], id: 'doc-10' }] }],
    });
    approve(f, p);
    await f.service.save(p.previewId, p.digest, false);
    const q = await f.service.preview({ tasks: [{ ...f.task, title: '독립 업무' }] });
    expect(q.items[0].action).toBe('needs_confirmation');
  });
  it('진행률 percent 속성에는 Notion의 0~1 값을 저장', async () => {
    f.api.schema.properties['진행률 (%)'].number = { format: 'percent' };
    const p = await f.service.preview({ tasks: [{ ...f.task, progress: 75 }] });
    expect(p.items[0].properties!['진행률 (%)']).toEqual({ number: 0.75 });
    approve(f, p);
    await f.service.save(p.previewId, p.digest, false);
    expect((await f.service.verify(p.items[0].operationId)).ok).toBe(true);
  });
  it('승인·저장 이력은 SQLite 재연결 후 유지', async () => {
    const p = await create();
    const other = new Store(f.dir);
    try {
      expect(other.preview(p.previewId)?.approved).toBe(1);
      expect(other.operation(p.items[0].operationId)?.state).toBe('verified');
    } finally {
      other.close();
    }
  });
  it('다른 프로세스 저장 잠금은 동시 쓰기를 차단', async () => {
    const other = new Store(f.dir);
    let unblock!: () => void;
    try {
      const pending = f.store.exclusive(
        async () =>
          new Promise<void>((r) => {
            unblock = r;
          }),
      );
      await expect(other.exclusive(async () => 1)).rejects.toMatchObject({ code: 'SAVE_LOCKED' });
      unblock();
      await pending;
    } finally {
      other.close();
    }
  });
  it('하위 항목 관계와 날짜 오류를 검증 실패로 반환', async () => {
    const p = await create(),
      r = await f.service.verify(p.items[0].operationId);
    f.api.pages.get(r.pageId)!.properties['종료일'].date = { start: '2026-01-01' };
    f.api.pages.get(f.task.parentId)!.properties['하위 항목'].relation = [];
    const v = await f.service.verify(p.items[0].operationId);
    expect(v.ok).toBe(false);
    expect(v.checks['종료일']).toBe(false);
    expect(v.checks.reciprocalParentLink).toBe(false);
  });
  it('조회 응답에서 날짜 속성이 사라져도 검증 실패로 반환', async () => {
    const p = await create(),
      r = await f.service.verify(p.items[0].operationId);
    delete f.api.pages.get(r.pageId)!.properties['종료일'];
    const v = await f.service.verify(p.items[0].operationId);
    expect(v.ok).toBe(false);
    expect(v.checks['종료일']).toBe(false);
  });
});
