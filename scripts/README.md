# scripts/ — 자동화 스크립트 목록

Speclinker 플러그인이 내부적으로 호출하는 Python·Node.js 스크립트.

**상태 코드**: ✅완료 / 🔄진행 / ⚠️deprecated

---

## Python 스크립트

| 파일 | STATUS | 목적 | 호출 커맨드 |
|------|--------|------|------------|
| `scan_source.js` | ✅ | 제로-LLM 정적 소스 스캔 → source_index.json (form/api kind 분류) | sl-recon STEP 1 |
| `dispatch_inf_gen.py` | ✅ | INF 생성 dispatcher — router_inventory를 배치로 나눠 ddd-api-agent 병렬 실행 | sl-recon STEP 4-3 |
| `resolve_call_chain.py` | ✅ | Controller→Service→DAO→Query 호출 체인 추출 + sch_draft 생성 | sl-recon STEP 4-2 |
| `build_sch_todo.py` | ✅ | SCH 스킵 게이트 — INF tables: 합집합 vs 기존 SCH 비교, 생성 대상만 sch_todo.json (idempotent) | sl-recon STEP 5-0 |
| `sch_facts.py` | ✅ | SCH 정적 사실 수집 — sch_draft + CREATE TABLE + ORM + 선택적 DB드라이버(pymysql/psycopg2) merge | build_sch_static 내부 |
| `build_sch_static.py` | ✅ | zero-token SCH 스켈레톤 — 컬럼·인덱스·FK·ERD·크로스링크·DB_{도메인}·DB_Schema 생성, 의미는 `<!-- LLM-TODO -->` 마커, sch_enrich_todo.json 산출 | sl-recon STEP 5-A |
| `dispatch_sch_gen.py` | ✅ | SCH enrichment 디스패처 — sch_enrich_todo 도메인만 ddd-db-agent(enrichment) 서브프로세스 병렬, sch_dispatch_status 재시도 | sl-recon STEP 5-B |
| `build_funcs_index.py` | ✅ | spec.md + INF → FUNC_MAP 통합 인덱스 생성 | sl-recon-doc STEP 9-0 |
| `build_si_graph.py` | ✅ | FUNC↔코드 SI 트레이싱 그래프 빌드 | sl-recon-doc STEP 9-0-1 |
| `func_context_bundle.py` | ✅ | FUNC-ID별 스펙(INF/SCH/UIS) 컨텍스트 자동 수집 (build_story 재사용) | sl-aidd STEP 1 |
| `build_story.py` | ✅ | FUNC-ID → docs/00_FUNC/stories/STORY-{FUNC-ID}.md (func_context_bundle 재사용) | sl-aidd STEP 2 |
| `req_scan.py` | ✅ | linked_func 주석 스캔 → FUNC_MAP 커버리지 갱신 | sl-aidd STEP 6 / 구현 완료 후 |
| `generate_uis_spec.py` | ✅ | capture.js 결과 → UIS spec.md 자동 생성 (§0~§9) | sl-recon-uis (캡처 후) |
| `annotate_preview.py` | ✅ | preview.png + widgets.json → 번호 마커 overlay 이미지 생성 | generate_uis_spec.py 내부 호출 |
| `link_uis_inf.py` | ✅ | UIS spec.md §5의 URL → INF 링크 패치 (LLM 없음) | sl-recon-uis STEP 6-4 |
| `link_inf_sch_new.py` | ✅ | INF → SCH 연결 패치 (`[TBD]` → `[[SCH-XXX]]`, `{도메인}/SCH/SCH-*.md` 스캔) | sl-recon STEP 5-1 |
| `screen_inventory.py` | ✅ | BFS 캡처 결과에 소스 파일 경로 역매핑 보강 | sl-recon-uis STEP 6-2-3-B fallback |
| `merge_index.py` | ✅ | RECON Phase-C 색인 머징 | sl-recon-doc Phase-C |
| `spec_graph_build.py` | ✅ | INF/SCH frontmatter·근거소스 앵커 → forward(INF→table)/reverse(table→INF ripple) 그래프 (spec_graph.json 없어도 빌드) | build_change_context 내부 |
| `build_change_context.py` | ✅ | SR 엔티티 → 영향슬라이스(관련도 랭킹·편재격리·전이) + 앵커 + ripple/현행성 경고 브리프 | sl-change Step 5 |
| `extract_attachments.py` | ✅ | 변경 첨부(pptx/docx/xlsx/pdf) 텍스트 추출 (선택 의존성 lazy) | sl-change Step 1-D |
| `extract_entities.py` | ✅ | SR/첨부 → 변경 엔티티 자동추출(스펙 어휘 교차검증) (T1-A) | sl-change Step 5-0 |
| `eval_fidelity.py` | ✅ | 스펙 충실도 측정 — 테이블 추출 P/R/F1 + 주석 워크시트 (T3-A/H1) | 평가 |
| `eval_aidd.py` | ✅ | AIDD 결과 A/B 비교(풀그라운딩 vs 소스만) (T3-B/H4, 반자동) | 평가 |
| `build_domain_overview.py` | ✅ | 도메인 SOP 내러티브 개요(신규자용, 기계인덱스와 분리) (T4-B) | sl-recon-doc 후/수동 |
| `run_tests.py` | ✅ | smoke/matrix 테스트 실행 | `python3 scripts/run_tests.py` |

---

## Node.js 스크립트

| 파일 | STATUS | 목적 | 호출 방법 |
|------|--------|------|----------|
| `scan_source.js` | ✅ | 제로-LLM 정적 소스 스캔 → source_index.json | sl-recon STEP 1 |
| `ai_nav.js` | ✅ | Chrome CDP BFS 탐색 (snapshot/click/capture) | sl-recon-uis STEP 6-2 |
| `capture.js` | ✅ | CDP attach 기반 화면 캡처 + 위젯 자동 마킹 | `node scripts/capture.js --url <url>` |
| `detect_capture_strategy.js` | ✅ | 앱 유형 기반 캡처 전략 탐지 | sl-recon-uis 실행 전 |
| `capture_single_tab.js` | ✅ | 단일 탭 CDP 캡처 (메모리 절약 모드) | capture.js 내부 호출 |

---

## 스크립트 간 의존성

```
sl-recon 흐름 (INF·SCH 생성 포함):
  scan_source.js → resolve_call_chain.py → dispatch_inf_gen.py → [ddd-api-agent × N배치]  (STEP 4-3 INF)
                → build_sch_todo.py  (STEP 5-0 SCH 스킵 게이트 → sch_todo.json)
                → build_sch_static.py  (STEP 5-A 정적 스켈레톤, zero-token; sch_facts 사용 → sch_enrich_todo.json)
                → dispatch_sch_gen.py → ddd-db-agent(enrichment)  (STEP 5-B 의미 보강, 필요 도메인만)
                → link_inf_sch_new.py  (STEP 5-1 INF↔SCH 링크 패치)
                → screen_inventory_static.json (form routes → sl-recon-uis fallback)

sl-recon-uis 흐름:
  detect_capture_strategy.js → ai_nav.js (BFS)
  → capture.js → annotate_preview.py → generate_uis_spec.py
  → link_uis_inf.py

sl-recon-doc 흐름:
  build_funcs_index.py → [rd-agent] → [srs-agent] → [rtm-agent]
  build_si_graph.py → si-graph.json

sl-aidd 흐름:
  func_context_bundle.py → [dev-agent] → req_scan.py
```
