import type { Settings } from '../config/settings.js';
import type { NotionGateway, DataSource, Property } from './types.js';
import { subitemProperties, samePropertyId } from './subitems.js';
import { sameId, WorkSyncError } from '../services/validation.js';
export const property = (ds: DataSource, key: string) =>
  ds.properties[key] ?? Object.values(ds.properties).find((p) => p.id === key);
export function requireType(ds: DataSource, key: string, types: string[]) {
  const p = property(ds, key);
  if (!p || !types.includes(p.type))
    throw new WorkSyncError('Notion 속성 형식이 설정과 일치하지 않습니다: ' + key);
  return p;
}
export function option(p: Property, name: string) {
  const options = (p[p.type] as { options?: { name: string }[] })?.options ?? [];
  if (!options.some((o) => o.name === name))
    throw new WorkSyncError('기존에 없는 선택 옵션은 추가하지 않습니다: ' + name);
  return p.type === 'multi_select' ? { multi_select: [{ name }] } : { [p.type]: { name } };
}
export async function checkConnection(api: NotionGateway, s: Settings) {
  const ds = await api.getDataSource(s.notion.dataSourceId);
  const db = await api.getDatabase(s.notion.databaseId);
  if (!sameId(ds.parent.database_id, db.id) || !db.data_sources.some((d) => sameId(d.id, ds.id)))
    throw new WorkSyncError('데이터베이스·데이터 소스 ID가 실제 REST 응답과 일치하지 않습니다.');
  const p = s.notion.properties;
  requireType(ds, p.title, ['title']);
  requireType(ds, p.description, ['rich_text']);
  requireType(ds, p.start, ['date']);
  requireType(ds, p.end, ['date']);
  requireType(ds, p.participants, ['people']);
  option(requireType(ds, p.team, ['select', 'multi_select']), s.team);
  option(requireType(ds, p.stage, ['select', 'status']), s.notion.stage);
  requireType(ds, p.status, ['select', 'status']);
  const user = await api.getUser(s.user.notionUserId);
  if (user.type !== 'person' || !sameId(user.id, s.user.notionUserId))
    throw new WorkSyncError('실제 Notion 사용자 ID를 확인할 수 없습니다.');
  const relations = subitemProperties(ds, s);
  const view = await api.getView(s.notion.subitems!.verificationViewId);
  const subtasks = view.configuration?.subtasks;
  if (
    !sameId(view.data_source_id ?? undefined, ds.id) ||
    subtasks?.display_mode === 'disabled' ||
    ![relations.parent.id, relations.child.id].some((id) =>
      samePropertyId(id, subtasks?.property_id),
    )
  )
    throw new WorkSyncError(
      'REST 보기 설정에서 지정한 관계가 실제 Sub-item 관계임을 확인할 수 없습니다. 임의의 relation으로 대체하지 않습니다.',
      'SUBITEMS_UNCONFIRMED',
    );
  const targetView = s.notion.targetViewId ? await api.getView(s.notion.targetViewId) : undefined;
  if (targetView && !sameId(targetView.data_source_id ?? undefined, ds.id))
    throw new WorkSyncError('대상 보기가 다른 데이터 소스에 연결되어 있습니다.');
  return { ds, relations, view, targetView };
}
