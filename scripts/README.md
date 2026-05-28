# scripts/ — 자동화 스크립트 목록

Speclinker 플러그인이 내부적으로 호출하는 Python·Node.js·Bash 스크립트.  
각 파일 상단 `STATUS:` 주석으로 구현 상태를 명시한다.

**상태 코드**: ✅완료 / 🔄진행 / 📋계획 / ⚠️deprecated

---

## Python 스크립트

| 파일 | STATUS | 목적 | 입력 | 출력 | 호출 커맨드 |
|------|--------|------|------|------|------------|
| `probe.py` | ✅ | 프로젝트 스택·구조 탐지 | 워크스페이스 루트 | `_tmp/probe.json` | sl-recon STEP 1.5 |
| `resolve_call_chain.py` | ✅ | Controller→Service→DAO 호출 체인 추출 + Strategy 연동 | 워크스페이스 루트, profile.yaml | `_tmp/router_inventory_with_chain.json`, `_tmp/sch_draft/` | sl-recon STEP 4 |
| `screen_plan_discover.py` | ✅ | 정적 화면 라우트 발견 (React/Vue/Angular/Spring/JSP) | 워크스페이스 루트, profile.yaml | `_tmp/screen_plan_static.json` | sl-recon STEP 2.5 |
| `screen_plan_merge.py` | ✅ | 정적 + 런타임 화면 plan 병합 | `_tmp/screen_plan_static.json`, `_tmp/screen_plan_runtime.json` | `_tmp/screen_plan_merged.json` | sl-recon STEP 2.7 |
| `screen_inventory.py` | ✅ | screen_plan.confirmed.json → screen_inventory.json 변환 | `.speclinker/screen_plan.confirmed.json` | `_tmp/screen_inventory.json` | sl-recon STEP 5 |
| `inf_registry.py` | ✅ | INF URL SSoT 레지스트리 관리 (upsert/lookup/dedup) | `_tmp/` API hints | `.speclinker/inf_registry.json` | sl-recon STEP 7 |
| `build_funcs_index.py` | ✅ | spec.md + INF → FUNC_MAP 통합 인덱스 생성 | `docs/05_설계서/`, INF 파일 | `_tmp/funcs_index.json` | sl-recon STEP 9-0 |
| `func_context_bundle.py` | ✅ | FUNC-ID별 스펙(INF/SCH/UIS) 컨텍스트 자동 수집 | FUNC-ID, 워크스페이스 | stdout JSON bundle | sl-aidd STEP 2 |
| `req_scan.py` | ✅ | linked_func/linked_req 주석 스캔 → 커버리지 갱신 | 워크스페이스 루트 | FUNC_MAP.md 상태 업데이트 | sl-aidd STEP 5 / sl-dev 완료 후 |
| `merge_index.py` | ✅ | RECON Phase-C 색인 머징 | `_tmp/` 색인 파일들 | 통합 인덱스 | sl-recon Phase-C |
| `build_si_graph.py` | ✅ | REQ↔FUNC↔코드 SI 그래프 빌드 | FUNC_MAP.md, RTM | `.understand-anything/si-graph.json` | sl-rtm |
| `ia_map_builder.py` | ✅ | 화면-API 관계도(IA Map) JSON 생성 | INF 파일, UIS spec.md | `.understand-anything/ia-map.json` | sl-recon 완료 후 |
| `generate_uis_spec.py` | ✅ | capture.js 결과 → UIS spec.md 자동 생성 (§0~§9) | `preview_*.png`, `preview_*_widgets.json` | `spec.md` | sl-recon-uis (attach 캡처 후) |
| `annotate_preview.py` | ✅ | preview.png + widgets.json → 번호 마커 overlay 이미지 생성 | `preview.png`, `preview_*_widgets.json` | `preview_annotated.png` | generate_uis_spec.py 내부 호출 |
| `link_uis_inf.py` | ✅ | UIS spec.md §5의 URL → INF 링크 패치 (LLM 없음) | UIS spec.md, INF 파일 | spec.md §5 인라인 수정 | sl-recon STEP 7 (INF 생성 후) |
| `link_inf_sch.py` | ✅ | INF → SCH 연결 패치 | INF 파일, SCH 파일 | INF 파일 `linked_sch` 필드 | sl-recon STEP 8 완료 후 |
| `build_capture_plan.py` | ✅ | 화면 캡처 시나리오 JSON 생성 | screen_inventory.json | `_tmp/capture_plan.json` | sl-recon-uis 내부 |
| `run_tests.py` | ✅ | smoke/matrix 테스트 실행 | `tests/` 디렉토리 | 테스트 결과 stdout | `python3 scripts/run_tests.py` |
| `poc_cleanup.py` | ✅ | POC 반복 실행 시 산출물 초기화 | 워크스페이스 루트 | docs/_tmp 정리 | 개발·POC 전용 |
| `poc_slice.py` | ✅ | 도메인 일부만 슬라이싱하여 테스트 | 워크스페이스 루트, 도메인명 | 슬라이스된 산출물 | 개발·POC 전용 |
| `check_docs_sync.py` | ✅ | README/CLAUDE.md 동기화 검사 | 플러그인 루트 | 불일치 목록 stdout | `python3 scripts/check_docs_sync.py` |

---

## Node.js 스크립트

| 파일 | STATUS | 목적 | 입력 | 출력 | 호출 방법 |
|------|--------|------|------|------|----------|
| `capture.js` | ✅ | CDP attach 기반 화면 캡처 + 위젯 자동 마킹 | Chrome --remote-debugging-port=9222 | `preview_*.png`, `preview_*_widgets.json` | `node scripts/capture.js --url <url>` |
| `run-dashboard.js` | ✅ | UA 대시보드 개발 서버 실행 | — | 브라우저에서 http://localhost:3000 | `node scripts/run-dashboard.js` |
| `ua_req_bridge.js` | ✅ | UA 지식 그래프 ↔ REQ-ID 브릿지 (커버리지 갱신) | 워크스페이스 루트 | `.understand-anything/` 갱신 | sl-dev 완료 후 자동 호출 |
| `build-ua.js` | ✅ | UA 코어 패키지 빌드 | ua/ 소스 | `ua/packages/core/dist/index.js` | `node scripts/build-ua.js` |

---

## Bash 스크립트

| 파일 | STATUS | 목적 | 호출 방법 |
|------|--------|------|----------|
| `build-ua.sh` | ✅ | UA 코어 빌드 (pnpm, SessionStart 훅에서 자동 실행) | `bash scripts/build-ua.sh` |
| `req_scan.sh` | ✅ | REQ 스캔 Bash 래퍼 (req_scan.py 호출) | `bash scripts/req_scan.sh` |

---

## 스크립트 간 의존성

```
sl-recon 흐름:
  probe.py → resolve_call_chain.py → screen_plan_discover.py
           → inf_registry.py → build_funcs_index.py
           → [capture.js → annotate_preview.py → generate_uis_spec.py]
           → link_uis_inf.py → link_inf_sch.py → ia_map_builder.py

sl-aidd 흐름:
  func_context_bundle.py → [dev-agent] → req_scan.py → ua_req_bridge.js

검증:
  check_docs_sync.py (독립 실행)
  run_tests.py (독립 실행)
```
