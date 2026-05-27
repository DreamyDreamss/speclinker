# RECON 파이프라인 전체 문서

> 버전: v2.19.0 기준  
> 커맨드 흐름: `/sl-recon` → `/sl-recon-uis` → `/sl-recon-inf` → `/sl-recon-doc`

---

## 전체 흐름 요약

```
/sl-recon  (STEP 0~5)
  STEP 0    MCP 연결 확인
  STEP 0.5  POC 모드 확인
  STEP 1    UA 에이전트 — 코드 구조 분석 (knowledge-graph 생성)
  STEP 1.5  프로젝트 Probe (정적 신호 수집)
  STEP 1.7  프로젝트 Profile 생성/로드
  STEP 2    화면 발견 + Screen Plan 확정
  STEP 2.5  런타임 BFS 메뉴 탐색 (선택)
  STEP 3    Phase-A: SAD + 도메인 목록 확정
  STEP 4    사용자 도메인 검토 (필수 체크포인트)
  STEP 5    router_inventory + call chain 사전 계산
  STEP 5-B  BAT 생성 (배치 후보 파일)
  → _tmp/recon_checkpoint.json 저장

/sl-recon-uis  (STEP 6)
  STEP 6-0.5  캡처 가능 여부 확인 + bootstrap
  STEP 6-1    화면 인벤토리 생성
  STEP 6-2    런타임 캡처 [A] (Playwright)
  STEP 6-3    generate_uis_spec.py [B] — 시각 spec.md 초안
  STEP 6-4    ddd-ui-agent [C] — 소스 분석 + §5 작성
  STEP 6-5    api_hints 수집 (STEP 7 입력 준비)
  STEP 6-6    UI _TOC.md 생성
  STEP 6-7    미리보기 캡처 (4단계 폴백)
  → checkpoint 업데이트

/sl-recon-inf  (STEP 7~8)
  STEP 7-0    api_hints × router_inventory cross-match
  STEP 7-1    ddd-api-agent (matched + unmatched URL)
  STEP 7-2    spec.md INF 링크 갱신
  STEP 7-3    API-residual INF 생성 (화면 미연결 컨트롤러)
  STEP 7-4    INF 색인 생성 (_TOC.md + API_{domain}.md)
  STEP 8      ddd-db-agent (SCH 생성)
  STEP 8-1    link_inf_sch.py — INF → SCH 링크 패치
  → checkpoint 업데이트

/sl-recon-doc  (STEP 9~10)
  STEP 9-0    build_funcs_index.py (LLM 없음)
  STEP 9-0-1  build_si_graph.py (LLM 없음)
  STEP 9-1    merge_index.py — 전체 색인 3종 생성
  STEP 9-2    rd-agent — FUNC/FUNC_MAP 생성
  STEP 9-3    srs-agent — SRS 생성
  STEP 9-4    rtm-agent — FUNC_MAP 생성
  STEP 10     ia_map_builder.py — IA 맵 생성
  STEP 11     si-graph 갱신 확인
  → RECON 완료
```

---

## Phase 1: `/sl-recon` (STEP 0~5)

### STEP 0 — MCP 연결 확인

| 구분 | 내용 |
|------|------|
| **입력** | `project.env` (MCP_* 플래그) |
| **출력** | `_tmp/mcp_status.json` |
| **스크립트** | 인라인 Python (MCP 도구 직접 호출) |
| **에이전트** | 없음 |
| **비고** | project.env는 절대 수정 안 함. 매 실행마다 재시도 |

---

### STEP 0.5 — POC 모드 확인

| 구분 | 내용 |
|------|------|
| **입력** | `project.env` (POC_MODE, POC_DOMAINS, POC_SCREENS, POC_SKIP_UA, POC_FILE_LIMIT) |
| **출력** | 없음 (콘솔 출력만) |
| **스크립트** | 인라인 Python |
| **에이전트** | 없음 |

---

### STEP 1 — 코드 구조 분석 (UA 에이전트)

| 구분 | 내용 |
|------|------|
| **POC 가드** | `POC_SKIP_UA=true`이면 기존 knowledge-graph 재사용, STEP 1 전체 스킵 |
| **입력** | `project.env` (SOURCE_{N}_PATH, SOURCE_{N}_LABEL), 소스코드 |
| **출력** | `.understand-anything/knowledge-graph-{label}.json` × N개<br>`.understand-anything/domain-graph-{label}.json` × N개<br>`.understand-anything/knowledge-graph.json` (병합 그래프) |
| **스크립트** | `node -e ...` (intermediate 조립 인라인), `node -e ...` (병합 인라인) |
| **에이전트** | `speclinker:project-scanner` (1-1)<br>`speclinker:file-analyzer` (1-2)<br>`speclinker:architecture-analyzer` (1-3)<br>`speclinker:domain-analyzer` (1-4) |
| **비고** | 소스별 독립 그래프 → 병합 시 노드 ID에 `{label}__` 접두어 |

---

### STEP 1.5 — 프로젝트 Probe

| 구분 | 내용 |
|------|------|
| **입력** | 소스코드 (pom.xml, package.json 등 매니페스트), `.understand-anything/knowledge-graph.json` |
| **출력** | `_tmp/probe.json` |
| **스크립트** | `scripts/probe.py` |
| **에이전트** | 없음 (LLM 호출 없음) |
| **비고** | 정보 수집만. 스택 식별 신호(framework, architecture_hints) 포함 |

---

### STEP 1.7 — 프로젝트 Profile 생성/로드

| 구분 | 내용 |
|------|------|
| **입력** | `_tmp/probe.json`, `.understand-anything/knowledge-graph.json` |
| **출력** | `.speclinker/profile.yaml` |
| **스크립트** | 인라인 Python (존재 여부 확인) |
| **에이전트** | `speclinker:profile-agent` (profile 없을 때)<br>`speclinker:convention-learner` (follow_layers < 8개일 때, 선택)<br>`speclinker:meta-extractor` (빌트인 strategy 미매칭 시, 선택) |

---

### STEP 2 — 화면 발견 + Screen Plan 확정

#### STEP 2-1: 정적 화면 발견

| 구분 | 내용 |
|------|------|
| **입력** | 소스코드 (라우터 파일), `project.env` |
| **출력** | `_tmp/screen_plan_static.json` |
| **스크립트** | `scripts/screen_plan_discover.py` |
| **에이전트** | 없음 |

#### STEP 2-2: Screen Plan 사용자 확정

| 구분 | 내용 |
|------|------|
| **입력** | `_tmp/screen_plan_static.json`, `project.env` (POC_SCREENS) |
| **출력** | `.speclinker/screen_plan.confirmed.json` |
| **스크립트** | 인라인 Python (POC 자동 처리 또는 사용자 확인) |
| **에이전트** | 없음 |
| **비고** | POC_SCREENS 설정 시 자동 확정. 일반 모드는 사람 확인 필수 |

#### STEP 2.5: 런타임 BFS 메뉴 탐색 (선택 — b) 선택 시만)

| 구분 | 내용 |
|------|------|
| **입력** | Chrome `--remote-debugging-port=9222` (로그인 완료 상태) |
| **출력** | `_tmp/screen_plan_runtime.json` (source: "runtime-bfs", menuMeta 포함)<br>`_tmp/screen_plan_merged.json`<br>`.speclinker/screen_plan.confirmed.json` (갱신) |
| **스크립트** | `scripts/capture.js --traverse-menu`<br>`scripts/screen_plan_merge.py` |
| **에이전트** | 없음 |

---

### STEP 3 — Phase-A: SAD + 도메인 목록 확정

#### STEP 3-0: knowledge-graph 압축

| 구분 | 내용 |
|------|------|
| **입력** | `.understand-anything/knowledge-graph.json` |
| **출력** | `_tmp/kg_summary.json` (filePath·type·summary·tags·layer만 추출) |
| **스크립트** | 인라인 Python |
| **에이전트** | 없음 |

#### STEP 3-1: spec-agent 도메인 확정

| 구분 | 내용 |
|------|------|
| **입력** | `_tmp/kg_summary.json`, `.understand-anything/domain-graph*.json` |
| **출력** | `docs/04_아키텍처설계서/SAD_v1.0.md`<br>`docs/05_설계서/_domain_plan.json` |
| **스크립트** | 없음 |
| **에이전트** | `speclinker:spec-agent` (model: **sonnet**) |
| **비고** | knowledge-graph.json 전체 읽기 금지. kg_summary만 사용 |

#### STEP 3-2: POC 도메인 필터

| 구분 | 내용 |
|------|------|
| **입력** | `docs/05_설계서/_domain_plan.json`, `project.env` (POC_DOMAINS) |
| **출력** | `docs/05_설계서/_domain_plan.json` (필터 적용)<br>`docs/05_설계서/_domain_plan.json.full.json` (백업) |
| **스크립트** | 인라인 Python |
| **에이전트** | 없음 |

---

### STEP 4 — 사용자 도메인 검토 (필수 체크포인트)

| 구분 | 내용 |
|------|------|
| **입력** | `docs/05_설계서/_domain_plan.json` |
| **출력** | `docs/05_설계서/_domain_plan.json` (수정 시) |
| **에이전트** | 없음 |
| **비고** | POC 모드는 자동 진행. 일반 모드는 사람 확인 필수. 확인 전 STEP 5 진행 금지 |

---

### STEP 5 — router_inventory + call chain 사전 계산

#### STEP 5-0: POC_SCREENS 사전 슬라이스 (POC 시만)

| 구분 | 내용 |
|------|------|
| **입력** | `.speclinker/screen_plan.confirmed.json`, `project.env` |
| **출력** | `_tmp/screen_inventory.json` (POC 필터 적용)<br>`_tmp/poc_target_urls.json` |
| **스크립트** | `scripts/screen_inventory.py`<br>`scripts/poc_slice.py` |
| **에이전트** | 없음 |

#### STEP 5-1: router_inventory 생성

| 구분 | 내용 |
|------|------|
| **입력** | `.understand-anything/knowledge-graph-{label}.json` (API용),<br>`docs/05_설계서/_domain_plan.json`,<br>`_tmp/poc_target_urls.json` (POC 시) |
| **출력** | `_tmp/router_inventory.json` (API 파일 3개씩 그룹, 재시작 지원)<br>`_tmp/batch_inventory.json` (배치 후보 파일) |
| **스크립트** | 인라인 Python (`resolve_call_chain.extract_defined_urls` 사용) |
| **에이전트** | 없음 |

#### call chain 사전 계산

| 구분 | 내용 |
|------|------|
| **입력** | `_tmp/router_inventory.json`, 소스코드 (Controller→Service→DAO→Query) |
| **출력** | `_tmp/router_inventory_with_chain.json`<br>`_tmp/sch_draft/{도메인}/{테이블}.json` (SQL 추출 캐시) |
| **스크립트** | `scripts/resolve_call_chain.py` |
| **에이전트** | 없음 |

#### STEP 5-B: BAT 생성

| 구분 | 내용 |
|------|------|
| **입력** | `_tmp/batch_inventory.json` → call chain 계산 후 `_tmp/batch_inventory_with_chain.json` |
| **출력** | `docs/05_설계서/{domain}/BAT/BAT-{NNN}.md` |
| **스크립트** | `scripts/resolve_call_chain.py` (call chain 계산) |
| **에이전트** | `speclinker:ddd-batch-agent` (3파일씩) |

#### STEP 5 완료 시 체크포인트 저장

| 구분 | 내용 |
|------|------|
| **출력** | `_tmp/recon_checkpoint.json` (`phase: "recon-analysis"`) |

---

## Phase 2: `/sl-recon-uis` (STEP 6)

**진입 전제 조건:**
- `_tmp/recon_checkpoint.json`
- `.speclinker/screen_plan.confirmed.json`
- `docs/05_설계서/_domain_plan.json`

---

### STEP 6-0.5 — 캡처 가능 여부 확인 + bootstrap

| 구분 | 내용 |
|------|------|
| **입력** | `project.env` (PREVIEW_BASE_URL, PREVIEW_STORAGE_STATE) |
| **출력** | `.preview-storage.json` (bootstrap 시) |
| **스크립트** | `scripts/runtime_capture.js --bootstrap` (필요 시) |
| **에이전트** | 없음 |
| **비고** | NEED_BOOTSTRAP=true이면 Chrome 창 열어 사용자 로그인 1회 필요 |

---

### STEP 6-1 — 화면 인벤토리 생성

| 구분 | 내용 |
|------|------|
| **입력** | `.speclinker/screen_plan.confirmed.json` (Phase 7 패스)<br>또는 `.understand-anything/knowledge-graph-{label}.json` (fallback) |
| **출력** | `_tmp/screen_inventory.json` |
| **스크립트** | `scripts/screen_inventory.py` |
| **에이전트** | 없음 |
| **비고** | menuMeta(menu_l1, menu_l2) 포함 전달 (BFS-only 화면 대응) |

---

### STEP 6-2 — [A] 런타임 캡처

| 구분 | 내용 |
|------|------|
| **조건** | storageState 존재 시만 실행 |
| **입력** | `.preview-storage.json`, `_tmp/screen_inventory.json`, `_tmp/capture_plan.json` (있으면) |
| **출력** | `docs/05_설계서/{domain}/UI/{screenId}/preview.png`<br>`docs/05_설계서/{domain}/UI/{screenId}/preview_tab{N}_{탭명}.png`<br>`docs/05_설계서/{domain}/UI/{screenId}/preview_tab{N}_{탭명}_widgets.json`<br>`docs/05_설계서/{domain}/UI/{screenId}/network_requests.json`<br>`docs/05_설계서/{domain}/UI/{screenId}/preview_annotated.png` (auto-annotate) |
| **스크립트** | `scripts/runtime_capture.js --inspect`<br>`scripts/annotate_preview.py` (캡처 후 자동 호출) |
| **에이전트** | 없음 |

---

### STEP 6-3 — [B] generate_uis_spec.py

| 구분 | 내용 |
|------|------|
| **조건** | widgets.json 또는 preview_tab*_widgets.json 존재 화면만 |
| **입력** | `widgets.json` 또는 `preview_tab*_widgets.json`<br>`docs/05_설계서/{domain}/INF/` 디렉토리 |
| **출력** | `docs/05_설계서/{domain}/UI/{screenId}/spec.md` (§0/§2/§4/§8 채움, §5는 TBD) |
| **스크립트** | `scripts/generate_uis_spec.py` |
| **에이전트** | 없음 |

---

### STEP 6-4 — [C] ddd-ui-agent

| 구분 | 내용 |
|------|------|
| **조건** | 모든 화면 (캡처 여부 무관) |
| **입력** | `entryFile`, `componentFiles` (소스코드)<br>기존 spec.md (있으면 §5만 패치) |
| **출력** | `docs/05_설계서/{domain}/UI/{screenId}/spec.md` (§5 인터랙션 매핑)<br>`_tmp/{screenId}_inf_required.json` |
| **스크립트** | 없음 |
| **에이전트** | `speclinker:ddd-ui-agent` (3개씩 배치 병렬) |
| **비고** | spec.md 없으면 전체 생성. 있으면 §5만 패치 |

---

### STEP 6-5 — api_hints 수집

| 구분 | 내용 |
|------|------|
| **입력** | `docs/05_설계서/{domain}/UI/{screenId}/spec.md` (각 화면의 frontmatter api_hints)<br>`_tmp/{screenId}_inf_gaps.json` (있으면 merge) |
| **출력** | `_tmp/uis_api_hints.json` |
| **스크립트** | 인라인 Python |
| **에이전트** | 없음 |

---

### STEP 6-6 — UI _TOC.md 생성

| 구분 | 내용 |
|------|------|
| **입력** | `docs/05_설계서/{domain}/UI/*/spec.md` |
| **출력** | `docs/05_설계서/{domain}/UI/_TOC.md` |
| **스크립트** | 인라인 Python |
| **에이전트** | 없음 |

---

### STEP 6-7 — 미리보기 캡처 (4단계 폴백)

| 구분 | 내용 |
|------|------|
| **입력** | `_tmp/screen_inventory.json`, `project.env` |
| **출력** | `_tmp/capture_plan.json` (build_capture_plan.py)<br>`docs/05_설계서/{domain}/UI/{screenId}/preview.png` (런타임 캡처) |
| **스크립트** | `scripts/build_capture_plan.py` (preActions 자동 생성)<br>`scripts/runtime_capture.js` (캡처) |
| **에이전트** | 없음 |
| **비고** | BFS-only 화면은 menu-click preActions 자동 생성 (jwork iframe 대응) |

**capture_plan.json preActions 분류:**

| 화면 종류 | preActions 전략 |
|----------|----------------|
| 정적 발견 (URL 접근 가능) | `goto` URL |
| BFS-only + menuMeta 있음 | `goto /` → menu_l1 클릭 → menu_l2 클릭 |
| 정적+BFS 중복 | `goto` URL (URL 접근 확인됨) |

**체크포인트 업데이트:**

| 출력 | `_tmp/recon_checkpoint.json` (`phase: "recon-uis"`) |
|------|-----------------------------------------------------|

---

## Phase 3: `/sl-recon-inf` (STEP 7~8)

**진입 전제 조건:**
- `_tmp/recon_checkpoint.json`
- `_tmp/uis_api_hints.json`
- `_tmp/router_inventory_with_chain.json`
- `_tmp/inf_generation_plan.json`

---

### STEP 7-0 — api_hints × router_inventory cross-match

| 구분 | 내용 |
|------|------|
| **입력** | `_tmp/uis_api_hints.json`<br>`_tmp/router_inventory_with_chain.json` |
| **출력** | `_tmp/inf_generation_plan.json` (matched, unmatched, residualFiles) |
| **스크립트** | 인라인 Python |
| **에이전트** | 없음 |

---

### STEP 7-1 — ddd-api-agent (matched + unmatched)

| 구분 | 내용 |
|------|------|
| **입력** | `_tmp/inf_generation_plan.json` (matched 항목)<br>`_tmp/router_inventory_with_chain.json` (call chain) |
| **출력** | `docs/05_설계서/{domain}/INF/INF-{NNN}.md` |
| **스크립트** | 없음 |
| **에이전트** | `speclinker:ddd-api-agent` (3개씩 배치, 최대 3그룹 동시) |
| **비고** | frontmatter: inf-id, method, path, used_by_screens 필수 |

---

### STEP 7-2 — spec.md INF 링크 갱신

| 구분 | 내용 |
|------|------|
| **입력** | `_tmp/screen_inventory.json`, `_tmp/uis_api_hints.json`<br>`docs/05_설계서/{domain}/INF/` (생성된 INF 파일) |
| **출력** | `docs/05_설계서/{domain}/UI/{screenId}/spec.md` (INF 링크 갱신) |
| **스크립트** | `scripts/generate_uis_spec.py` |
| **에이전트** | 없음 |

---

### STEP 7-3 — API-residual INF 생성

| 구분 | 내용 |
|------|------|
| **입력** | `_tmp/inf_generation_plan.json` (residualFiles)<br>`_tmp/router_inventory_with_chain.json` |
| **출력** | `docs/05_설계서/{domain}/INF/INF-{NNN}.md` (used_by_screens: []) |
| **스크립트** | 없음 |
| **에이전트** | `speclinker:ddd-api-agent` (3개씩) |

---

### STEP 7-4 — INF 색인 생성

| 구분 | 내용 |
|------|------|
| **입력** | `docs/05_설계서/{domain}/INF/INF-*.md` |
| **출력** | `docs/05_설계서/{domain}/INF/_TOC.md`<br>`docs/05_설계서/{domain}/API_{domain}.md` |
| **스크립트** | 인라인 Python |
| **에이전트** | 없음 |

---

### STEP 8 — SCH 생성 (ddd-db-agent)

| 구분 | 내용 |
|------|------|
| **입력** | `docs/05_설계서/{domain}/INF/` (INF 파일들)<br>`_tmp/sch_draft/{domain}/` (SQL 추출 캐시 — INF 단계에서 미리 생성)<br>`_tmp/mcp_status.json` (가용 DB MCP)<br>`.speclinker/profile.yaml` |
| **출력** | `docs/05_설계서/{domain}/DB_{domain}.md` |
| **스크립트** | 없음 |
| **에이전트** | `speclinker:ddd-db-agent` (도메인당 1호출, 3개씩 배치 병렬) |
| **비고** | sch_draft 우선 사용 (evidence 파일 재Read 금지). 자기 도메인 INF만 접근 |

---

### STEP 8-1 — INF → SCH 링크 패치

| 구분 | 내용 |
|------|------|
| **입력** | `docs/05_설계서/{domain}/INF/INF-*.md`<br>`docs/05_설계서/{domain}/DB_{domain}.md` |
| **출력** | `docs/05_설계서/{domain}/INF/INF-*.md` (## 참조 테이블 [TBD] → SCH 링크)<br>`_tmp/INF-{NNN}_sch_required.json` (미매칭 시) |
| **스크립트** | `scripts/link_inf_sch.py` |
| **에이전트** | 없음 |

**체크포인트 업데이트:**

| 출력 | `_tmp/recon_checkpoint.json` (`phase: "recon-inf"`) |
|------|-----------------------------------------------------|

---

## Phase 4: `/sl-recon-doc` (STEP 9~10)

**진입 전제 조건:**
- `_tmp/recon_checkpoint.json`
- `_tmp/screen_inventory.json`
- `docs/05_설계서/*/INF/INF-*.md` (1개 이상)

---

### STEP 9-0 — build_funcs_index.py

| 구분 | 내용 |
|------|------|
| **입력** | `docs/05_설계서/*/UI/*/spec.md` (api_hints)<br>`docs/05_설계서/*/INF/INF-*.md` (used_by_screens) |
| **출력** | `_tmp/funcs_index.json` |
| **스크립트** | `scripts/build_funcs_index.py` |
| **에이전트** | 없음 (LLM 없음) |
| **비고** | rd-agent, srs-agent, rtm-agent가 공유. 동일 파일 3번 cat 방지 |

---

### STEP 9-0-1 — build_si_graph.py

| 구분 | 내용 |
|------|------|
| **입력** | `docs/05_설계서/*/INF/*.md`, `docs/05_설계서/*/UI/*/spec.md`, `docs/05_설계서/*/DB_*.md` |
| **출력** | `.understand-anything/si-graph.json` |
| **스크립트** | `scripts/build_si_graph.py` |
| **에이전트** | 없음 (LLM 없음) |
| **비고** | UA 대시보드 SI 탭 시각화용 |

---

### STEP 9-1 — merge_index.py (전체 색인 3종)

| 구분 | 내용 |
|------|------|
| **입력** | `docs/05_설계서/*/INF/INF-*.md`<br>`docs/05_설계서/*/DB_*.md`<br>`docs/05_설계서/*/UI/*/spec.md` |
| **출력** | `docs/05_설계서/API_Design.md`<br>`docs/05_설계서/DB_Schema.md`<br>`docs/05_설계서/UI_Spec_v1.0.md` |
| **스크립트** | `scripts/merge_index.py` |
| **에이전트** | 없음 |

---

### STEP 9-2 — rd-agent (FUNC 생성)

| 구분 | 내용 |
|------|------|
| **입력** | `_tmp/funcs_index.json` (screens + infs 섹션) |
| **출력** | `docs/00_FUNC/FUNC_v1.0.md`<br>`docs/00_FUNC/domains/FUNC_{domain}.md` × N개 |
| **스크립트** | 없음 |
| **에이전트** | `speclinker:rd-agent` (model: **sonnet**) |
| **비고** | RECON: FUNC-{도메인}-{NNN} ID. 화면 단위 구성 (1화면 = 1~3 FUNC) |

---

### STEP 9-3 — srs-agent (SRS 생성)

| 구분 | 내용 |
|------|------|
| **입력** | `_tmp/funcs_index.json` |
| **출력** | `docs/03_기능명세서/SRS_v1.0.md`<br>`docs/03_기능명세서/domains/SRS_{domain}.md` × N개 |
| **스크립트** | 없음 |
| **에이전트** | `speclinker:srs-agent` (model: **sonnet**) |
| **비고** | 화면(UIS) 단위 use-case. 1화면 = SRS-F 1개 (복잡 화면은 최대 2~3개) |

---

### STEP 9-4 — rtm-agent (FUNC_MAP 생성)

| 구분 | 내용 |
|------|------|
| **입력** | `_tmp/funcs_index.json`<br>INF `used_by_screens` 필드<br>UIS `api_hints`<br>`docs/03_기능명세서/SRS_v1.0.md` |
| **출력** | `docs/00_FUNC/FUNC_MAP.md` (UIS→SRS→INF→SCH 매트릭스)<br>`.understand-anything/linked-req-cache.json` |
| **스크립트** | `scripts/ua_req_bridge.js` (rtm-agent 완료 후 자동 실행) |
| **에이전트** | `speclinker:rtm-agent` (model: **opus** — Constitutional 6원칙 검증) |

---

### STEP 10 — IA 맵 생성

| 구분 | 내용 |
|------|------|
| **입력** | `docs/05_설계서/*/INF/INF-*.md`<br>`docs/05_설계서/*/UI/*/spec.md`<br>`_tmp/screen_inventory.json` |
| **출력** | `_tmp/ia-map.json` |
| **스크립트** | `scripts/ia_map_builder.py` |
| **에이전트** | 없음 |
| **비고** | UA 대시보드 IA 탭에서 시각화 가능 |

**최종 체크포인트:**

| 출력 | `_tmp/recon_checkpoint.json` (`phase: "recon-complete"`) |
|------|----------------------------------------------------------|

---

## 전체 파일 의존성 요약

### `_tmp/` 파일들

| 파일 | 생성 스텝 | 소비 스텝 | 역할 |
|------|----------|----------|------|
| `mcp_status.json` | 0 | 8, 5-B | MCP 연결 상태 |
| `probe.json` | 1.5 | 1.7 | 스택 신호 |
| `kg_summary.json` | 3-0 | 3-1 | 압축된 knowledge-graph |
| `screen_plan_static.json` | 2-1 | 2-2 | 정적 발견 화면 목록 |
| `screen_plan_runtime.json` | 2.5 | 2.5 | BFS 런타임 화면 목록 |
| `screen_plan_merged.json` | 2.5 | 2.5 | 병합 화면 목록 |
| `screen_inventory.json` | 6-1 (또는 5-0) | 6-2~6-7, 7-2, 8, 9-4 | 처리 대상 화면 목록 |
| `capture_plan.json` | 6-7 | 6-2 | 화면별 캡처 전략 |
| `uis_api_hints.json` | 6-5 | 7-0 | 화면별 API 호출 URL |
| `router_inventory.json` | 5-1 | 5-1(call chain) | 컨트롤러 파일 그룹 (재시작 지원) |
| `router_inventory_with_chain.json` | 5-1 | 7-0, 7-1, 7-3 | 컨트롤러 + call chain |
| `batch_inventory.json` | 5-1 | 5-B | 배치 후보 파일 그룹 |
| `batch_inventory_with_chain.json` | 5-B | 5-B(에이전트) | 배치 + call chain |
| `poc_target_urls.json` | 5-0 | 5-1 | POC 대상 API URL |
| `inf_generation_plan.json` | 7-0 | 7-1, 7-3 | INF 생성 작업 계획 (matched/unmatched/residual) |
| `sch_draft/{domain}/` | 5-1(call chain) | 8 | SQL 추출 테이블 캐시 |
| `funcs_index.json` | 9-0 | 9-2, 9-3, 9-4 | UIS+INF 통합 색인 |
| `ia-map.json` | 10 | UA 대시보드 | 화면 계층 + INF 연결 매트릭스 |
| `recon_checkpoint.json` | 5(완료), 6(완료), 7~8(완료), 9~10(완료) | 각 Phase 진입 시 | Phase 간 상태 연결자 |
| `_unresolved_gaps.json` | 6-7 | (수동 확인용) | 미해결 INF gaps |
| `runtime_capture_report.json` | 6-2 | 6-7 | 캡처 결과 리포트 |

### `.speclinker/` 파일들

| 파일 | 생성 스텝 | 소비 스텝 | 역할 |
|------|----------|----------|------|
| `screen_plan.confirmed.json` | 2-2 또는 2.5 | 6-1 | 최종 확정 화면 목록 (BFS menuMeta 포함) |
| `profile.yaml` | 1.7 | 5-B, 8 | 프로젝트 스택·아키텍처 프로파일 |

### `docs/` 파일들

| 파일/디렉토리 | 생성 스텝 | 소비 스텝 | 역할 |
|-------------|----------|----------|------|
| `docs/04_아키텍처설계서/SAD_v1.0.md` | 3-1 | — | 아키텍처 설계서 |
| `docs/05_설계서/_domain_plan.json` | 3-1 | 3-2, 4, 5-1, 6-0~6-7, 8 | 도메인 계획 (INF/SCH/UIS 범위 배정) |
| `docs/05_설계서/{domain}/UI/{id}/spec.md` | 6-3, 6-4 | 6-5, 7-2, 9-0 | 화면 설계서 |
| `docs/05_설계서/{domain}/INF/INF-*.md` | 7-1, 7-3 | 7-4, 8, 8-1, 9-0, 9-4 | API 명세서 |
| `docs/05_설계서/{domain}/DB_{domain}.md` | 8 | 8-1, 9-1 | DB 스키마 |
| `docs/05_설계서/{domain}/BAT/BAT-*.md` | 5-B | — | 배치 명세서 |
| `docs/05_설계서/API_Design.md` | 9-1 | — | 전체 API 색인 |
| `docs/05_설계서/DB_Schema.md` | 9-1 | — | 전체 DB 색인 |
| `docs/05_설계서/UI_Spec_v1.0.md` | 9-1 | — | 전체 UI 색인 |
| `docs/00_FUNC/FUNC_v1.0.md` | 9-2 | 9-4 | 구현 기능 목록 |
| `docs/00_FUNC/FUNC_MAP.md` | 9-4 | — | 화면→SRS→INF→SCH 매트릭스 |
| `docs/03_기능명세서/SRS_v1.0.md` | 9-3 | 9-4 | 기능 명세서 색인 |

---

## 에이전트 사용 모델 요약

| 에이전트 | 사용 스텝 | 모델 | 역할 |
|---------|---------|------|------|
| `project-scanner` | 1-1 | inherit | 파일 구조 스캔 |
| `file-analyzer` | 1-2 | inherit | 노드·엣지 추출 |
| `architecture-analyzer` | 1-3 | inherit | 레이어 분류 |
| `domain-analyzer` | 1-4 | inherit | 도메인 플로우 분석 |
| `profile-agent` | 1.7 | inherit | 프로젝트 Profile 초안 |
| `convention-learner` | 1.7 (선택) | inherit | 자체 컨벤션 학습 |
| `meta-extractor` | 1.7 (선택) | inherit | 미지원 스택 strategy 생성 |
| `spec-agent` | 3-1 | **sonnet** | Phase-A: SAD + 도메인 확정 |
| `ddd-batch-agent` | 5-B | sonnet | 배치 명세 생성 |
| `ddd-ui-agent` | 6-4 | sonnet | 화면 설계서 §5 작성 |
| `ddd-api-agent` | 7-1, 7-3 | sonnet | API 명세서 생성 |
| `ddd-db-agent` | 8 | sonnet | DB 스키마 생성 |
| `rd-agent` | 9-2 | **sonnet** (RECON 다운그레이드) | FUNC 생성 |
| `srs-agent` | 9-3 | **sonnet** (RECON 다운그레이드) | SRS 생성 |
| `rtm-agent` | 9-4 | **opus** (유지) | FUNC_MAP + Constitutional 검증 |
