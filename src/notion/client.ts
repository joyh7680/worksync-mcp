import { Client, LogLevel } from '@notionhq/client';
import type { NotionGateway, DataSource, Page, View } from './types.js';
import { WorkSyncError } from '../services/validation.js';
function nextCursor(
  response: { has_more: boolean; next_cursor: string | null },
  seen: Set<string>,
) {
  if (!response.has_more) return undefined;
  if (!response.next_cursor || seen.has(response.next_cursor))
    throw new WorkSyncError(
      'Notion 페이지네이션 응답이 불완전하거나 반복됩니다. 저장을 중단합니다.',
    );
  seen.add(response.next_cursor);
  return response.next_cursor;
}

export async function retry<T>(
  fn: () => Promise<T>,
  write = false,
  sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
): Promise<T> {
  for (let attempt = 0; ; attempt++)
    try {
      return await fn();
    } catch (error) {
      const e = error as { status?: number; headers?: Headers | Record<string, string> };
      if (
        attempt >= 3 ||
        !(e.status === 429 || (!write && [500, 502, 503, 504].includes(e.status ?? 0)))
      )
        throw error;
      const h = e.headers;
      const seconds =
        h instanceof Headers
          ? h.get('retry-after')
          : (h as Record<string, string> | undefined)?.['retry-after'];
      const delay =
        seconds === undefined || seconds === null ? 250 * 2 ** attempt : Number(seconds) * 1000;
      if (!Number.isFinite(delay) || delay > 30_000 || delay < 0) throw error;
      await sleep(delay);
    }
}
export class NotionClient implements NotionGateway {
  private sdk: Client;
  constructor(token: string) {
    this.sdk = new Client({
      auth: token,
      retry: false,
      notionVersion: '2025-09-03',
      timeoutMs: 20_000,
      logLevel: LogLevel.ERROR,
      logger: () => {},
    });
  }
  async getDataSource(id: string) {
    return (await retry(() =>
      this.sdk.dataSources.retrieve({ data_source_id: id }),
    )) as unknown as DataSource;
  }
  async getDatabase(id: string) {
    return (await retry(() => this.sdk.databases.retrieve({ database_id: id }))) as unknown as {
      id: string;
      data_sources: { id: string }[];
    };
  }
  async getUser(id: string) {
    return await retry(() => this.sdk.users.retrieve({ user_id: id }));
  }
  async getView(id: string) {
    return (await retry(() => this.sdk.views.retrieve({ view_id: id }))) as unknown as View;
  }
  async listViews(dataSourceId: string) {
    const views: View[] = [];
    let cursor: string | undefined;
    const seen = new Set<string>();
    do {
      const response = await retry(() =>
        this.sdk.views.list({ data_source_id: dataSourceId, start_cursor: cursor, page_size: 100 }),
      );
      for (const v of response.results) views.push(await this.getView(v.id));
      cursor = nextCursor(response, seen);
      if (views.length > 500) throw new WorkSyncError('보기 조회 상한 초과');
    } while (cursor);
    return views;
  }
  async getPage(id: string): Promise<Page> {
    const page = (await retry(() => this.sdk.pages.retrieve({ page_id: id }))) as unknown as Page;
    if (!page.properties) throw new WorkSyncError('부분 페이지 응답으로 검증할 수 없습니다.');
    // Relations/rich text/people can be truncated in page retrieval. Hydrate before comparing or updating.
    for (const p of Object.values(page.properties))
      if (['relation', 'rich_text', 'title', 'people'].includes(p.type)) {
        const results: unknown[] = [];
        let cursor: string | undefined;
        const seen = new Set<string>();
        do {
          const r = await retry(() =>
            this.sdk.pages.properties.retrieve({
              page_id: id,
              property_id: p.id,
              start_cursor: cursor,
              page_size: 100,
            }),
          );
          if (r.object === 'list') {
            for (const item of r.results)
              results.push((item as unknown as Record<string, unknown>)[p.type]);
            cursor = nextCursor(r, seen);
            if (results.length > 5000) throw new WorkSyncError('속성 조회 상한을 초과했습니다.');
          } else {
            cursor = undefined;
            results.push((r as unknown as Record<string, unknown>)[p.type]);
          }
        } while (cursor);
        p[p.type] = results;
      }
    return page;
  }
  async query(dataSourceId: string, parentProperty: string, parentId: string): Promise<Page[]> {
    const pages: Page[] = [];
    let cursor: string | undefined;
    const seen = new Set<string>();
    do {
      const r = await retry(() =>
        this.sdk.dataSources.query({
          data_source_id: dataSourceId,
          filter: { property: parentProperty, relation: { contains: parentId } },
          page_size: 100,
          start_cursor: cursor,
        }),
      );
      for (const p of r.results) pages.push(await this.getPage(p.id));
      cursor = nextCursor(r, seen);
      if (pages.length > 1000)
        throw new WorkSyncError('기존 업무 조회 상한을 넘었습니다. 자동 저장을 중단합니다.');
    } while (cursor);
    return pages;
  }
  async create(dataSourceId: string, properties: Record<string, unknown>) {
    return (await retry(
      () =>
        this.sdk.pages.create({
          parent: { type: 'data_source_id', data_source_id: dataSourceId },
          properties: properties as Parameters<Client['pages']['create']>[0]['properties'],
        }),
      true,
    )) as unknown as Page;
  }
  async update(id: string, properties: Record<string, unknown>) {
    return (await retry(
      () =>
        this.sdk.pages.update({
          page_id: id,
          properties: properties as Parameters<Client['pages']['update']>[0]['properties'],
        }),
      true,
    )) as unknown as Page;
  }
}
