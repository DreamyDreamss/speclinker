---
name: sl-viewer
description: speclinker 산출물 Docsify 웹 뷰어 실행 (대시보드·INF/UIS·IA 트리)
argument-hint: [port]
---

# /sl-viewer — 스펙 웹 뷰어 실행

speclinker RECON 산출물을 브라우저에서 탐색하는 Docsify 뷰어를 시작한다.

> 구 Obsidian 기반 뷰어(`gen_obsidian_index.py`)는 deprecated — 이 스킬로 대체됨.

---

## STEP 1 — spec_index.json 갱신

```bash
!python {PLUGIN_PATH}/scripts/gen_docsify.py .
```

---

## STEP 2 — 뷰어 서버 시작

```bash
!python -m http.server {port|5173} --directory {PLUGIN_PATH}/docs/viewer
```

또는 프로젝트별 뷰어가 있으면:

```bash
!python -m http.server {port|5173} --directory docs/viewer
```

---

## 사용 방법

브라우저에서 `http://localhost:5173` 접속:

- **대시보드**: 도메인별 INF/UIS 수 + 스펙완성도/개발완료율
- **도메인 탭**: 사이드바에서 도메인 선택 → INF/UIS/SCH/BAT 탭 전환
- **INF 상세**: INF 카드 클릭 → Docsify 렌더링 + 우측 Quick Nav
- **IA 트리**: 사이드바 [IA 트리] 버튼 → 메뉴 계층으로 화면 탐색

**spec_index.json 최신화**: 새 INF/UIS 생성 후 STEP 1 재실행 → 브라우저 새로고침.
