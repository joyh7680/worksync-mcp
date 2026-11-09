import { describe, it, expect } from 'vitest';
import { lastWeek, safeError } from '../src/services/validation.js';
import { worklogSchema } from '../src/schemas/worklog.js';
import { subitemProperties } from '../src/notion/subitems.js';
import { checkConnection } from '../src/notion/schema.js';
import { fixture } from './helpers.js';
describe('날짜·스키마·권한 경계', () => {
  it.each([
    ['2026-11-08T15:00:00Z', '2026-11-02', '2026-11-08'],
    ['2026-11-08T14:59:59Z', '2026-10-26', '2026-11-01'],
    ['2027-01-03T15:00:00Z', '2026-12-28', '2027-01-03'],
  ])('서울 기준 지난주 월~일 %s', (now, start, end) =>
    expect(lastWeek(new Date(now))).toMatchObject({ startDate: start, endDate: end }),
  );
  it('존재하지 않는 날짜와 역순 거부; 불명확한 날짜는 미리보기 확인 가능', () => {
    const f = fixture();
    try {
      expect(() => worklogSchema.parse({ ...f.task, startDate: '2026-02-30' })).toThrow();
      expect(() => worklogSchema.parse({ ...f.task, startDate: '2026-12-31' })).toThrow();
      expect(
        worklogSchema.parse({ ...f.task, startDate: null, endDate: null, dateBasis: 'unknown' })
          .startDate,
      ).toBeNull();
    } finally {
      f.close();
    }
  });
  it('Git 해시는 전체 값만 허용', () => {
    const f = fixture();
    try {
      expect(() =>
        worklogSchema.parse({
          ...f.task,
          evidence: [{ ...f.task.evidence[0], kind: 'git', id: 'abc123' }],
        }),
      ).toThrow();
    } finally {
      f.close();
    }
  });
  it('실제 Sub-item 보기 설정과 일치하지 않는 일반 relation 차단', async () => {
    const f = fixture();
    try {
      f.api.getView = async (id) => ({
        id,
        name: '관계 미지원',
        parent: { database_id: f.s.notion.databaseId },
        data_source_id: f.s.notion.dataSourceId,
        filter: null,
        configuration: { type: 'table', subtasks: { property_id: 'other', display_mode: 'show' } },
      });
      await expect(checkConnection(f.api, f.s)).rejects.toMatchObject({
        code: 'SUBITEMS_UNCONFIRMED',
      });
      f.s.notion.subitems = null;
      expect(() => subitemProperties(f.api.schema, f.s)).toThrow();
    } finally {
      f.close();
    }
  });
  it('잘못된 DB와 데이터 소스 연결 차단', async () => {
    const f = fixture();
    try {
      f.api.schema.parent.database_id = '99999999-9999-4999-8999-999999999999';
      await expect(checkConnection(f.api, f.s)).rejects.toThrow('데이터베이스');
    } finally {
      f.close();
    }
  });
  it('SDK 오류에 포함된 토큰/응답본문을 사용자에게 유출하지 않음', () => {
    expect(
      JSON.stringify(
        safeError(Object.assign(new Error('secret_token_123'), { status: 401, body: 'token' })),
      ),
    ).not.toContain('secret_token');
  });
});
