import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { projectRoot } from '../config/settings.js';
import type { Settings, IdentityProvider } from '../config/settings.js';
import type { NotionGateway, Page } from '../notion/types.js';
import { relationOf, textOf } from '../notion/types.js';
import type { Worklog } from '../schemas/worklog.js';
import { evidenceKey, previewSchema } from '../schemas/worklog.js';
import { hash, sameId, WorkSyncError, safeError } from './validation.js';
import { checkConnection } from '../notion/schema.js';
import { subitemProperties } from '../notion/subitems.js';
import { ensureDates } from '../notion/timeline.js';
import { mapTask, metadata } from '../notion/task-mapper.js';
import { classify, scopedKey, owns } from './duplicate-check.js';
import { requirePreview } from './approval.js';
import { Store } from './store.js';

export interface PreviewItem {
  task: Worklog;
  action: 'create' | 'update' | 'duplicate' | 'needs_confirmation';
  label: string;
  reason: string;
  operationId: string;
  targetId?: string;
  baseline?: string;
  before?: Record<string, unknown>;
  properties?: Record<string, unknown>;
}
export interface PreviewData {
  userId: string;
  settingsHash: string;
  mode: string;
  createdAt: string;
  items: PreviewItem[];
  warnings: string[];
  targetView?: unknown;
}
const labels = {
  create: '신규 생성',
  update: '기존 업무 업데이트',
  duplicate: '중복 제외',
  needs_confirmation: '확인 필요',
};
export const snapshot = (page: Page) =>
  hash({
    properties: page.properties,
    archived: page.archived ?? false,
    in_trash: page.in_trash ?? false,
    parent: page.parent,
  });
export class WorklogService {
  constructor(
    readonly identity: IdentityProvider,
    readonly api: NotionGateway,
    readonly store: Store,
    readonly allowWrite = false,
    readonly mode = 'live',
  ) {}
  get settings() {
    return this.identity.getSettings();
  }
  private assertParent(s: Settings, id: string) {
    if (!s.notion.allowedParentIds.some((p) => sameId(p, id)))
      throw new WorkSyncError('허용되지 않은 부모 업무입니다.');
  }
  private inSource(page: Page, s: Settings) {
    if (
      page.archived ||
      page.in_trash ||
      !sameId(page.parent.data_source_id, s.notion.dataSourceId)
    )
      throw new WorkSyncError('업무가 올바른 데이터 소스에 없거나 휴지통에 있습니다.');
  }
  async find(parentId = this.settings.notion.defaultParentId, search?: string) {
    const s = this.settings;
    this.assertParent(s, parentId);
    const conn = await checkConnection(this.api, s);
    this.inSource(await this.api.getPage(parentId), s);
    const pages = await this.api.query(s.notion.dataSourceId, conn.relations.parent.name, parentId);
    for (const p of pages) {
      this.inSource(p, s);
      if (!relationOf(p.properties[conn.relations.parent.name]).some((id) => sameId(id, parentId)))
        throw new WorkSyncError('직접 부모 관계가 조회 조건과 다릅니다.');
    }
    return {
      conn,
      pages: search
        ? pages.filter((p) =>
            [
              textOf(p.properties[s.notion.properties.title]),
              textOf(p.properties[s.notion.properties.description]),
            ].some((v) => v.toLowerCase().includes(search.toLowerCase())),
          )
        : pages,
    };
  }
  private async checkOtherParents(task: Worklog, s: Settings) {
    for (const parent of s.notion.allowedParentIds) {
      if (sameId(parent, task.parentId)) continue;
      const { pages } = await this.find(parent);
      if (
        pages.some((p) =>
          task.evidence.some(
            (e) =>
              metadata(p, s)?.keys.includes(evidenceKey(e)) ||
              textOf(p.properties[s.notion.properties.description]).includes(e.id),
          ),
        )
      )
        throw new WorkSyncError(
          '다른 허용 부모 업무에 동일/유사 근거가 있습니다. 위치를 확인한 뒤 진행하세요.',
        );
    }
  }
  async preview(input: unknown) {
    const { tasks } = previewSchema.parse(input);
    const s = this.settings;
    const data: PreviewData = {
      userId: s.user.id,
      settingsHash: hash(s),
      mode: this.mode,
      createdAt: new Date().toISOString(),
      items: [],
      warnings: [
        '날짜는 확인된 작업 관찰 기간입니다. 실제 착수·완료 기간과 다를 수 있습니다.',
        'Notion 보기 필터와 오른쪽 타임라인 막대 UI 표시는 API 검증 대상이 아닙니다.',
        '로컬 설정과 승인은 같은 OS 계정 내 강한 인증 격리를 제공하지 않습니다.',
      ],
    };
    const cache = new Map<string, Awaited<ReturnType<WorklogService['find']>>>();
    const batchKeys = new Set<string>();
    const batchTargets = new Set<string>();
    for (const t of tasks) {
      const operationId = hash([s.user.id, s.notion.dataSourceId, t.parentId, t]);
      let item: PreviewItem = {
        task: t,
        operationId,
        action: 'needs_confirmation',
        label: labels.needs_confirmation,
        reason: '',
      };
      try {
        if (t.evidence.some((e) => batchKeys.has(evidenceKey(e))))
          throw new WorkSyncError(
            '이번 미리보기의 다른 업무와 동일 근거가 겹칩니다. 기능별 업무를 합치거나 근거를 구분하세요.',
          );
        t.evidence.forEach((e) => batchKeys.add(evidenceKey(e)));
        if (!cache.has(t.parentId)) cache.set(t.parentId, await this.find(t.parentId));
        const { conn, pages } = cache.get(t.parentId)!;
        await this.checkOtherParents(t, s);
        if (conn.targetView)
          data.targetView = {
            id: conn.targetView.id,
            name: conn.targetView.name,
            filter: conn.targetView.filter,
            configuration: conn.targetView.configuration,
          };
        if (!t.statusConfirmed)
          throw new WorkSyncError('완료/진행 상태 근거를 사용자와 확인하세요.');
        const c = classify(t, pages, s, this.store);
        ensureDates(t, c.existing, s);
        if (c.existing && batchTargets.has(c.existing.id))
          throw new WorkSyncError(
            '하나의 기존 업무를 여러 번 수정할 수 없습니다. 하나로 합치세요.',
          );
        if (c.existing) batchTargets.add(c.existing.id);
        const mapped = mapTask(t, s, conn.ds, operationId, c.existing);
        item = {
          ...item,
          action: c.action,
          label: labels[c.action],
          reason: c.reason,
          targetId: c.existing?.id,
          baseline: c.existing ? snapshot(c.existing) : undefined,
          before: c.existing?.properties,
          properties: mapped.properties,
        };
      } catch (error) {
        item.reason = safeError(error).message;
      }
      data.items.push(item);
    }
    const id = randomUUID(),
      digest = hash(data),
      expires = Date.now() + 30 * 60_000;
    this.store.putPreview(id, digest, data, expires);
    return {
      previewId: id,
      digest,
      expiresAt: new Date(expires).toISOString(),
      ...data,
      summary: Object.fromEntries(
        Object.entries(labels).map(([action, label]) => [
          label,
          data.items.filter((i) => i.action === action).length,
        ]),
      ),
      approvalCommand: `node "${resolve(projectRoot, 'dist/cli.js').replaceAll('\\', '/')}" approve ${id} ${digest}`,
      approvalSettingsPath: process.env.WORKSYNC_SETTINGS ?? resolve(projectRoot, 'settings.json'),
      dryRunDefault: true,
    };
  }
  async save(id: string, digest: string, dryRun = true) {
    const p = requirePreview(this.store, id, digest, !dryRun);
    const data = JSON.parse(p.data) as PreviewData,
      s = this.settings;
    if (data.settingsHash !== hash(s) || data.userId !== s.user.id || data.mode !== this.mode)
      throw new WorkSyncError('사용자·설정·모드가 미리보기 이후 변경되었습니다.');
    if (data.items.some((i) => i.action === 'needs_confirmation'))
      throw new WorkSyncError('확인 필요 항목을 해결해야 저장할 수 있습니다.');
    if (dryRun)
      return {
        dryRun: true,
        writes: 0,
        approved: !!p.approved,
        items: data.items.map((i) => ({
          title: i.task.title,
          action: i.action,
          targetId: i.targetId,
          properties: i.properties,
        })),
        message:
          '쓰기 없이 저장할 속성을 시뮬레이션했습니다. 실제 저장에는 별도 승인과 WORKSYNC_ALLOW_WRITE=true가 필요합니다.',
      };
    if (!this.allowWrite)
      throw new WorkSyncError(
        '기본 Dry Run입니다. WORKSYNC_ALLOW_WRITE=true를 별도 설정하세요.',
        'WRITE_DISABLED',
      );
    return this.store.exclusive(async () => {
      // Preflight all tasks before any remote mutation. Notion itself has no compare-and-swap transaction.
      for (const item of data.items) {
        if (item.action === 'duplicate') continue;
        const prior = this.store.operation(item.operationId);
        if (prior) continue; // Durable receipt or uncertain attempt is handled below; never issue a blind retry.
        const { conn, pages } = await this.find(item.task.parentId);
        await this.checkOtherParents(item.task, s);
        if (item.targetId) {
          const target = pages.find((p) => sameId(p.id, item.targetId));
          if (!target || snapshot(target) !== item.baseline)
            throw new WorkSyncError(
              '기존 업무가 변경되었습니다. 새 미리보기와 승인이 필요합니다.',
              'STALE_PREVIEW',
            );
        }
        const current = classify(item.task, pages, s, this.store);
        if (
          current.action !== item.action ||
          !sameOptional(current.existing?.id, item.targetId) ||
          (current.existing && snapshot(current.existing) !== item.baseline)
        )
          throw new WorkSyncError(
            '기존 업무가 변경되었습니다. 새 미리보기와 승인이 필요합니다.',
            'STALE_PREVIEW',
          );
        ensureDates(item.task, current.existing, s);
        if (
          hash(mapTask(item.task, s, conn.ds, item.operationId, current.existing).properties) !==
          hash(item.properties)
        )
          throw new WorkSyncError('Notion 매핑이 변경되었습니다. 다시 승인하세요.');
      }
      const results = [];
      try {
        for (const item of data.items) {
          if (item.action === 'duplicate') {
            results.push({ title: item.task.title, action: 'duplicate', pageId: item.targetId });
            continue;
          }
          const prior = this.store.operation(item.operationId);
          if (prior) {
            let pageId = prior.page_id;
            if (!pageId) {
              const { pages } = await this.find(item.task.parentId);
              const hits = pages.filter((p) =>
                metadata(p, s)?.operations.includes(item.operationId),
              );
              if (hits.length === 1 && owns(hits[0], s)) pageId = hits[0].id;
            }
            if (!pageId)
              throw new WorkSyncError(
                '이전 저장 결과가 불명확합니다. 중복 방지를 위해 재생성을 차단했습니다. Notion과 등록 이력을 수동 점검하세요.',
                'SAVE_UNCERTAIN',
              );
            const verified = await this.verifyExpected(pageId, item, s);
            if (!verified.ok)
              throw new WorkSyncError(
                '이전 저장 페이지가 승인 내용과 다릅니다. 재확인이 필요합니다.',
              );
            this.record(item, s, pageId);
            results.push({ ...verified, idempotent: true });
            continue;
          }
          // Reserve every source before the first outbound write, including ambiguous failures.
          this.store.db.exec('BEGIN IMMEDIATE');
          try {
            for (const e of item.task.evidence)
              this.store.claim(
                scopedKey(evidenceKey(e), s),
                item.operationId,
                item.targetId ?? 'pending:' + item.operationId,
                s.user.id,
              );
            this.store.putOperation(
              item.operationId,
              s.user.id,
              'pending',
              item.targetId ?? null,
              item,
            );
            this.store.db.exec('COMMIT');
          } catch (e) {
            this.store.db.exec('ROLLBACK');
            throw e;
          }
          let page: Page;
          try {
            page =
              item.action === 'create'
                ? await this.api.create(s.notion.dataSourceId, item.properties!)
                : await this.api.update(item.targetId!, item.properties!);
          } catch (error) {
            this.store.putOperation(
              item.operationId,
              s.user.id,
              'uncertain',
              item.targetId ?? null,
              item,
            );
            throw new WorkSyncError(
              'Notion 저장 실패 또는 응답 유실. 무조건 재시도하지 않습니다. 이력을 확인하세요.',
              'SAVE_UNCERTAIN',
            );
          }
          this.store.putOperation(item.operationId, s.user.id, 'written', page.id, item);
          const verified = await this.verifyExpected(page.id, item, s);
          if (!verified.ok)
            throw new WorkSyncError(
              '쓰기 후 일부 속성이 일치하지 않습니다. 자동 재생성하지 않고 검증 결과 확인이 필요합니다.',
              'VERIFY_FAILED',
            );
          this.record(item, s, page.id);
          results.push(verified);
        }
      } catch (error) {
        if (error instanceof WorkSyncError) {
          error.details = {
            completed: results,
            message:
              '일부 저장이 완료되었을 수 있습니다. preview 항목의 operationId로 verify_worklog 또는 history를 조회하세요.',
          };
          throw error;
        }
        throw new WorkSyncError(
          '일부 처리 후 조회 오류가 발생했습니다. 등록 이력을 확인하세요.',
          'PARTIAL_SAVE',
          { completed: results },
        );
      }
      return { dryRun: false, results, timelineUi: '미검증: Notion 화면에서 별도로 확인하세요.' };
    });
  }
  private record(item: PreviewItem, s: Settings, pageId: string) {
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      this.store.putOperation(item.operationId, s.user.id, 'verified', pageId, item);
      for (const e of item.task.evidence)
        this.store.claim(scopedKey(evidenceKey(e), s), item.operationId, pageId, s.user.id);
      this.store.db.exec('COMMIT');
    } catch (e) {
      this.store.db.exec('ROLLBACK');
      throw e;
    }
  }
  async verify(operationId: string) {
    const op = this.store.operation(operationId),
      s = this.settings;
    if (!op || op.user_id !== s.user.id)
      throw new WorkSyncError('본인의 저장 작업 이력이 없습니다.');
    const item = JSON.parse(op.data) as PreviewItem;
    this.assertParent(s, item.task.parentId);
    let pageId = op.page_id;
    if (!pageId) {
      const { pages } = await this.find(item.task.parentId);
      const hits = pages.filter(
        (p) => metadata(p, s)?.operations.includes(operationId) && owns(p, s),
      );
      if (hits.length !== 1)
        throw new WorkSyncError(
          '저장 결과를 하나로 확정할 수 없습니다. 자동 재생성하지 않습니다.',
          'SAVE_UNCERTAIN',
        );
      pageId = hits[0].id;
    }
    const result = await this.verifyExpected(pageId, item, s);
    if (result.ok) this.record(item, s, pageId);
    return result;
  }
  private async verifyExpected(pageId: string, item: PreviewItem, s: Settings) {
    const page = await this.api.getPage(pageId);
    const ds = await this.api.getDataSource(s.notion.dataSourceId);
    const checks: Record<string, boolean> = {
      database: sameId(ds.parent.database_id, s.notion.databaseId),
      dataSource: sameId(page.parent.data_source_id, s.notion.dataSourceId),
      active: !page.archived && !page.in_trash,
    };
    for (const [key, expected] of Object.entries(item.properties!)) {
      const actual =
        page.properties[key] ?? Object.values(page.properties).find((p) => p.id === key);
      const type = Object.keys(expected as object)[0];
      const e = (expected as Record<string, unknown>)[type];
      const a = actual?.[type];
      if (type === 'title' || type === 'rich_text') {
        const text = (e as { text: { content: string } }[]).map((t) => t.text.content).join('');
        checks[key] = textOf(actual) === text;
      } else if (type === 'relation' || type === 'people') {
        checks[key] = sameSet(
          ((a as { id: string }[] | undefined) ?? []).map((v) =>
            v.id.replaceAll('-', '').toLowerCase(),
          ),
          (e as { id: string }[]).map((v) => v.id.replaceAll('-', '').toLowerCase()),
        );
      } else if (type === 'date')
        checks[key] =
          hash(a) === hash({ ...(e as object), end: null, time_zone: null }) ||
          ((a as { start?: string; end?: string; time_zone?: string } | null)?.start ===
            (e as { start: string }).start &&
            !(a as { end?: string } | null)?.end &&
            !(a as { time_zone?: string } | null)?.time_zone);
      else if (type === 'select' || type === 'status')
        checks[key] = (a as { name?: string } | null)?.name === (e as { name: string }).name;
      else if (type === 'multi_select')
        checks[key] = sameSet(
          ((a as { name: string }[]) ?? []).map((v) => v.name),
          (e as { name: string }[]).map((v) => v.name),
        );
      else checks[key] = a === e;
    }
    const { pages } = await this.find(item.task.parentId);
    const relations = subitemProperties(ds, s);
    const parent = await this.api.getPage(item.task.parentId);
    checks.reciprocalParentLink = relationOf(parent.properties[relations.child.name]).some((id) =>
      sameId(id, pageId),
    );
    checks.uniqueOperation =
      pages.filter((p) => metadata(p, s)?.operations.includes(item.operationId)).length === 1;
    checks.uniqueEvidence = item.task.evidence.every(
      (e) => pages.filter((p) => metadata(p, s)?.keys.includes(evidenceKey(e))).length === 1,
    );
    checks.url =
      /^https:\/\/(?:www\.)?(?:notion\.so|notion\.site|notion\.com|app\.notion\.com)\//.test(
        page.url,
      ) &&
      page.url
        .replaceAll('-', '')
        .toLowerCase()
        .includes(page.id.replaceAll('-', '').toLowerCase());
    return {
      operationId: item.operationId,
      pageId: page.id,
      url: page.url,
      ok: Object.values(checks).every(Boolean),
      checks,
      timelineUi: '미검증',
      viewFilter: '미검증',
      urlVerification:
        'Notion API가 반환한 URL의 형식과 페이지 ID 확인; 브라우저 접근/렌더링은 미검증',
    };
  }
}
const sameOptional = (a?: string, b?: string) => (!a && !b) || sameId(a, b);
const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);
