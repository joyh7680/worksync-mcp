import type { Settings } from '../config/settings.js';
import type { NotionGateway, Page, DataSource, Property } from './types.js';
import { relationOf } from './types.js';
import { randomUUID } from 'node:crypto';
export const DEMO = {
  database: '11111111-1111-4111-8111-111111111111',
  source: '22222222-2222-4222-8222-222222222222',
  parent: '33333333-3333-4333-8333-333333333333',
  user: '44444444-4444-4444-8444-444444444444',
};
export function demoSettings(stateDirectory: string): Settings {
  return {
    user: { id: 'demo-user', name: '데모 사용자', notionUserId: DEMO.user },
    team: '04. 프론트',
    timezone: 'Asia/Seoul',
    git: {
      defaultRepository: process.cwd(),
      allowedRepositories: [process.cwd()],
      defaultBranch: 'main',
      author: 'demo@example.com',
    },
    notion: {
      databaseId: DEMO.database,
      dataSourceId: DEMO.source,
      defaultParentId: DEMO.parent,
      allowedParentIds: [DEMO.parent],
      stage: '5. 세부 할 일',
      properties: {
        title: '업무명',
        description: '설명',
        start: '시작일',
        end: '종료일',
        status: '상태',
        team: '팀',
        participants: '참여자',
        stage: '단계',
        progress: '진행률 (%)',
      },
      subitems: {
        parentPropertyId: 'parent',
        childPropertyId: 'children',
        verificationViewId: '55555555-5555-4555-8555-555555555555',
        confirmedInNotionUi: true,
      },
    },
    stateDirectory,
  };
}
export class MockNotion implements NotionGateway {
  pages = new Map<string, Page>();
  writes = 0;
  schema: DataSource;
  constructor(readonly s: Settings) {
    const prop = (name: string, type: string, extra: object = {}): Property => ({
      id: name,
      name,
      type,
      ...extra,
    });
    const p = s.notion.properties;
    this.schema = {
      id: s.notion.dataSourceId,
      parent: { database_id: s.notion.databaseId },
      properties: {
        [p.title]: prop(p.title, 'title'),
        [p.description]: prop(p.description, 'rich_text'),
        [p.start]: prop(p.start, 'date'),
        [p.end]: prop(p.end, 'date'),
        [p.status]: prop(p.status, 'select', {
          select: { options: ['진행 중', '완료', '논의 필요'].map((name) => ({ name })) },
        }),
        [p.team]: prop(p.team, 'multi_select', { multi_select: { options: [{ name: s.team }] } }),
        [p.stage]: prop(p.stage, 'select', { select: { options: [{ name: s.notion.stage }] } }),
        [p.participants]: prop(p.participants, 'people'),
        [p.progress!]: prop(p.progress!, 'number'),
        '상위 항목': {
          id: 'parent',
          name: '상위 항목',
          type: 'relation',
          relation: {
            data_source_id: s.notion.dataSourceId,
            type: 'dual_property',
            dual_property: { synced_property_id: 'children' },
          },
        },
        '하위 항목': {
          id: 'children',
          name: '하위 항목',
          type: 'relation',
          relation: {
            data_source_id: s.notion.dataSourceId,
            type: 'dual_property',
            dual_property: { synced_property_id: 'parent' },
          },
        },
      },
    };
    this.pages.set(
      s.notion.defaultParentId,
      this.page(s.notion.defaultParentId, {
        [p.title]: { title: [{ text: { content: '데모 부모 업무' } }] },
        '하위 항목': { relation: [] },
      }),
    );
  }
  private page(id: string, properties: Record<string, unknown>): Page {
    const props: Record<string, Property> = {};
    for (const [name, v] of Object.entries(properties)) {
      const schema = this.schema.properties[name];
      props[name] = {
        id: schema?.id ?? name,
        name,
        type: schema?.type ?? Object.keys(v as object)[0],
        ...(v as object),
      };
    }
    return {
      id,
      url: 'https://www.notion.so/' + id.replaceAll('-', ''),
      last_edited_time: new Date().toISOString(),
      parent: { data_source_id: this.s.notion.dataSourceId },
      properties: props,
    };
  }
  async getDataSource(_id: string) {
    return structuredClone(this.schema);
  }
  async getDatabase(_id: string) {
    return { id: this.s.notion.databaseId, data_sources: [{ id: this.s.notion.dataSourceId }] };
  }
  async getUser(id: string) {
    return { id, type: 'person' };
  }
  async getView(id: string) {
    return {
      id,
      name: '데모 하위 항목 보기',
      parent: { database_id: this.s.notion.databaseId },
      data_source_id: this.s.notion.dataSourceId,
      filter: null,
      configuration: { type: 'table', subtasks: { property_id: 'children', display_mode: 'show' } },
    };
  }
  async listViews(_id: string) {
    return [await this.getView(this.s.notion.subitems!.verificationViewId)];
  }
  async getPage(id: string) {
    const page = this.pages.get(id);
    if (!page) throw Object.assign(new Error('not found'), { status: 404 });
    return structuredClone(page);
  }
  async query(_id: string, property: string, parentId: string) {
    return structuredClone(
      [...this.pages.values()].filter((p) => relationOf(p.properties[property]).includes(parentId)),
    );
  }
  async create(_id: string, properties: Record<string, unknown>) {
    const page = this.page(randomUUID(), properties);
    this.pages.set(page.id, page);
    this.writes++;
    for (const parentId of relationOf(page.properties['상위 항목'])) {
      const parent = this.pages.get(parentId)!;
      parent.properties['하위 항목'] = {
        id: 'children',
        name: '하위 항목',
        type: 'relation',
        relation: [
          ...relationOf(parent.properties['하위 항목']).map((id) => ({ id })),
          { id: page.id },
        ],
      };
    }
    return structuredClone(page);
  }
  async update(id: string, properties: Record<string, unknown>) {
    const old = await this.getPage(id);
    const page = this.page(id, { ...old.properties, ...properties });
    this.pages.set(id, page);
    this.writes++;
    return structuredClone(page);
  }
}
