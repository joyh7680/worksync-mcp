import type { Worklog } from '../schemas/worklog.js';
import { evidenceKey } from '../schemas/worklog.js';
import type { Page } from '../notion/types.js';
import { value, textOf } from '../notion/types.js';
import { metadata, contentHash } from '../notion/task-mapper.js';
import type { Settings } from '../config/settings.js';
import { sameId, WorkSyncError } from './validation.js';
import type { Store } from './store.js';
export const scopedKey = (key: string, s: Settings) =>
  JSON.stringify([s.notion.dataSourceId.replaceAll('-', '').toLowerCase(), key]);
export function owns(page: Page, s: Settings) {
  const people =
    value<{ id: string }[]>(page.properties[s.notion.properties.participants], 'people') ?? [];
  return (
    metadata(page, s)?.userId === s.user.id &&
    people.length === 1 &&
    sameId(people[0].id, s.user.notionUserId)
  );
}
export function classify(
  t: Worklog,
  pages: Page[],
  s: Settings,
  store: Store,
): { action: 'create' | 'update' | 'duplicate'; existing?: Page; reason: string } {
  const keys = t.evidence.map(evidenceKey);
  const hits = pages.filter((p) => {
    const m = metadata(p, s);
    const text = textOf(p.properties[s.notion.properties.description]);
    return keys.some((k) => m?.keys.includes(k)) || t.evidence.some((e) => text.includes(e.id));
  });
  for (const k of keys) {
    const row = store.source(scopedKey(k, s));
    if (row && !hits.some((p) => sameId(p.id, row.page_id)))
      throw new WorkSyncError(
        '동일 근거의 등록 이력이 다른 위치에 있거나 삭제/이동되었습니다. 재등록 전에 확인하세요.',
      );
  }
  if (t.updatePageId) {
    const target = pages.find((p) => sameId(p.id, t.updatePageId));
    if (!target || !owns(target, s))
      throw new WorkSyncError('직접 하위 항목이며 본인 등록 업무인 경우에만 수정할 수 있습니다.');
    if (hits.some((p) => !sameId(p.id, target.id)))
      throw new WorkSyncError('다른 업무와 근거가 충돌합니다.');
    return {
      action: metadata(target, s)?.contentHash === contentHash(t) ? 'duplicate' : 'update',
      existing: target,
      reason: '명시적으로 지정한 본인 업무',
    };
  }
  if (hits.length > 1)
    throw new WorkSyncError('여러 기존 업무에 근거가 분산되어 있습니다. 확인이 필요합니다.');
  if (hits.length === 1) {
    const target = hits[0],
      m = metadata(target, s);
    if (!owns(target, s) || !m)
      throw new WorkSyncError(
        '다른 사용자 또는 WorkSync 외부 업무와 근거가 겹칩니다. 자동 수정하지 않습니다.',
      );
    if (!keys.some((k) => m.keys.includes(k)))
      throw new WorkSyncError(
        '본문에 유사한 원본 식별자가 있지만 동일 근거로 확인되지 않았습니다.',
      );
    if (keys.every((k) => m.keys.includes(k)))
      return { action: 'duplicate', existing: target, reason: '동일 근거가 이미 등록되었습니다.' };
    return {
      action: 'update',
      existing: target,
      reason: '기존 본인 업무에 새로운 근거가 추가되었습니다.',
    };
  }
  if (pages.some((p) => textOf(p.properties[s.notion.properties.title]) === t.title))
    throw new WorkSyncError(
      '동일 제목의 업무가 있습니다. 제목만으로 합치지 않으며 대상 확인이 필요합니다.',
    );
  return { action: 'create', reason: '등록된 동일 근거 없음' };
}
