#!/usr/bin/env node
import { copyFile } from 'node:fs/promises';
import { Client } from '@notionhq/client';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { loadEnvironment, loadSettings, projectRoot } from './config/settings.js';
import { Store } from './services/store.js';
import { approveInteractively, requirePreview } from './services/approval.js';
import { safeError, WorkSyncError } from './services/validation.js';
import { createApplication } from './app.js';
import { checkConnection } from './notion/schema.js';

async function main() {
  loadEnvironment();
  const [command, ...args] = process.argv.slice(2);
  if (command === 'init') {
    const target = resolve(process.env.WORKSYNC_SETTINGS ?? resolve(projectRoot, 'settings.json'));
    await copyFile(resolve(projectRoot, 'examples/settings.example.json'), target, 1);
    console.log(
      '개인 설정 파일 생성: ' +
        target +
        '\n예제 ID·사용자·허용 경로를 수정하세요. .env.example을 .env로 복사하고 토큰을 설정하세요.',
    );
    return;
  }
  if (command === 'approve') {
    const s = loadSettings();
    const store = new Store(s.stateDirectory);
    try {
      const [id, digest] = args;
      if (!id || !digest)
        throw new WorkSyncError('사용법: node dist/cli.js approve <previewId> <digest>');
      const p = requirePreview(store, id, digest);
      const preview = JSON.parse(p.data);
      if (preview.userId !== s.user.id) throw new WorkSyncError('현재 사용자 미리보기가 아닙니다.');
      if (!process.stdin.isTTY || !process.stdout.isTTY)
        throw new WorkSyncError('사용자의 대화형 터미널에서 실행하세요.');
      // Render remote text as inert JSON; escape terminal controls to prevent approval display spoofing.
      console.log(
        JSON.stringify(preview, null, 2).replace(
          /[\u001b\u007f-\u009f]/g,
          (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
        ),
      );
      console.log(
        '미리보기 SHA-256: ' +
          digest +
          '\n이 승인은 표시된 전체 업무·날짜·상태·대상 속성에만 적용됩니다.',
      );
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        const answer = await rl.question(`승인하려면 "승인 ${digest.slice(0, 12)}" 입력: `);
        approveInteractively(store, id, digest, answer, true);
        console.log('승인 기록 완료. 실제 저장은 MCP save_worklog(dryRun:false)를 호출하세요.');
      } finally {
        rl.close();
      }
    } finally {
      store.close();
    }
    return;
  }
  if (command === 'doctor' || command === 'integration') {
    if (command === 'integration') {
      if (!process.stdin.isTTY)
        throw new WorkSyncError('실제 연동 검사는 대화형 터미널에서 명시적으로 승인하세요.');
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        if (
          (await rl.question(
            '실제 Notion 읽기 전용 연결 검사를 실행할까요? "연결 검사" 입력: ',
          )) !== '연결 검사'
        )
          throw new WorkSyncError('검사를 취소했습니다.');
      } finally {
        rl.close();
      }
    }
    const app = createApplication();
    try {
      if (!process.env.NOTION_TOKEN)
        throw new WorkSyncError(
          'NOTION_TOKEN이 없습니다. 회사 승인 내부 Connection 토큰을 .env 또는 환경변수에 설정하세요.',
        );
      const ds = await app.api.getDataSource(app.s.notion.dataSourceId);
      const db = await app.api.getDatabase(app.s.notion.databaseId);
      const views = await app.api.listViews(ds.id);
      console.log(
        JSON.stringify(
          {
            readOnly: true,
            dataSourceId: ds.id,
            databaseId: db.id,
            properties: Object.values(ds.properties).map((p) => ({
              id: p.id,
              name: p.name,
              type: p.type,
              relation: p.relation,
            })),
            views,
            writeEnabled: app.service.allowWrite,
          },
          null,
          2,
        ),
      );
      await checkConnection(app.api, app.s);
      await app.service.find();
      console.log('REST 스키마·사용자·부모 연결 검증 완료. 실제 생성과 타임라인 UI는 미검증.');
    } finally {
      app.store.close();
    }
    return;
  }
  if (command === 'history') {
    const s = loadSettings(),
      store = new Store(s.stateDirectory);
    try {
      console.log(
        JSON.stringify(
          store.db
            .prepare(
              'SELECT id,user_id,state,page_id,updated FROM operations WHERE user_id=? ORDER BY updated DESC LIMIT 100',
            )
            .all(s.user.id),
          null,
          2,
        ),
      );
    } finally {
      store.close();
    }
    return;
  }
  if (command === 'users') {
    if (!process.env.NOTION_TOKEN) throw new WorkSyncError('NOTION_TOKEN을 먼저 설정하세요.');
    const sdk = new Client({ auth: process.env.NOTION_TOKEN, retry: false, logger: () => {} });
    let cursor: string | undefined;
    do {
      const r = await sdk.users.list({ page_size: 100, start_cursor: cursor });
      console.log(
        JSON.stringify(
          r.results
            .filter((u) => u.type === 'person')
            .map((u) => ({ id: u.id, name: u.name, type: u.type })),
          null,
          2,
        ),
      );
      cursor = r.has_more ? (r.next_cursor ?? undefined) : undefined;
    } while (cursor);
    return;
  }
  if (command === 'recover-lock') {
    const s = loadSettings(),
      store = new Store(s.stateDirectory);
    try {
      if (!process.stdin.isTTY || !process.stdout.isTTY)
        throw new WorkSyncError('사용자 터미널에서만 잠금을 복구할 수 있습니다.');
      console.log(
        JSON.stringify(
          {
            locks: store.db.prepare('SELECT * FROM locks').all(),
            unfinished: store.db
              .prepare("SELECT id,state,page_id,updated FROM operations WHERE state!='verified'")
              .all(),
          },
          null,
          2,
        ),
      );
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        const answer = await rl.question(
          '모든 WorkSync 프로세스 종료와 실제 저장 이력을 확인했으면 "잠금 해제" 입력: ',
        );
        if (answer !== '잠금 해제') throw new WorkSyncError('잠금 해제를 취소했습니다.');
        store.db.prepare('DELETE FROM locks WHERE id=?').run('save');
        console.log('로컬 저장 잠금만 해제했습니다. 출처 예약·미완료 이력은 유지합니다.');
      } finally {
        rl.close();
      }
    } finally {
      store.close();
    }
    return;
  }
  console.log(
    'WorkSync: init | doctor (읽기 전용) | integration (승인 후 읽기 검사) | users | approve <previewId> <digest> | history | recover-lock\nMCP 서버: node dist/index.js\n토큰 없는 Mock 데모: npm run demo',
  );
}
main().catch((e) => {
  console.error(JSON.stringify(safeError(e)));
  process.exitCode = 1;
});
