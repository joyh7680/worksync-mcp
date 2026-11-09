# WorkSync

기존 AI 에이전트가 정리한 업무를 사용자 확인과 별도 승인 후 **기존 Notion 간트차트의 실제 직접 하위 항목**으로 등록하는 로컬 stdio MCP 서버입니다. 개발·콘텐츠·경영지원팀이 같은 업무 형식을 사용합니다. 자체 LLM이나 유료 AI API는 호출하지 않습니다.

**실행 가능한 로컬 MVP와 Mock 검증을 제공합니다. 회사 DB의 실제 Sub-item 관계와 REST 인증은 추가 확인이 필요하며, 실제 회사 쓰기는 수행하지 않았습니다.** 관계를 확인하지 못하면 저장을 차단합니다.

## 빠른 시작

Windows PowerShell, Node.js 22.13 이상과 Git이 필요합니다.

```powershell
cd C:\workspace\worksync-mcp
npm ci
npm run typecheck
npm run build
npm test
npm run demo
```

demo는 토큰 없이 실제 stdio MCP 프로세스를 연결하고 6개 도구 목록·Mock 미리보기·Dry Run·미승인 저장 차단을 확인합니다. 실제 Notion 연결로 전환하려면 아래 개인 설정을 준비하세요.

```powershell
npm run setup
Copy-Item .env.example .env
notepad settings.json
notepad .env
npm run doctor
```

회사가 승인한 Notion 내부 Connection을 만들고 대상 DB 접근을 허용한 뒤 NOTION_TOKEN을 .env 또는 환경변수에 넣습니다. settings.json에는 팀·실제 Notion person ID·허용 Git 경로·작성자·DB/data source·허용 부모를 설정합니다. 예제의 회사 ID는 조회 후보이며 doctor의 REST 응답으로 재확인합니다. subitems:null은 안전한 기본값입니다. [설치 안내](docs/INSTALL.md)와 [회사 Notion POC](docs/NOTION_POC.md)를 따라 실제 하위 항목 속성과 보기를 확인하세요.

## 동작

AI 에이전트가 읽을 수 있는 Git/문서/콘텐츠/현재 대화에서 수행한 업무만 분류합니다. WorkSync가 입력과 기존 업무를 검증한 뒤 한국어 미리보기를 만듭니다. 사용자는 제목·기간·상태·근거·부모·팀/담당자를 확인합니다. 기본 저장은 Dry Run이며 실제 쓰기는 미리보기 내용 해시와 연결된 별도 터미널 승인이 필요합니다. 저장 후 날짜·부모 양방향 관계·담당자·팀·중복을 다시 읽고 API가 반환한 Notion 링크를 돌려줍니다.

“지난주 업무 노션에 등록해 줘” 요청 시 서울 기준 지난주 월~일을 사용합니다. 2026-11-09 기준으로는 11/02~11/08입니다. 커밋이 관찰된 날짜는 실제 전체 착수·완료 기간과 구분합니다. 문서 수정 시각만으로 완료를 추정하지 않고 날짜·완료 근거가 없으면 확인 필요로 분류합니다.

## 도구

| MCP Tool             | 기능                                                                        |
| -------------------- | --------------------------------------------------------------------------- |
| get_my_settings      | 사용자·팀·기본 부모·Git·지난주 기간, live/mock 모드 조회                    |
| collect_git_evidence | 읽기 전용 Git, 작성자/브랜치/기간/폴더 필터, 선택적 diff와 확인된 커밋 URL  |
| find_existing_tasks  | 허용 부모의 실제 직접 하위 항목·제목·설명·원본 근거 조회                    |
| preview_worklog      | 신규 생성·기존 업무 업데이트·중복 제외·확인 필요, 고정 버전/해시 생성       |
| save_worklog         | 기본 Dry Run, 별도 승인한 정확한 버전만 저장, 영속 멱등성/원본 예약         |
| verify_worklog       | DB·data source·부모/자식 관계·실제 날짜 속성·담당자·팀·중복·반환 URL 재검증 |

업무 입력 예제는 [sample-worklog.json](examples/sample-worklog.json), 공통 에이전트 규칙은 [skills/worksync/SKILL.md](skills/worksync/SKILL.md)입니다. Git 근거는 전체 해시와 일관된 sourceId, 문서는 실제 원본 ID를 사용합니다. 내용이 같은 커밋을 다른 sourceId로 바꾸면 다른 자료로 인식될 수 있으므로 원본 식별자를 일관되게 사용하세요.

## AI 도구 연결

```powershell
codex mcp add worksync -- node C:/workspace/worksync-mcp/dist/index.js
codex mcp list
```

Codex 수동 TOML, Cursor `.cursor/mcp.json`, Claude Code `claude mcp add --transport stdio`와 Skill 설치 방법은 [도구별 설치 가이드](docs/INSTALL.md)에 있습니다. 도구별 공식 문서를 확인해 예제를 작성했으며, 실제 검증한 것은 공식 MCP SDK 클라이언트입니다. Codex·Cursor·Claude Code 앱에서의 연결 완료를 의미하지 않습니다. 사용자 앱 설정을 자동 변경하지 않았습니다.

## 실제 승인과 저장

preview_worklog의 승인 명령을 **사용자가 별도 터미널에서 직접** 실행합니다. 30분 유효한 미리보기 전체를 보고 `승인 <digest 앞 12자리>`를 입력합니다. .env의 WORKSYNC_ALLOW_WRITE=true와 서버 재시작도 필요합니다. 그 뒤 에이전트가 같은 previewId/digest로 save_worklog(dryRun:false)를 호출합니다. approved:true 입력으로 저장할 수 없습니다. 날짜/업무/설정이 바뀌면 새 승인, 기존 원격 업무가 바뀌면 새 미리보기가 필요합니다.

## 폴더

```text
worksync-mcp/
  src/
    index.ts, cli.ts, app.ts
    mcp/server.ts
    git/                 Git 조회·커밋 파싱·필터
    notion/              SDK·스키마·하위 항목·날짜·매핑·Mock
    services/            승인·중복·SQLite·업무 저장
    config/, schemas/    개인 설정·업무 입력
  skills/worksync/SKILL.md
  examples/              입력·개인 설정·AI 연결 예제
  tests/                 실제 임시 Git + Mock Notion/API
  scripts/smoke.mjs       빌드된 stdio 서버 통합 검사
  docs/INSTALL.md, ARCHITECTURE.md, NOTION_POC.md, VALIDATION.md
  .env.example, .gitignore, package.json, package-lock.json
```

스택: TypeScript 6, 공식 MCP v2 @modelcontextprotocol/server 2.4.0, @notionhq/client 5.31.1, Zod 4.6.7, Vitest 5.1.0, Node SQLite. 재현 가능한 버전은 package-lock.json에 고정했습니다. 공식 API 자료와 설계는 [아키텍처](docs/ARCHITECTURE.md)를 참고하세요.

## 구현 상태와 제한

| 범위                                                    | 상태                              |
| ------------------------------------------------------- | --------------------------------- |
| TypeScript 프로젝트·MCP 6개 도구·Git 읽기               | 구현 완료, 로컬 실행 검증         |
| 입력 검증·중복 분류·미리보기·별도 승인·Dry Run          | 구현 완료, Mock 검증 완료         |
| Notion 생성·수정·날짜 저장·재조회·재시도·응답 유실 복구 | 구현 완료, Mock 검증 완료         |
| 회사 DB·부모·날짜·기존 옵션 조회                        | 연결된 커넥터로 읽기 확인         |
| 회사 REST 토큰·실제 Sub-item 쌍·프론트개발-지원 보기    | 실제 연동 확인 필요               |
| 회사 DB 실제 쓰기·타임라인 막대                         | 미실행, 실제 연동/화면 확인 필요  |
| OAuth·공용 원격 HTTP 서버·조직 권한 격리                | 미구현, 인터페이스/확장 설계 제공 |

설정과 승인은 로컬 OS 계정 신뢰에 기반하며 강한 사용자 인증이 아닙니다. Notion의 배치 트랜잭션·CAS가 없어 일부 성공과 외부 동시 수정 경쟁을 완전히 제거할 수 없습니다. 불명확한 저장은 중복 방지를 위해 자동 재생성을 차단합니다. Git 근거는 최대 200개 응답·5000개 검사 범위, 기본 diff 제외·민감 경로/크기 제한이 있으며 모든 민감정보를 탐지한다고 보장하지 않습니다. 네트워크 fetch/push는 하지 않으며 선택적 URL 검증에서 ls-remote만 실행합니다.

기존 DB·속성·선택 옵션·보기를 생성/수정/삭제하는 기능은 없습니다. 리드는 기존 값을 보존합니다. API 날짜 속성 검증은 실제 타임라인 막대나 특정 보기 노출 검증과 다릅니다. 문제별 해결 방법, 저장 이력/잠금 복구는 [설치 안내](docs/INSTALL.md#문제-해결)를 참고하세요.

공식 자료: [MCP SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/), [Notion 데이터 소스](https://developers.notion.com/reference/retrieve-a-data-source), [Notion Subtask 보기 설정](https://developers.notion.com/guides/data-apis/working-with-views#subtask-configuration), [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli), [Cursor MCP](https://cursor.com/docs/mcp), [Claude Code MCP](https://code.claude.com/docs/en/mcp).
