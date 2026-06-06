---
name: sl-viewer
description: SpecLens — speclinker 산출물 웹 뷰어 실행 (대시보드·INF/UIS/SCH·IA 트리)
argument-hint: [port]
---

# /sl-viewer — SpecLens (스펙 웹 뷰어) 실행

**SpecLens** — speclinker RECON 산출물을 브라우저에서 탐색하는 Docsify 기반 웹 뷰어를 시작한다.

> 구 Obsidian 기반 뷰어(`gen_obsidian_index.py`)는 deprecated — 이 스킬로 대체됨.

---

## STEP 1 — spec_index.json 갱신 + 뷰어 자산 동기화

```bash
!python {PLUGIN_PATH}/scripts/gen_docsify.py .
```

> 이 스크립트가 `docs/viewer/spec_index.json` 생성과 함께 부트스트랩 자산
> (`index.html`·`docsify-sl.js`·`sl-theme.css`)을 플러그인에서 프로젝트
> `docs/viewer/`로 자동 복사한다.

---

## STEP 2 — 뷰어 서버 시작 (⚠️ 반드시 프로젝트 루트에서)

```bash
!python -m http.server {port|5173}
```

> **서빙 루트 = 프로젝트 루트.** 문서(`docs/05_설계서/...`, `docs/00_FUNC/...` 등 docs 전체)와
> 루트 리소스(`.speclinker/sprint-status.yaml`)가 모두 한 서버 루트 아래 있어야
> INF·UIS·FUNC 클릭 라우팅이 동작한다. `--directory docs/viewer`처럼 하위 폴더를
> 루트로 잡으면 문서가 서빙 루트 밖이 되어 클릭 시 404가 난다.

접속: **`http://localhost:{port|5173}/docs/viewer/index.html`**

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
