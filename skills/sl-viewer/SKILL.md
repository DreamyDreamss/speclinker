---
name: sl-viewer
description: speclinker 산출물 Docsify 웹 뷰어 실행 (대시보드·INF/UIS·IA 트리)
argument-hint: [port]
---

# /sl-viewer — 스펙 웹 뷰어 실행

speclinker RECON 산출물을 브라우저에서 탐색하는 Docsify 뷰어를 시작한다.

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

- **대시보드**: 도메인별 INF/UIS 수 + 스펙완성도/개발완료율
- **도메인 탭**: 사이드바에서 도메인 선택 → INF/UIS/SCH/BAT 탭 전환
- **INF 상세**: INF 카드 클릭 → Docsify 렌더링 + 우측 Quick Nav
- **IA 트리**: 사이드바 [IA 트리] 버튼 → 메뉴 계층으로 화면 탐색

**spec_index.json 최신화**: 새 INF/UIS 생성 후 STEP 1 재실행 → 브라우저 새로고침.
