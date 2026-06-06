# scripts/ — 자동화 스크립트 목록

Speclinker 플러그인이 내부적으로 호출하는 Python·Node.js 스크립트.

**상태 코드**: ✅완료 / 🔄진행 / ⚠️deprecated

---

## Python 스크립트

| 파일 | STATUS | 목적 | 호출 커맨드 |
|------|--------|------|------------|
| `scan_source.js` | ✅ | 제로-LLM 정적 소스 스캔 → source_index.json. form/api kind 분류(Jackson JSON-view 핸들러도 api, C-4), `@RequestMapping method=` 파싱(H-3), 배치 판정(스케줄러/배치디렉토리, Mapper/Model 제외, M-3) | sl-recon STEP 1 |
| `dispatch_inf_gen.py` | ✅ | INF 생성 dispatcher — 배치 병렬 실행. 모델 한도 시 haiku 자동 폴백(`SL_DISPATCH_MODEL`/`SL_DISPATCH_FALLBACK`, H-1), 성공 시 failed[] 정리(M-5) | sl-recon STEP 4-3 |
| `resolve_call_chain.py` | ✅ | Controller→Service→DAO→Query 호출 체인 추출 + sch_draft 생성 | sl-recon STEP 4-2 |
| `build_sch_todo.py` | ✅ | SCH 스킵 게이트 — INF tables: 합집합 vs 기존 SCH 비교, 생성 대상만 sch_todo.json (idempotent) | sl-recon STEP 5-0 |
| `sch_facts.py` | ✅ | SCH 정적 사실 수집 — sch_draft + CREATE TABLE + ORM + 선택적 DB드라이버(pymysql/psycopg2) merge | build_sch_static 내부 |
| `build_sch_static.py` | ✅ | zero-token SCH 스켈레톤 — 컬럼·인덱스·FK·ERD·크로스링크·DB_{도메인}·DB_Schema 생성, 의미는 `<!-- LLM-TODO -->` 마커, sch_enrich_todo.json 산출 | sl-recon STEP 5-A |
| `dispatch_sch_gen.py` | ✅ | SCH enrichment 디스패처 — sch_enrich_todo 도메인만 ddd-db-agent(enrichment) 서브프로세스 병렬, sch_dispatch_status 재시도 | sl-recon STEP 5-B |
| `build_funcs_index.py` | ✅ | spec.md + INF + **SCH** → funcs_index 통합 인덱스(화면 'UIS'/'UI' 스캔, `infs[].sch_ids`·`schs` 섹션 포함) | sl-recon-doc STEP 9-0 |
| `build_si_graph.py` | ⚠️DEPRECATED | FUNC↔코드 SI 트레이싱 그래프 — 소비처 없어 recon-doc서 제거(v3.12). 직접 호출만 동작 | — |
| `func_context_bundle.py` | ✅ | FUNC-ID별 스펙(INF/SCH/UIS) 컨텍스트 자동 수집 (build_story 재사용) | sl-aidd STEP 1 |
| `build_story.py` | ✅ | FUNC-ID → docs/00_FUNC/stories/STORY-{FUNC-ID}.md (func_context_bundle 재사용) | sl-aidd STEP 2 |
| `req_scan.py` | ✅ | linked_func 주석 스캔 → FUNC_MAP 커버리지 갱신 | sl-aidd STEP 6 / 구현 완료 후 |
| `capture_screen_dom.js` | ✅ | (v3.9) 사용자가 메뉴진입한 **현재 화면**을 goto 없이 캡처. 위젯 최다 프레임 선택(스택중립)·위젯상한 없음·풍부 DOM 스냅샷. `--list-tabs`(탭 검출)·`--tab-text`/`--suffix`(가이드형 탭 순회) | sl-recon-uis U2-1/U2-3 |
| `collect_screen_slice.py` | ✅ | (v3.9) screenId stem 매칭 → core(화면본체 view/controller/script)/related(팝업) 슬라이스 + 엔드포인트 리터럴 추출. 스택중립(프레임워크 분기 없음) | sl-recon-uis U2-4 |
| `annotate_preview.py` | ✅ | preview.png + widgets/block_map → 번호 마커 overlay. (v3.9) ddd-ui-agent가 §4 문서화 위젯으로 marker json 출력 후 호출 | ddd-ui-agent Phase 3.5 |
| `link_uis_inf.py` | ✅ | (v3.9) UIS api_hints/§4 raw경로 × INF(method,path) **경로조인** → INF 링크 치환 + INF.screens 역기록(양방향·생성순서 무관) | sl-recon-uis U3 |
| `link_inf_sch_new.py` | ✅ | INF → SCH 연결 패치 (`[TBD]` → `[[SCH-XXX]]`, `{도메인}/SCH/SCH-*.md` 스캔) | sl-recon STEP 5-1 |
| `merge_index.py` | ✅ | RECON Phase-C 색인 머징 | sl-recon-doc Phase-C |
| `gen_docsify.py` | ✅ | 산출물 스캔 → SpecLens `spec_index.json` 생성 + 뷰어 자산 복사. **관계 필드**: `uis.inf_ids`·`inf.sch_ids`·`*.func`·`gaps` + **`funcs[]`**(FUNC_MAP 파싱)·**`srs[]`**(SRS_v1.0 색인표 파싱: id/name/uis/inf/func)·`domains[].overview`·`domains[].srs_count` — 모두 추가(하위호환, 데이터 없으면 빈값) | sl-viewer STEP 1 |
| `spec_graph_build.py` | ✅ | INF/SCH frontmatter·근거소스 앵커 → forward(INF→table)/reverse(table→INF ripple) 그래프 (spec_graph.json 없어도 빌드) | build_change_context 내부 |
| `build_change_context.py` | ✅ | SR 엔티티 → 영향슬라이스(관련도 랭킹·편재격리·전이) + 앵커 + ripple/현행성 경고 브리프 | sl-change Step 5 |
| `extract_attachments.py` | ✅ | 변경 첨부(pptx/docx/xlsx/pdf) 텍스트 추출 (선택 의존성 lazy) | sl-change Step 1-D |
| `extract_entities.py` | ✅ | SR/첨부 → 변경 엔티티 자동추출(스펙 어휘 교차검증) (T1-A) | sl-change Step 5-0 |
| `eval_fidelity.py` | ✅ | 스펙 충실도 측정 — 테이블 추출 P/R/F1 + 주석 워크시트 (T3-A/H1) | 평가 |
| `eval_aidd.py` | ✅ | AIDD 결과 A/B 비교(풀그라운딩 vs 소스만) (T3-B/H4, 반자동) | 평가 |
| `build_domain_overview.py` | ✅ | 도메인 SOP 내러티브 개요(신규자용, 기계인덱스와 분리) (T4-B/4-5) | sl-recon-doc STEP 9-5 |
| `scan_code_literals.py` | ✅ | 쿼리 코드값 리터럴 + JT_CODE 그룹신호(소스 정적) 추출 → 쿼리 의도복원 (4-2) | sl-recon STEP 5 / ddd-db-agent |
| `eval_anchor_coverage.py` | ✅ | 앵커 체인 커버리지 + 메타 정확도(검증가능 품질지표, eval_fidelity 대체) (4-4) | 평가 |
| `eval_fidelity.py` | ⚠️DEPRECATED | self-consistency 프록시(충실도 아님) → eval_anchor_coverage 사용 | — |
| `run_tests.py` | ✅ | smoke/matrix 테스트 실행 | `python3 scripts/run_tests.py` |

---

## Node.js 스크립트

| 파일 | STATUS | 목적 | 호출 방법 |
|------|--------|------|----------|
| `scan_source.js` | ✅ | 제로-LLM 정적 소스 스캔 → source_index.json | sl-recon STEP 1 |
| `capture_screen_dom.js` | ✅ | (v3.9) 메뉴진입 현재화면 캡처 + 탭 검출/순회 (BFS/goto 대체) | sl-recon-uis U2 |

> 폐기(v3.9 삭제): `ai_nav.js`·`capture.js`·`detect_capture_strategy.js`·`build_uis_goto_plan.py`·`capture_single_tab.js`·`detect_tabs.py`·`screen_inventory.py`·`generate_uis_spec.py` — 가이드형 세션 + `capture_screen_dom.js`/`collect_screen_slice.py`/ddd-ui-agent로 대체.

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

sl-recon-uis 흐름 (v3.9 가이드형 세션):
  [사용자 메뉴 진입] → capture_screen_dom.js (현재화면 캡처 + --list-tabs)
  → [사용자 편집상태 설정] → capture_screen_dom.js --tab-text (탭 순회)
  → collect_screen_slice.py (소스 슬라이스)
  → [ddd-ui-agent] (SOP급 UIS + annotate_preview.py 마커)
  → link_uis_inf.py (UIS↔INF 경로조인) → gen_docsify.py

sl-recon-doc 흐름:
  build_funcs_index.py → [rd-agent] → [srs-agent] → [rtm-agent] → build_domain_overview.py

sl-aidd 흐름:
  func_context_bundle.py → [dev-agent] → req_scan.py
```
