# SpecLens SR 작업보드 (엔터프라이즈 업무용) — 설계

> 2026-06-07 · 승인됨. SpecLens를 "스펙 뷰어"에서 **SR(변경요청) 기반 업무 콘솔**로 확장.

## 목표
운영 시스템 담당자가 SpecLens에서 **본인 담당 지라 SR 목록을 보고, 각 SR의 영향 범위(INF/SCH/UIS/FUNC)를 확인하고, 버튼으로 AIDD(/sl-change) 작업을 트리거·승인**할 수 있게 한다. 대충 만들지 않는다 — 로딩/빈/오프라인 상태, 필터/검색, 상세 드로어, 진행상태 배지, 키보드 접근성, 우아한 정적 폴백을 모두 갖춘다.

## 아키텍처 — 서버 없음, CDP 통신
```
[SpecLens 탭(정적)] ──CDP(9222)── [/sl-viewer 세션] ──MCP──▶ 지라
  window.__slBoard  (주입받아 렌더)      sl_board_cdp.js inject/poll/status
  window.__slStatus (진행상태)           세션이 MCP풀·영향계산·/sl-change 실행
  window.__slQueue  (버튼클릭 적재)      poll로 큐 비우고 처리
```
- **새 명령어 없음.** `/sl-viewer` 하나가 ①자산/인덱스 ②서버(백그라운드) ③SR 보드(MCP풀→CDP주입→큐폴링)까지.
- 통신 상대는 서버가 아니라 **브라우저(Chrome 디버그 9222)** — 기존 캡처가 쓰는 검증된 채널.
- 세션 살아있는 동안 라이브. 죽으면 마지막 `sr_board.json` 정적 폴백(읽기 전용).

## 데이터 계약
```jsonc
// docs/viewer/sr_board.json (세션이 작성, 뷰어가 부팅 시 폴백 로드 / CDP가 라이브 주입)
{ "generated_at":"...", "project":"NKSHOP", "jql":"assignee=currentUser() AND ...",
  "srs":[ { "key":"SR-1234","summary":"주문검색추가","status":"In Progress","priority":"High",
            "assignee":"홍길동","type":"SCREEN_MODIFY","jira_url":"https://.../SR-1234","updated":"...",
            "impact":{ "inf":["INF-ORD-002"],"sch":["SCH-ORD-001"],"uis":["UIS-ORD-001"],"func":["FUNC-order-002"] },
            "suggested":"/sl-change SR-1234" } ] }
// window.__slStatus (라이브 진행)
{ "SR-1234":{ "state":"분석중|승인대기|구현중|QA|완료|실패","step":"...","gate":"질문","log_tail":"...","updated":"..." } }
// window.__slQueue (버튼→세션)  ; 세션 poll이 비움
[ { "id":"q-<ts>","sr":"SR-1234","action":"sync|analyze|change|aidd|approve|reject","ts":"..." } ]
```

## 컴포넌트
### 1. 뷰어 보드 UI (`docsify-sl.js` + `sl-theme.css`)
- 사이드바 nav: **📋 SR 보드** → `SlViewer.showBoard()`.
- `renderBoard()` → `#sl-main`에 칸반:
  - 툴바: 프로젝트·JQL·마지막 동기화시각 + **⟳ 동기화** + 우선순위/상태 필터 + 텍스트 검색.
  - 컬럼(지라 status→정규화): 대기 / 분석 / 진행 / 검토 / 완료.
  - SR 카드: 우선순위 점·`key`(지라 링크)·요약·상태 + **영향칩**(⬡INF n ⛁SCH n ▭UIS n ◆FUNC n, 클릭→`goToId`) + **진행 배지**(`__slStatus`) + 액션 버튼.
  - 액션: `[영향분석]`(로컬 그래프) · `[AIDD 시작]`(enqueue `change`) · 게이트 시 `[승인]`/`[반려]`.
- 상세 드로어: 카드 클릭 → 우측 패널(전체 설명·영향 목록 클릭이동·진행 로그).
- 상태: 로딩/빈("/sl-viewer로 지라 동기화 필요")/오프라인(정적 폴백 안내).
- 보드 활성 동안 3초 틱으로 `__slBoard/__slStatus` 변동 시 재렌더(세션 주입 반영, 견고성).
- 버튼은 `window.__slQueue`에 push만 — 즉시 "요청됨" 피드백.

### 2. CDP 워커 (`scripts/sl_board_cdp.js`, playwright — capture 패턴 재활용)
- `inject <board.json>`: SpecLens 탭 찾아 `window.__slBoard=data; SlViewer.renderBoard()`.
- `status <status.json>`: `window.__slStatus` 병합 + 재렌더.
- `poll`: `window.__slQueue` 읽어 비우고 JSON 출력(세션이 받아 처리).
- 127.0.0.1:9222, 탭 URL `docs/viewer/index.html` 매칭.

### 3. `/sl-viewer` 확장 (`skills/sl-viewer/SKILL.md`)
- STEP 2: `http.server`를 **백그라운드** 실행(세션이 이어서 작업).
- STEP 3(신규, NETWORK=open + MCP_JIRA): SR 보드 루프
  - 풀: 지라 MCP `jira_search`(JQL) → 각 SR `build_change_context.py`로 영향 슬라이스 → `sr_board.json` → `sl_board_cdp.js inject`.
  - 큐 처리: `sl_board_cdp.js poll` → 요청별 분기(sync=재풀 / change=`/sl-change <SR>` / approve=게이트 진행) → `status` 주입. 손 안 대려면 `/loop`.

## 안전
- CDP 워커는 페이지 read/write만. AIDD 실행은 세션이 **sl-change/sl-aidd 사람 승인 게이트** 거쳐 수행(자동 폭주 없음).
- 9222 로컬 전용. 큐는 의도(intent)만 — 임의 코드 실행 경로 없음.

## 단계
- **P1**: 보드 UI(`renderBoard`+훅+CSS) + 정적 폴백(`sr_board.json` fetch) + `sl_board_cdp.js`.
- **P2**: `/sl-viewer` STEP3(MCP풀·영향·inject) + 큐 폴링 처리.
- **P3**: 상세 드로어·승인 게이트 보드 연동·진행 로그.

## 검증
- `node --check` (docsify-sl.js, sl_board_cdp.js).
- 정적 픽스처 `sr_board.json`으로 보드 렌더 수동 확인(CDP 없이 폴백 경로).
- CDP inject/poll 왕복은 실 브라우저(9222) 필요 — 사용자 세션 검증.
