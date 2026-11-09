import type { Worklog } from '../schemas/worklog.js';
import { evidenceKey } from '../schemas/worklog.js';
import type { Settings } from '../config/settings.js';
import type { DataSource, Page } from './types.js';
import { textOf, value } from './types.js';
import { option, requireType } from './schema.js';
import { subitemProperties } from './subitems.js';
import { hash, WorkSyncError } from '../services/validation.js';
export interface Metadata {
  userId: string;
  keys: string[];
  operations: string[];
  contentHash: string;
}
export const contentHash = (t: Worklog) =>
  hash({
    title: t.title,
    description: t.description,
    startDate: t.startDate,
    endDate: t.endDate,
    dateBasis: t.dateBasis,
    status: t.status,
    statusEvidence: t.statusEvidence,
    progress: t.progress,
    evidence: t.evidence,
  });
export function metadata(page: Page, s: Settings): Metadata | undefined {
  const matches = [
    ...textOf(page.properties[s.notion.properties.description]).matchAll(
      /\[WorkSync:v1:([A-Za-z0-9_-]+)\]/g,
    ),
  ];
  if (matches.length !== 1) return;
  try {
    const v = JSON.parse(Buffer.from(matches[0][1], 'base64url').toString('utf8')) as Metadata;
    if (
      typeof v.userId === 'string' &&
      Array.isArray(v.keys) &&
      v.keys.every((k) => typeof k === 'string') &&
      Array.isArray(v.operations) &&
      v.operations.every((k) => typeof k === 'string') &&
      typeof v.contentHash === 'string'
    )
      return v;
  } catch {
    /* untrusted metadata */
  }
}
export function mapTask(t: Worklog, s: Settings, ds: DataSource, opId: string, existing?: Page) {
  const p = s.notion.properties;
  const old = existing ? metadata(existing, s) : undefined;
  const meta: Metadata = {
    userId: s.user.id,
    keys: [...new Set([...(old?.keys ?? []), ...t.evidence.map(evidenceKey)])].sort(),
    operations: [...new Set([...(old?.operations ?? []), opId])],
    contentHash: contentHash(t),
  };
  const text =
    t.description +
    '\n근거:\n' +
    t.evidence
      .map((e) => '- ' + e.kind + ': ' + e.note + ' (' + e.id + ')' + (e.url ? ' ' + e.url : ''))
      .join('\n') +
    '\n날짜 근거: ' +
    t.dateBasis +
    '\n상태 근거: ' +
    t.statusEvidence +
    '\n[WorkSync:v1:' +
    Buffer.from(JSON.stringify(meta)).toString('base64url') +
    ']';
  if (text.length > 40_000)
    throw new WorkSyncError('설명/출처가 Notion 안전 제한을 초과했습니다. 근거를 줄이세요.');
  const rich = [];
  for (let i = 0; i < text.length; i += 1800)
    rich.push({ type: 'text', text: { content: text.slice(i, i + 1800) } });
  const team = requireType(ds, p.team, ['select', 'multi_select']);
  let teamValue = option(team, s.team);
  if (existing && team.type === 'multi_select') {
    const oldTeams = value<{ name: string }[]>(existing.properties[p.team], 'multi_select') ?? [];
    teamValue = {
      multi_select: [...new Set([...oldTeams.map((v) => v.name), s.team])].map((name) => ({
        name,
      })),
    };
    for (const name of new Set([...oldTeams.map((v) => v.name), s.team])) option(team, name);
  }
  const properties: Record<string, unknown> = {
    [p.title]: { title: [{ type: 'text', text: { content: t.title } }] },
    [p.description]: { rich_text: rich },
    [p.start]: { date: { start: t.startDate } },
    [p.end]: { date: { start: t.endDate } },
    [p.status]: option(requireType(ds, p.status, ['select', 'status']), t.status),
    [p.team]: teamValue,
    [p.stage]: option(requireType(ds, p.stage, ['select', 'status']), s.notion.stage),
    [p.participants]: { people: [{ object: 'user', id: s.user.notionUserId }] },
    [subitemProperties(ds, s).parent.name]: { relation: [{ id: t.parentId }] },
  };
  if (t.progress !== undefined) {
    if (!p.progress) throw new WorkSyncError('진행률 속성 매핑이 없습니다.');
    const progressProperty = requireType(ds, p.progress, ['number']);
    properties[p.progress] = {
      number:
        (progressProperty.number as { format?: string })?.format === 'percent'
          ? t.progress / 100
          : t.progress,
    };
  }
  return { properties, meta };
}
