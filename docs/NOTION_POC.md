# 회사 Notion 연동 기술 검증

확인일: 2026-11-09 (Asia/Seoul). 실제 회사 데이터 쓰기는 **0건**이다.

## 읽기 전용으로 확인한 사실

연결된 Notion 커넥터의 fetch로 메인 DB, 데이터 소스, 부모 페이지를 읽었다. 이는 WorkSync의 독립 REST Connection으로 실행한 검사가 아니다.

| 대상                | 확인 결과                                                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 메인 페이지         | [26 - 4Q 간트차트](https://www.notion.so/logibros/26-4Q-3f83188c425b807dada9cd1a0df35f8b)                                              |
| 데이터베이스        | `26 - 4Q 간트차트 DB (절대 삭제금지)`                                                                                                  |
| DB ID 후보          | `2b53188c-425b-82c3-9b6a-817ad6c672ae` — 커넥터 DB/부모 경로에서 확인. REST로 재확인 필요                                              |
| 데이터 소스 ID 후보 | `93f3188c-425b-8263-bbea-073f6063b4a1` — 커넥터에서 확인. REST로 재확인 필요                                                           |
| 부모 업무           | [개발 (1)](https://app.notion.com/p/2a63188c425b828ab8b28194c885c43f)                                                                  |
| 날짜                | `시작일`, `종료일`: date                                                                                                               |
| 기본 매핑           | 업무명 title, 설명 text(REST rich_text 여부 재확인), 단계 select, 상태 select, 팀 multi_select, 참여자 person(REST people 여부 재확인) |
| 기존 옵션           | `5. 세부 할 일`, `04. 프론트`, `진행 중`, `완료`, `논의 필요` 존재                                                                     |
| 기존 관계 속성      | Objective, 프로젝트, 선행/후속 작업 등 노출. **어느 것이 실제 Sub-item 관계인지는 미확인**                                             |
| 보기                | DB fetch에는 Default view만 노출. subitemDisplayMode=show지만 관계 ID 없음                                                             |
| 요청된 보기         | `프론트개발-지원`의 실제 view ID·필터·타임라인 설정 미확인                                                                             |

커넥터의 부모 경로에는 이전 분기 제목이 섞여 있지만, DB 직접 조회 결과는 요청된 제목이었다. 예제 ID는 초기 조회 후보이며, 제목이나 커넥터 내부 URL을 REST 사실로 간주하지 않는다.

`개발 (1)`의 Objective/프로젝트 속성은 관찰했으나 이를 진짜 Sub-item 관계라고 추정하지 않았다. 커넥터가 반환한 `collection://`, `view://`, `user://` 주소를 REST 요청 인자로 사용하지 않았다. 공개 API에는 검증된 UUID와 실제 속성 ID를 전달한다.

## 공식 API와 활성화 조건

[데이터 소스 API](https://developers.notion.com/reference/retrieve-a-data-source)는 REST 스키마를 제공한다. [보기 API의 Subtask configuration](https://developers.notion.com/guides/data-apis/working-with-views#subtask-configuration)은 `configuration.subtasks.property_id`로 하위 항목 표시 관계를 제공한다. WorkSync는 다음 조건을 모두 검사한다.

1. REST로 database와 data source의 소속 관계가 확인됨.
2. 관리자가 Notion UI의 기존 하위 항목 설정에서 부모/자식 방향을 확인하여 속성 ID를 설정함.
3. 두 속성이 같은 데이터 소스를 가리키는 서로 연결된 dual_property 자기 참조 relation임.
4. verificationViewId를 REST로 조회했을 때 Sub-item 관계 property_id가 해당 쌍에 속함. 비활성 보기/누락 메타데이터는 중단.
5. 부모 페이지가 허용 목록에 있고 같은 데이터 소스에 있음. Notion 사용자/기존 선택 옵션을 확인함.
6. 사용자 승인 후 생성한 페이지의 부모 관계, 부모 쪽 자식 관계, 날짜·팀·상태·참여자를 다시 읽어 검증함.

실제 DB가 단방향 relation만 노출하거나 보기 메타데이터에서 관계를 확인할 수 없으면 MVP는 `SUBITEMS_UNSUPPORTED` 또는 `SUBITEMS_UNCONFIRMED`로 저장을 중단한다. API 자체가 모든 환경에서 하위 항목을 지원하지 않는다는 결론은 아니다. 현재 회사 환경은 **실제 연동 확인 필요**다. 테스트한 Mock 환경에서만 생성·수정·검증을 통과했다.

## 다음 실제 검사 순서

1. 회사가 승인한 내부 Connection을 해당 DB에 연결하고 NOTION_TOKEN을 로컬에 설정한다.
2. `npm run setup` 후 개인 ID, 경로, Notion 사용자 ID를 설정한다.
3. `npm run doctor`는 읽기 전용으로 REST 속성 ID와 보기를 출력한다. subitems:null이면 정보를 출력한 뒤 쓰기 가능 검증을 실패하는 것이 정상이다.
4. 담당자가 Notion UI에서 기존 Sub-item 부모/자식 속성을 확인한다. 기존 속성 이름을 임의로 맞추거나 새 relation을 만들지 않는다.
5. settings.json의 subitems를 아래 형식으로 설정한다. 필요하면 프론트개발-지원의 REST view ID를 targetViewId로 설정하여 필터를 미리보기에 표시한다.

```json
{
  "subitems": {
    "parentPropertyId": "실제 REST 부모 속성 ID",
    "childPropertyId": "실제 REST 자식 속성 ID",
    "verificationViewId": "하위 항목 관계가 노출되는 실제 REST 보기 UUID",
    "confirmedInNotionUi": true
  },
  "targetViewId": "프론트개발-지원 실제 REST 보기 UUID (선택)"
}
```

6. `npm run test:integration`에서 사용자가 `연결 검사`를 입력한다. 이 명령도 읽기 전용이다.
7. 실제 쓰기는 별도 승인한 업무 미리보기 한 건으로 진행한다. 이 개발 과정에서는 실행하지 않았다. Mock 예제 업무를 회사 DB에 전송하지 않는다.
8. API 재조회와 별개로 사용자가 Notion 화면에서 `개발 (1)`의 직접 하위 항목, 해당 보기의 사용자/팀 필터, 시작일·종료일을 이용하는 타임라인 설정과 막대를 확인한다.

REST로 실제 Sub-item 연결을 확인할 수 없다면 기존 DB 담당자에게 정확한 관계/접근 권한 확인을 요청하거나 Notion API의 해당 기능 지원을 기다린다. 본문 토글·새 DB·임의 relation으로 대체하지 않는다. 보기/스키마 자동 수정 기능도 없다.

## 검증 상태

| 기능                                 | 상태                                               |
| ------------------------------------ | -------------------------------------------------- |
| 회사 DB·부모·날짜·기존 옵션 읽기     | 커넥터 읽기 확인 완료                              |
| WorkSync REST Connection 인증        | 실제 연동 확인 필요 — NOTION_TOKEN 없음            |
| 실제 Sub-item 쌍·보기 관계 조회      | 실제 연동 확인 필요 — 커넥터 응답에 식별 정보 없음 |
| 실제 업무 생성·수정·날짜 저장        | Mock 검증 완료 / 회사 쓰기 미실행                  |
| 실제 부모·자식 양방향 재조회         | Mock 검증 완료 / 회사 실제 연동 확인 필요          |
| 프론트개발-지원 필터와 타임라인 막대 | 실제 화면 확인 필요                                |

이 문서는 실제 쓰기 검증 성공을 의미하지 않는다. 자동 테스트는 회사 DB에 접근하지 않는다.
