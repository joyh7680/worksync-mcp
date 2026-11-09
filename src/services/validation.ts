import { createHash } from 'node:crypto';
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.entries(v)
        .sort(([a], [b]) => a.localeCompare(b, 'en'))
        .map(([k, value]) => [k, canonical(value)]),
    );
  return v;
}
export const hash = (v: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(v)) ?? 'undefined')
    .digest('hex');
export const sameId = (a: string | undefined, b: string | undefined) =>
  !!a && !!b && a.replaceAll('-', '').toLowerCase() === b.replaceAll('-', '').toLowerCase();
export function lastWeek(now = new Date()) {
  const day = new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
  const date = new Date(day + 'T00:00:00Z');
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset - 7);
  const startDate = date.toISOString().slice(0, 10);
  date.setUTCDate(date.getUTCDate() + 6);
  return { startDate, endDate: date.toISOString().slice(0, 10), timezone: 'Asia/Seoul' };
}
export const seoulDay = (iso: string) =>
  new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 10);
export function safeError(error: unknown) {
  const e = error as { code?: string; status?: number };
  const code =
    typeof e?.code === 'string' && /^[a-zA-Z0-9_]+$/.test(e.code) ? e.code : 'WORKSYNC_ERROR';
  // Never emit SDK error bodies, request headers or arbitrary external error text.
  if (e?.status)
    return { code, message: `Notion 요청 실패 (HTTP ${e.status}). 권한·속성 매핑을 확인하세요.` };
  const message =
    error instanceof WorkSyncError ? error.message : '요청 처리 실패. 설정·입력·연결을 확인하세요.';
  return {
    code,
    message,
    ...(error instanceof WorkSyncError && error.details ? { details: error.details } : {}),
  };
}
export class WorkSyncError extends Error {
  constructor(
    message: string,
    public code = 'WORKSYNC_ERROR',
    public details?: unknown,
  ) {
    super(message);
  }
}
