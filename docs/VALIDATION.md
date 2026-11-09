# 실행 검증 기록

2026-11-09, Windows PowerShell, 프로젝트 `C:/workspace/work-sync/worksync-mcp`에서 실행했다. 기존 상위 README와 Git 설정은 변경하지 않았다. 새 프로젝트 파일만 하위 폴더에 생성했다. 회사 Notion 쓰기는 실행하지 않았다.

## 환경과 설치

Node 26.12.1, npm 11.20.0. 공식 npm 패키지 버전을 조회한 뒤 실제 설치했다. TypeScript 6.0.3, MCP server/client 2.4.0, Notion client 5.31.1, Zod 4.6.7, Vitest 5.1.0, Prettier 3.9.10을 package-lock.json에 기록했다. 설치 시 npm audit 결과 취약점 0건이었다. Notion SDK의 기본 지원 API 버전과 같은 `2025-09-03`을 명시하고 자동 재시도를 끈 후 읽기/쓰기 특성별 재시도를 구현했다.

## 실제 실행한 검사

| 명령/검사                       | 결과                                                    |
| ------------------------------- | ------------------------------------------------------- |
| npm install                     | 성공                                                    |
| npm run typecheck               | 성공                                                    |
| npm run build                   | 성공, dist/index.js와 dist/cli.js 생성                  |
| npm test                        | 4개 테스트 파일, **44개 모두 통과**                     |
| npm run demo                    | 빌드된 서버와 공식 v2 클라이언트의 실제 stdio 연결 성공 |
| npm run format:check            | 성공                                                    |
| skill-creator quick_validate.py | Skill is valid!                                         |
| 기존 ../README.md git diff      | 변경 없음                                               |

최종 Vitest 실행: 2026-11-09 17:26 KST, 약 5.14초. 테스트의 Notion 저장은 메모리 Mock 또는 Mock fetch만 사용했다. 별도 대화형 승인 CLI를 사람이 실제 승인한 것으로 표시하지 않는다. 승인 검증 테스트는 TTY 여부·확인 문구·저장된 승인 상태를 모의 입력한다.

Skill 검증 도구에 필요한 PyYAML이 실행 환경에 없어 시스템 Python을 변경하지 않고 gitignore된 .worksync/skill-validation에 순수 Python 빌드로 설치하여 검증했다. 이는 WorkSync 실행 의존성이 아니다.

## 테스트 범위

- 실제 임시 Git 저장소: 작성자 이메일/이름, 서울 날짜 경계, author/committer 날짜 차이, 폴더와 실제 변경 파일, 선택적 diff, merge 제외, 없는 원격/미확인 커밋 URL, 허용 경로, 옵션 주입 거부, .env.local/credentials 등 민감 경로 제외.
- 업무 검증: 지난주 월~일과 연도 경계, 불가능한 날짜·역순 날짜, 전체 Git 해시, 필수 필드, 실제 DB/data source 및 Sub-item 보기 관계, 기존 선택 옵션만 사용.
- 승인: 승인 없는 저장, 비대화형/잘못된 문구, 다른 digest, 내용 변조, 만료, 설정 변경, 기본 쓰기 비활성화 차단.
- 저장: 신규 생성, 직접 부모·자식 양방향 관계, 실제 날짜·팀·참여자·상태 매핑, 진행률 percent 변환, 후속 수정과 기존 날짜 보호, 타인 업무 수정 거부.
- 중복/복구: 동일 Git 커밋·문서 재등록 방지, 같은 배치 근거 충돌, 같은 제목 자동 병합 금지, 유사 문자열 ID 자동 수정 금지, SQLite 영속성, 프로세스 간 저장 잠금, 응답 유실 마커 복구, 출처 사전 예약, 미리보기 만료 후 읽기 복구, 배치 일부 실패의 완료 결과 반환.
- Notion 경계: 429 Retry-After, 읽기 503 재시도, 쓰기 503/네트워크 오류 자동 재시도 금지, 인증 오류, 재시도 상한과 긴 대기 거부, 실제 SDK 요청 body, 속성 페이지네이션·불완전 커서 거부, 응답에 날짜/관계가 사라지는 경우 검증 실패, 오류본문 비밀 유출 방지.

## stdio 데모 결과

6개 도구 목록이 정확히 반환되었다. 설정 조회, 임시 Git 커밋 1건 수집, 기존 Mock 업무 조회, 신규 미리보기 1건, 기본 Dry Run 쓰기 **0건**, 미승인 실제 저장 **APPROVAL_REQUIRED** 차단을 확인했다. 잘못된 verify 작업 ID는 거부되었다. Mock 생성 후 성공한 verify는 Vitest에서 검증했다. CLI init의 설정 생성/덮어쓰기 방지와 비대화형 실제 integration 명령 차단도 데모에서 확인했다. stdio 테스트의 stderr는 비어 있었다.

## 실행하지 않은 검사

NOTION_TOKEN이 없어 WorkSync의 실제 REST 인증·회사 DB 쓰기를 실행하지 않았다. 연결된 Notion 커넥터로 대상 DB·부모·날짜 속성·기존 옵션만 읽었다. 실제 Sub-item 쌍/프론트개발-지원 보기 및 화면 타임라인은 미확인이다. 세부 결과와 다음 절차는 [NOTION_POC.md](NOTION_POC.md)에 있다.

Codex·Cursor·Claude Code의 사용자 설정을 자동 등록하지 않았으며 해당 앱 UI 연결은 미검증이다. 최신 공식 문서에 따른 설정 예제만 제공했다. OAuth/팀 공용 HTTP 서버·배포는 MVP 범위 밖으로 미구현이다.

## 프로젝트 경로와 Git 연결 정리

2026-11-09 사용자 요청으로 현재 프로젝트 루트를 `C:/workspace/worksync-mcp`로 정리했다. 실행 안내·환경변수 예제·Codex/Cursor/Claude Code 연결 예제도 현재 경로로 수정했다. 이전 경로는 위 최초 검증 기록에만 남겼다.

현재 경로에서 타입 검사, 빌드, Vitest 44개, stdio MCP 데모와 포맷 검사를 다시 실행해 모두 통과했다. 원격 `https://github.com/joyh7680/worksync-mcp.git`의 main 초기 커밋 이력을 기반으로 develop 브랜치를 구성했다. 개인 설정, 인증 토큰, SQLite 이력, node_modules, dist는 Git에서 제외했다.
