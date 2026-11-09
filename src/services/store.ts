import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkSyncError } from './validation.js';

export class Store {
  readonly db: DatabaseSync;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(resolve(directory, 'worksync.sqlite'));
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS previews(id TEXT PRIMARY KEY, digest TEXT NOT NULL, data TEXT NOT NULL, expires INTEGER NOT NULL, approved INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,state TEXT NOT NULL,page_id TEXT,data TEXT NOT NULL,updated TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sources(key TEXT PRIMARY KEY, operation_id TEXT NOT NULL,page_id TEXT NOT NULL,user_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS locks(id TEXT PRIMARY KEY,owner TEXT NOT NULL,created TEXT NOT NULL);`);
  }
  close() {
    this.db.close();
  }
  preview(id: string) {
    return this.db.prepare('SELECT * FROM previews WHERE id=?').get(id) as
      { id: string; digest: string; data: string; expires: number; approved: number } | undefined;
  }
  putPreview(id: string, digest: string, data: unknown, expires: number) {
    this.db
      .prepare('INSERT INTO previews(id,digest,data,expires) VALUES(?,?,?,?)')
      .run(id, digest, JSON.stringify(data), expires);
  }
  approve(id: string, digest: string) {
    const r = this.db
      .prepare('UPDATE previews SET approved=1 WHERE id=? AND digest=? AND expires>?')
      .run(id, digest, Date.now());
    if (!r.changes) throw new WorkSyncError('미리보기 버전이 다르거나 만료되었습니다.');
  }
  operation(id: string) {
    return this.db.prepare('SELECT * FROM operations WHERE id=?').get(id) as
      | { id: string; user_id: string; state: string; page_id: string | null; data: string }
      | undefined;
  }
  putOperation(id: string, user: string, state: string, pageId: string | null, data: unknown) {
    this.db
      .prepare(
        'INSERT INTO operations VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,page_id=excluded.page_id,data=excluded.data,updated=excluded.updated',
      )
      .run(id, user, state, pageId, JSON.stringify(data), new Date().toISOString());
  }
  source(key: string) {
    return this.db.prepare('SELECT * FROM sources WHERE key=?').get(key) as
      { operation_id: string; page_id: string; user_id: string } | undefined;
  }
  claim(key: string, operationId: string, pageId: string, userId: string) {
    const result = this.db
      .prepare(
        'INSERT INTO sources VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET operation_id=excluded.operation_id,page_id=excluded.page_id WHERE sources.user_id=excluded.user_id AND (sources.page_id=excluded.page_id OR sources.operation_id=excluded.operation_id)',
      )
      .run(key, operationId, pageId, userId);
    if (!result.changes)
      throw new WorkSyncError('다른 등록 작업이 동일 근거를 사용 중입니다.', 'SOURCE_CONFLICT');
  }
  async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const owner = randomUUID();
    try {
      this.db
        .prepare('INSERT INTO locks VALUES(?,?,?)')
        .run('save', owner, new Date().toISOString());
    } catch {
      throw new WorkSyncError(
        '다른 저장이 진행 중이거나 이전 프로세스가 중단되었습니다. 이력 점검 후 잠금을 해제하세요.',
        'SAVE_LOCKED',
      );
    }
    try {
      return await fn();
    } finally {
      this.db.prepare('DELETE FROM locks WHERE id=? AND owner=?').run('save', owner);
    }
  }
}
