import type { Settings } from '../config/settings.js';
import type { DataSource, Property } from './types.js';
import { sameId, WorkSyncError } from '../services/validation.js';
const decode = (v: string) => {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
};
export const samePropertyId = (a: string | undefined, b: string | undefined) =>
  !!a && !!b && decode(a) === decode(b);
export function subitemProperties(ds: DataSource, s: Settings) {
  const cfg = s.notion.subitems;
  if (!cfg?.confirmedInNotionUi)
    throw new WorkSyncError(
      '실제 Sub-item 관계 미확인: Notion UI의 하위 항목 설정에서 부모·자식 속성 ID를 확인해야 합니다.',
      'SUBITEMS_UNCONFIRMED',
    );
  const find = (id: string) => Object.values(ds.properties).find((p) => samePropertyId(p.id, id));
  const parent = find(cfg.parentPropertyId),
    child = find(cfg.childPropertyId);
  const relation = (p: Property | undefined) =>
    p?.relation as
      | {
          data_source_id?: string;
          database_id?: string;
          type?: string;
          dual_property?: { synced_property_id: string };
        }
      | undefined;
  const pr = relation(parent),
    cr = relation(child);
  // A database can contain several data sources. Same database alone cannot prove self-reference.
  const self = (r: ReturnType<typeof relation>) => r && sameId(r.data_source_id, ds.id);
  if (
    !parent ||
    !child ||
    samePropertyId(parent.id, child.id) ||
    parent.type !== 'relation' ||
    child.type !== 'relation' ||
    !self(pr) ||
    !self(cr) ||
    pr?.type !== 'dual_property' ||
    cr?.type !== 'dual_property' ||
    !samePropertyId(pr.dual_property?.synced_property_id, child.id) ||
    !samePropertyId(cr.dual_property?.synced_property_id, parent.id)
  )
    throw new WorkSyncError(
      '실제 부모·자식의 자기 참조 양방향 관계를 REST 스키마에서 검증할 수 없습니다.',
      'SUBITEMS_UNSUPPORTED',
    );
  return { parent, child };
}
