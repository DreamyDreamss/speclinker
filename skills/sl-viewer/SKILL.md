---
name: sl-viewer
description: SpecLens — speclinker 산출물 웹 뷰어 실행 (대시보드·INF/UIS/SCH·IA 트리)
argument-hint: [port]
---

# /sl-viewer — SpecLens (스펙 웹 뷰어) 실행

**SpecLens** — speclinker RECON 산출물을 브라우저에서 탐색하는 Docsify 기반 웹 뷰어를 시작한다.

> 구 Obsidian 기반 뷰어는 폐기되고 이 SpecLens(Docsify)로 대체됨.

---

## STEP 1 — spec_index.json 갱신 + 뷰어 자산 동기화

```bash
!python {PLUGIN_PATH}/scripts/gen_docsify.py .
```

> 이 스크립트가 `docs/viewer/spec_index.json` 생성과 함께 부트스트랩 자산
> (`index.html`·`docsify-sl.js`·`sl-theme.css`)을 플러그인에서 프로젝트
> `docs/viewer/`로 자동 복사한다.

---

## STEP 2 — 뷰어 서버 시작 (⚠️ 반드시 프로젝트 루트에서, **백그라운드**)

```bash
!python -m http.server {port|5173}
```

> **반드시 백그라운드로 실행한다**(Bash `run_in_background: true`). 포그라운드로 띄우면 세션이
> 막혀 STEP 3(SR 보드)의 MCP·CDP 작업을 이어서 못 한다.

> **서빙 루트 = 프로젝트 루트.** 문서(`docs/05_설계서/...`, `docs/00_FUNC/...` 등 docs 전체)와
> 루트 리소스(`.speclinker/sprint-status.yaml`)가 모두 한 서버 루트 아래 있어야
> INF·UIS·FUNC 클릭 라우팅이 동작한다. `--directory docs/viewer`처럼 하위 폴더를
> 루트로 잡으면 문서가 서빙 루트 밖이 되어 클릭 시 404가 난다.

접속: **`http://localhost:{port|5173}/docs/viewer/index.html`**

---

## STEP 3 — SR 작업보드 (선택 — `NETWORK=open` + `MCP_JIRA` + CDP Chrome)

> 담당 지라 SR을 보드에 띄우고, 화면 버튼으로 영향분석·AIDD(`/sl-change`)를 트리거한다.
> **새 명령어 없음** — `/sl-viewer` 세션이 MCP(지라)+CDP(SpecLens)를 둘 다 쥐고 있으므로 이 세션이 직접 처리한다.
>
> **전제**: SpecLens를 띄운 Chrome이 `--remote-debugging-port=9222`로 떠 있을 것(캡처와 동일).
> MCP·CDP 권한은 이 세션에만 있으므로 **세션이 살아있는 동안** 라이브로 동작한다(닫으면 마지막 `sr_board.json` 정적 폴백).

### 3-1. 지라에서 내 SR 수집 (MCP)
```
mcp-atlassian 호출:
  tool: jira_search
  args: { jql: "assignee = currentUser() AND project = {PROJECT} AND statusCategory != Done ORDER BY updated DESC",
          fields: "summary,status,priority,assignee,issuetype,updated", limit: 50 }
```
각 이슈 → `{ key, summary, status, priority, assignee, jira_url(=<JIRA_URL>/browse/<key>), updated }`.

### 3-2. SR별 영향 범위 + 자료 충분도 산정 (zero-LLM)
**영향**: 각 SR 요약/설명에서 엔티티를 뽑아 영향 슬라이스를 계산한다:
```bash
!python "{PLUGIN_PATH}/scripts/build_change_context.py" "<SR 요약+설명 텍스트>" --json
```
→ 영향 INF/SCH/UIS/FUNC ID 목록을 각 카드 `impact`에 채운다. (그래프 미존재 시 spec_index 키워드 매칭 폴백)

**자료 충분도**: 부실 SR/DRM 첨부를 감지해 "⚠ 보강 필요"를 띄운다. SR 도시에(`docs/변경관리/{SR}/`)를 점검:
```bash
!python "{PLUGIN_PATH}/scripts/scan_sr_material.py" . --sr <SR-KEY>
```
→ 산출 `{state(ok|thin|drm),note,dossier_path,attachments,inputs}`를 각 카드 `material`에 채운다.
(thin=본문 부실+첨부없음, drm=첨부 추출불가, ok=본문 충분 or 사용자 inputs/ 보강 있음)

### 3-3. 보드 데이터 작성 + 화면 주입
`docs/viewer/sr_board.json`을 아래 형식으로 쓰고 CDP로 주입한다:
```jsonc
{ "generated_at":"<ISO>", "project":"{PROJECT}", "jql":"<위 JQL>",
  "srs":[ { "key","summary","status","priority","assignee","jira_url","updated",
            "description"(선택), "impact":{"inf":[],"sch":[],"uis":[],"func":[]}, "suggested":"/sl-change <key>" } ] }
```
```bash
!node "{PLUGIN_PATH}/scripts/sl_board_cdp.js" inject docs/viewer/sr_board.json
```
→ SpecLens 사이드바 **📋 SR 작업보드**에 칸반으로 표시된다.

### 3-4. 버튼 클릭 처리 루프 (큐 폴링)
화면 버튼은 `window.__slQueue`에 의도만 쌓는다. 세션이 주기적으로 비워 처리한다:
```bash
!node "{PLUGIN_PATH}/scripts/sl_board_cdp.js" poll
```
반환 `requests[]`의 각 `{sr, action}` 분기:
| action | 처리 |
|--------|------|
| `sync` | 3-1~3-3 재수행(지라 재조회→주입) |
| `analyze` | 해당 SR `build_change_context` 재계산 → 카드 impact 갱신 후 inject |
| `change` | **`/sl-change <sr>` 실행** — 단계마다 `sl_board_cdp.js status`로 진행 주입(분석중→승인대기→구현중→QA→완료) |
| `approve`/`reject` | 진행 중인 sl-change 게이트에 사람 결정 반영 후 계속/중단 |
| `open-dossier` (`target`=SR) | `docs/변경관리/{SR}/inputs/` **없으면 생성** + OS 탐색기로 폴더 열기(`explorer`/`open`/`xdg-open`) → 사용자가 캡처·메모 투입. (DRM/부실 SR 보강용) |
| `refresh-material` (`target`=SR) | `scan_sr_material.py --sr {SR}` 재실행 → 카드 `material` 갱신 후 inject(보강 반영) |
| `regen-spec` (`target`=스펙ID, `kind`=inf/sch/uis/srs) | **그 스펙 1개만 재생성**(아래 STEP 5) — 백업→삭제→해당 speclinker 단계 재실행(멱등)→`gen_docsify`→상태 주입 |

---

## STEP 5 — 개별 스펙 재생성 (화면 [🔄 재생성] 버튼)

> SpecLens에서 INF/SCH/UIS/SRS 상세를 열면 연결관계 패널에 **[🔄 재생성]** 버튼이 있다.
> 누르면 큐에 `{action:'regen-spec', target:<ID>, kind:<inf|sch|uis|srs>}`가 쌓이고(STEP 3-4 poll이 픽업),
> 세션이 **그 스펙 1개만** 재생성한다. 기존 멱등성(group_already_done / sch_todo)을 이용 — 대상만 지우면 그것만 다시 만들어진다.

**공통 안전 절차**: 대상 파일을 `_tmp/regen_backup/`에 백업 → 삭제 → 재생성 → 실패 시 백업 복원. 진행상태는 `sl_board_cdp.js status`로 주입(재생성중→완료/실패).

| kind | 처리 (target=스펙ID) |
|------|---------------------|
| `inf` | `docs/05_설계서/{도메인}/INF/{ID}.md` 백업·삭제 → `dispatch_inf_gen.py .`(없으면 STEP1 scan 후) → 삭제분만 재생성 |
| `sch` | `docs/05_설계서/{도메인}/SCH/{ID}.md` 백업·삭제 → `build_sch_todo.py`→`build_sch_static.py`→`dispatch_sch_gen.py`→`link_inf_sch_new.py`(누락 테이블만) |
| `uis` | `docs/05_설계서/{도메인}/UIS/{ID}_*/` → `/sl-recon-uis`로 그 화면만 재캡처+ddd-ui-agent (Chrome CDP 필요) |
| `srs` | `/sl-recon-doc` 9-0+9-3(srs-agent) 재실행 → SRS 재생성(현재 SRS는 색인 단위라 SRS_v1.0 갱신) |

재생성 후:
```bash
!python "{PLUGIN_PATH}/scripts/gen_docsify.py" .          # spec_index 갱신
!node "{PLUGIN_PATH}/scripts/sl_board_cdp.js" status _tmp/regen_status.json   # {ID:{state:'완료'}} 주입
```
그리고 사용자가 화면에서 해당 스펙을 새로고침하면 갱신된 내용이 보인다.

> **정밀도**: INF/SCH는 *그 파일 1개*만 깔끔히 재생성된다(멱등). UIS는 재캡처(세션·CDP 필요), SRS는 색인 단위 재생성.
> 변경 *감지*(어느 스펙이 낡았는지 자동 판별)는 추후 **git diff 기반**으로 별도 제공 예정 — 현재는 사용자가 보고 직접 [재생성].

진행상태 주입 예:
```bash
!python -c "import json;json.dump({'<SR>':{'state':'구현중','step':'dev-agent','updated':'<ISO>'}}, open('_tmp/board_status.json','w',encoding='utf-8'),ensure_ascii=False)"
!node "{PLUGIN_PATH}/scripts/sl_board_cdp.js" status _tmp/board_status.json
```

> **손 안 대고 운영**하려면 `/loop`로 3-4 폴링을 주기 실행한다(예: 5초). 단 `/sl-change`의
> **사람 승인 게이트는 유지**된다 — 게이트 도달 시 `state=승인대기`로 주입하고, 화면 [승인]/[반려]
> 버튼이 큐로 결정을 보내면 그때 진행한다(자동 폭주 없음).

> **보안**: CDP 다리는 페이지 read/write만 한다. 실제 코드 변경은 세션이 sl-change/sl-aidd
> 게이트를 거쳐 수행하며, 큐에는 *의도(intent)*만 담긴다 — 브라우저發 임의 실행 경로는 없다.

---

## 사용 방법

브라우저에서 `http://localhost:5173/docs/viewer/index.html` 접속:

- **대시보드** (v4): 산출물 통계 카드 + 도메인별 **커버리지 링 카드**(스펙 완성도 %) + **연결 갭 배지**(화면-API/API-테이블 미연결) + stale 경고.
- **목록 뷰**: 도메인 선택 → 탭(INF/UIS/SCH/기능명세) + **필터 바** + 각 행 ⛁연결테이블·⚓앵커 배지. (좌측 사이드바엔 도메인별 ⬡INF ▭UIS ⛁SCH 카운트)
- **글로벌 검색**: 사이드바 상단 검색창에 INF·화면·테이블·경로 입력 → 즉시 점프.
- **도메인 탭**: 사이드바에서 도메인 선택 → INF/UIS/SCH(/BAT) 탭 전환. BAT는 산출물 있을 때만 표시.
- **상세 + 연결관계 패널**: INF/UIS/SCH 카드 클릭 → Docsify 렌더링 + **브레드크럼** + 우측 **🔗 연결관계 패널**(UIS=호출 API/관련 테이블, INF=관련 테이블/사용 화면, SCH=참조 API, 공통 linked FUNC, 클릭 시 이동). FUNC 크로스링크/칩도 이동 가능.
- **🕸 연결 그래프**: 연결관계 패널의 "🕸 그래프" 버튼 → 현재 스펙을 시작점으로 UIS→INF→SCH→FUNC를 N-hop(깊이 1~3) mermaid 그래프로 탐색. 노드 클릭 시 해당 스펙으로 이동.
- **📖 도메인 개요**: 도메인 뷰 헤더의 OVERVIEW 링크 → 신규자용 도메인 SOP 내러티브.
- **화면(UIS) 보기**: 카드 미리보기 확대 + 상세 본문 이미지 **클릭 시 라이트박스 확대**(ESC 닫기).
- **IA 트리**: 사이드바 [IA 트리] 버튼 → 메뉴 계층으로 화면 탐색.
- **반응형/접근성**: 좁은 화면(≤900px)은 ☰ 사이드바 토글, 키보드(Tab/Enter/Space) 내비게이션 지원.

> 연결관계 패널·갭 배지는 `gen_docsify.py`가 인덱스에 보강하는 관계 필드(`uis.inf_ids`·`inf.sch_ids`·`*.func`·`gaps`)에 기반한다. 데이터가 없으면 해당 섹션은 자동 생략된다.

**spec_index.json 최신화**: 새 INF/UIS 생성 후 STEP 1 재실행 → 브라우저 새로고침.
