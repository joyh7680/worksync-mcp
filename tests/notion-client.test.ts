import { describe, it, expect, vi, afterEach } from 'vitest';
import { NotionClient, retry } from '../src/notion/client.js';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('Notion API 경계 및 재시도', () => {
  it('429 Retry-After 적용 후 성공', async () => {
    const f = vi
      .fn()
      .mockRejectedValueOnce({ status: 429, headers: new Headers({ 'retry-after': '2' }) })
      .mockResolvedValue('ok');
    const sleep = vi.fn().mockResolvedValue(undefined);
    expect(await retry(f, false, sleep)).toBe('ok');
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('읽기 503 재시도; 쓰기 503과 네트워크 오류는 중복 방지를 위해 재시도하지 않음', async () => {
    const read = vi.fn().mockRejectedValueOnce({ status: 503 }).mockResolvedValue('ok');
    await retry(read, false, async () => {});
    expect(read).toHaveBeenCalledTimes(2);
    const write = vi.fn().mockRejectedValue({ status: 503 });
    await expect(retry(write, true, async () => {})).rejects.toMatchObject({ status: 503 });
    expect(write).toHaveBeenCalledTimes(1);
    const network = vi.fn().mockRejectedValue(new Error('timeout'));
    await expect(retry(network, true, async () => {})).rejects.toThrow();
    expect(network).toHaveBeenCalledTimes(1);
  });
  it('인증 오류, 재시도 상한, 긴 Retry-After는 즉시 반환', async () => {
    const auth = vi.fn().mockRejectedValue({ status: 403 });
    await expect(retry(auth, false, async () => {})).rejects.toMatchObject({ status: 403 });
    expect(auth).toHaveBeenCalledTimes(1);
    const rate = vi.fn().mockRejectedValue({ status: 429 });
    await expect(retry(rate, false, async () => {})).rejects.toMatchObject({ status: 429 });
    expect(rate).toHaveBeenCalledTimes(4);
    const long = vi.fn().mockRejectedValue({ status: 429, headers: { 'retry-after': '120' } });
    await expect(retry(long, false, async () => {})).rejects.toMatchObject({ status: 429 });
    expect(long).toHaveBeenCalledTimes(1);
  });
  it('실제 공식 SDK를 Mock fetch에 연결해 data_source_id·날짜·부모 속성 전달', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          object: 'page',
          id: 'page',
          url: 'https://www.notion.so/page',
          properties: {},
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetch);
    const api = new NotionClient('test-token');
    await api.create('source', {
      시작일: { date: { start: '2026-11-02' } },
      종료일: { date: { start: '2026-11-04' } },
      상위: { relation: [{ id: 'parent' }] },
    });
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toContain('/pages');
    expect(JSON.parse(init.body)).toMatchObject({
      parent: { type: 'data_source_id', data_source_id: 'source' },
      properties: {
        시작일: { date: { start: '2026-11-02' } },
        상위: { relation: [{ id: 'parent' }] },
      },
    });
  });
  it('relation 속성의 페이지네이션을 끝까지 읽음', async () => {
    const responses = [
      {
        object: 'page',
        id: 'page',
        parent: { data_source_id: 'source' },
        properties: {
          부모: { id: 'rel', type: 'relation', relation: [{ id: 'truncated' }], has_more: true },
        },
      },
      {
        object: 'list',
        results: [{ type: 'relation', relation: { id: 'one' } }],
        has_more: true,
        next_cursor: 'next',
      },
      {
        object: 'list',
        results: [{ type: 'relation', relation: { id: 'two' } }],
        has_more: false,
        next_cursor: null,
      },
    ];
    const fetch = vi.fn().mockImplementation(
      async () =>
        new Response(JSON.stringify(responses.shift()), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetch);
    const page = await new NotionClient('test-token').getPage('page');
    expect(page.properties['부모'].relation).toEqual([{ id: 'one' }, { id: 'two' }]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('다음 페이지 커서가 누락된 응답으로 중복 조회를 성공했다고 주장하지 않음', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(
          async () =>
            new Response(
              JSON.stringify({ object: 'list', results: [], has_more: true, next_cursor: null }),
              { status: 200, headers: { 'content-type': 'application/json' } },
            ),
        ),
    );
    await expect(
      new NotionClient('test-token').query('source', 'parent', 'parent-id'),
    ).rejects.toThrow('불완전');
  });
});
