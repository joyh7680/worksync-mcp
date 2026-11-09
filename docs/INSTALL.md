# 설치와 AI 도구별 연결

## Windows PowerShell에서 준비

Node.js 22.13 이상(검증 환경 26.12.1), npm, Git을 설치한다. 기본 Node SQLite를 사용하므로 별도 DB 서버나 유료 AI API는 필요 없다. 소스 파일의 한글을 보기 위해 UTF-8 터미널을 권장한다.

```powershell
cd C:\workspace\worksync-mcp
npm ci
npm run typecheck
npm run build
npm test
npm run demo
```

`demo`는 빌드된 서버를 별도 프로세스로 실행해 실제 MCP v2 클라이언트와 stdio 통신한다. 가짜 UUID와 메모리 Notion만 사용하며 회사 데이터와 토큰은 쓰지 않는다. 6개 도구 목록, 업무 검색·미리보기, Dry Run, 승인 없는 저장 차단을 검사한다. 테스트는 임시 폴더의 Git/SQLite와 Mock fetch를 사용한다.

## 개인 설정과 Notion Connection

Notion의 [공식 내부 Connection 생성 안내](https://developers.notion.com/guides/get-started/create-a-notion-integration)에 따라 회사가 승인한 내부 Connection을 만든다. 대상 DB에 Connection 접근 권한을 부여하고 읽기, 새 페이지 삽입, 기존 내용 수정, 사용자 읽기 등 실제 필요한 capability를 관리자와 확인한다. Connection에 연결되지 않은 DB/관계는 404 또는 누락 속성으로 보일 수 있다.

```powershell
npm run setup
Copy-Item .env.example .env
notepad settings.json
notepad .env
```

setup은 기존 settings.json을 덮어쓰지 않는다. 경로가 없거나 설정 파일이 이미 있으면 실패하므로 직접 확인한다. settings.json의 사용자 이름/id, Git author, 경로 allowlist, Notion person UUID를 본인 값으로 바꾼다. user.id는 로컬 등록 소유자 키로 사용하므로 운영 중 임의 변경하지 않는다. Git author는 이름 또는 이메일의 대소문자 무시 완전 일치다. 설정 파일 안 상대 경로는 설정 파일 위치를 기준으로 해석한다.

Notion 사용자 ID는 표시 이름·이메일·커넥터 user:// 문자열을 복사해 추정하지 않는다. 회사 관리자에게 REST users의 실제 person UUID를 확인하거나, 토큰 설정 후 `node dist/cli.js users`로 API에서 확인한다. 조회 결과에는 해당 Connection이 볼 수 있는 사용자 이름과 ID가 포함된다. 타인 ID를 설정하지 않는다.

토큰은 .env의 NOTION_TOKEN 또는 서버 프로세스 환경변수에만 둔다. 개인 JSON에는 토큰 필드가 허용되지 않는다. .env·settings.json·.worksync는 gitignore에 포함되며 실제 비밀을 커밋하지 않는다. 기본 WORKSYNC_ALLOW_WRITE=false를 유지한다. 서버는 실행 파일 위치의 프로젝트 .env를 읽고 기존 환경변수를 우선한다. WORKSYNC_SETTINGS 환경변수로 개인 설정 파일의 절대 경로를 지정할 수 있다.

```powershell
npm run doctor
npm run test:integration
```

doctor는 읽기 전용 스키마/보기 조회, integration은 사용자 확인 후 같은 읽기 검사를 수행한다. 회사 기본 설정은 subitems:null이므로 **실제 하위 항목 쌍을 확인할 때까지 쓰기 가능 검사 실패가 정상**이다. [회사 POC](NOTION_POC.md)에 따라 기존 실제 관계와 verificationViewId를 설정한다. 그 후에만 별도 사용자 승인으로 실제 업무를 저장한다. DB나 속성을 새로 만드는 명령은 없다.

## 로컬 stdio 실행

```powershell
node C:/workspace/worksync-mcp/dist/index.js
```

stdio 서버는 MCP 클라이언트를 기다리므로 일반 시작 메시지가 없는 것이 정상이다. 직접 실행했으면 Ctrl+C로 종료한다. 인증/개인 설정 없이 확인할 때는 `node dist/index.js --demo`를 사용한다. `--demo`는 실제 쓰기를 항상 비활성화한다. 실제 연결 완료 여부와 demo 성공은 별개다.

## Codex

[공식 MCP 문서](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)에 따른 등록 예제다. 이 개발 과정에서 사용자의 Codex 설정을 자동 변경하지 않았다.

```powershell
codex mcp add worksync -- node C:/workspace/worksync-mcp/dist/index.js
codex mcp list
```

사용자 config.toml의 대안 예제는 [examples/codex.config.toml](../examples/codex.config.toml)이다. 이미 있는 파일에 해당 섹션만 추가한다. 토큰은 TOML에 넣지 않는다. CLI 등록 또는 수동 설정 중 하나를 사용한다. 앱을 다시 열거나 MCP 연결을 새로 고친 뒤 WorkSync의 6개 도구와 get_my_settings를 확인한다. 현재 실행한 것은 공식 SDK 클라이언트 테스트이며 Codex UI 연결은 미검증이다.

공통 Skill은 프로젝트의 `.agents/skills/worksync/SKILL.md`로 복사하거나 사용자의 공통 Skill 위치에 설치한다. 필요시 기존 폴더와 충돌을 확인한다. Codex에서 `$worksync 지난주 업무를 정리해 줘`로 사용할 수 있다.

```powershell
New-Item -ItemType Directory -Force .agents/skills | Out-Null
Copy-Item -Recurse skills/worksync .agents/skills/worksync
```

입력 예제는 이 저장소의 examples/sample-worklog.json을 참고하거나 MCP 도구의 입력 스키마를 확인한다. Skill 자체는 다른 파일을 복사하지 않아도 사용할 수 있다.

## Cursor

[공식 MCP 문서](https://cursor.com/docs/mcp)에 따라 작업 프로젝트의 `.cursor/mcp.json`에 [예제](../examples/cursor.mcp.json)의 mcpServers 섹션을 추가한다.

```json
{
  "mcpServers": {
    "worksync": {
      "command": "node",
      "args": ["C:/workspace/worksync-mcp/dist/index.js"],
      "env": { "WORKSYNC_SETTINGS": "C:/workspace/worksync-mcp/settings.json" }
    }
  }
}
```

환경별 실제 node.exe 경로가 필요할 수 있다. Cursor 설정의 MCP에서 6개 도구를 확인하고 get_my_settings → preview_worklog를 호출한다. `.cursor/skills/worksync/SKILL.md`에 공통 Skill을 두거나 해당 지침을 프로젝트 규칙에 연결한다. 기존 설정은 통째로 덮어쓰지 않는다. Cursor 앱에서의 연결은 미검증이다.

## Claude Code

[공식 MCP 문서](https://code.claude.com/docs/en/mcp)의 로컬 stdio 등록 형식이다.

```powershell
claude mcp add --transport stdio --scope user worksync -- node C:/workspace/worksync-mcp/dist/index.js
claude mcp get worksync
claude mcp list
```

Claude Code 안의 `/mcp`에서 연결과 도구를 확인한다. 공통 Skill을 `.claude/skills/worksync/SKILL.md`에 두고 `/worksync`를 사용하거나 프로젝트 지침으로 읽게 한다. Claude Code 앱에서의 연결은 미검증이다. `node` 직접 실행 예제이므로 npx용 cmd /c 래퍼가 필요하지 않다.

## 매주 사용하는 방법

사용자: “지난주 업무 노션에 등록해 줘.”

에이전트는 설정을 확인하고 Git/문서 근거에서 기능별 업무를 추출한다. 기간·완료 여부가 모호하면 사용자가 확인한다. find_existing_tasks와 preview_worklog의 한국어 결과에서 제목, 기간, 상태, 근거, 부모, 팀/담당자, 신규/수정/중복/확인 필요를 읽는다. 기본 save_worklog는 Dry Run이다.

실제 저장을 원하면 `.env`에서 WORKSYNC_ALLOW_WRITE=true를 지정하고 MCP 서버를 재시작한다. 쓰기 플래그만으로는 저장되지 않는다. 사용자가 자신의 별도 터미널에서 미리보기의 정확한 명령을 실행한다.

```powershell
cd C:\workspace\worksync-mcp
node dist/cli.js approve <previewId> <64자리-digest>
```

꺾쇠 자리표시자를 실제 미리보기 값으로 바꾼다. 실제 preview 응답에는 절대 경로를 포함한 approvalCommand가 있다. 커스텀 설정 파일을 썼다면 사용자 터미널의 WORKSYNC_SETTINGS도 응답의 approvalSettingsPath와 같게 설정한다. CLI에서 내용을 읽고 `승인 <해시 앞 12자리>`를 입력한다. 30분 안에 같은 previewId/digest로 에이전트가 save_worklog(dryRun:false)를 호출한다. 입력·설정·원격 업무가 바뀌면 새 미리보기와 승인이 필요하다. 에이전트가 승인 터미널을 대신 조작해서는 안 된다.

저장 결과의 operationId를 verify_worklog로 조회한다. API가 반환한 페이지 URL만 사용한다. 화면의 타임라인 막대와 프론트개발-지원 필터는 사용자가 별도로 확인한다. 날짜 속성 저장 성공만으로 화면 검증까지 성공했다고 표시하지 않는다.

## 문제 해결

| 증상                              | 조치                                                                                                                                |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 시작 즉시 종료                    | npm run build, 개인 settings.json과 WORKSYNC_SETTINGS 경로 확인                                                                     |
| 401/403/404                       | 토큰·Connection capability·DB 공유 확인. 토큰을 채팅에 붙이지 않기                                                                  |
| SUBITEMS_UNCONFIRMED/UNSUPPORTED  | doctor의 REST 속성/보기와 Notion UI 실제 하위 항목 관계 확인. 임의 관계로 변경 금지                                                 |
| 새로운 상태 옵션 오류             | 기존 상태 문자열 사용. 새 옵션 자동 생성 안 함                                                                                      |
| APPROVAL_REQUIRED/PREVIEW_EXPIRED | 별도 터미널 승인 또는 새 미리보기 필요                                                                                              |
| STALE_PREVIEW                     | 기존 업무가 변경됨. 변경된 내용으로 다시 미리보기/승인                                                                              |
| Git 결과 없음                     | 작성자 완전 일치, 브랜치, 기간과 dateField 확인. 커밋은 자동 fetch하지 않음                                                         |
| 커밋 링크 null                    | 원격 없거나 미확인 상태. verifyRemoteUrls=true는 읽기 전용 ls-remote와 원격 추적 참조를 비교; 미확인 시 URL 생성 안 함              |
| SAVE_UNCERTAIN                    | history로 작업 확인. 같은 미리보기 재시도로 원격 마커를 읽어 복구 가능. 새 업무로 만들지 않기                                       |
| SAVE_LOCKED                       | 다른 저장 완료 대기. 프로세스가 죽었다면 모든 WorkSync 인스턴스를 종료하고 history/Notion 실제 이력을 확인한 뒤 아래 로컬 잠금 해제 |

```powershell
node dist/cli.js history
node dist/cli.js recover-lock
```

recover-lock은 현재 로컬 잠금과 미완료 이력을 보여주고 대화형 확인 후 잠금만 해제한다. 출처 예약/저장 이력은 삭제하지 않는다. 응답이 유실되었다면 verify_worklog(operationId)로 원격 마커와 승인 속성을 다시 읽어 로컬 이력을 복구할 수 있다. 이 읽기 복구는 미리보기 만료 후에도 가능하며 Notion에 쓰지 않는다. 결과 불명확 예약을 지워서 재생성하면 중복될 수 있다. 실제 저장이 없었는지 확정할 수 없다면 중단하고 관리자와 점검한다.

자동 테스트에는 실제 Notion 쓰기 명령이 없다. 실제 회사 연동 쓰기는 승인한 업무 미리보기의 save_worklog로만 진행한다.
