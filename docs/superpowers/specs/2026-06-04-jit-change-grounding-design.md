# JIT 변경 그라운딩 — 요약주입 → 그래프+실소스 주입 전환 설계서

- 작성일: 2026-06-04
- 대상: `/sl-change` (DELTA) — AIDD 변경 작업의 AS-IS 지식 주입 방식
- 배경: 변경 작업(B)에서 AS-IS를 **프로세 요약 스펙**으로 주입 → lossy·stale·coarse. 목적("소스로 어려운 부분 백업")에 역행. 대신 **그래프로 영향슬라이스 특정 + 실소스 JIT read**로 전환.

## 1. 목표

`/sl-change`의 AS-IS 그라운딩을 **요약 스펙 로드**에서 **그래프 기반 영향슬라이스 + 소스앵커 JIT read**로 바꾼다.
프로세 RECON 산출물(INF/SCH/UIS)은 **납품물·폴백**으로 유지하고, AI 주입의 1차 소스는 **구조 인덱스 + 실소스**로 승격한다.

## 2. 검토 전제 (실데이터 nkshop 확인)
- INF(657개)에 **소스앵커 file:line 존재**(`Mapper.xml:7-331`, `Controller.java`) — JIT 핵심 충족.
- 크로스링크가 스펙 파일에 내장(INF frontmatter `tables:`, SCH 링크) → `spec_graph.json` 없어도 **스펙에서 그래프 빌드 가능**.
- RECON-분석 프로젝트엔 `spec_graph`/`linked-func-cache`/`knowledge-graph` **부재**(런타임 빌드/폴백 필수). `source_index.json`은 존재.
- ripple(역방향 table→INF)은 미인덱스 → sch_draft `referencedByInfRange` 역전 또는 INF `tables:` 역색인으로 구축.
- **결론: 스펙 본문은 JIT-ready. 공백은 리트리버.**

## 3. 확정 결정
- **요약 스펙 주입 폐기**(변경 경로 한정). 그래프+소스앵커+실소스 JIT로 대체.
- **스크립트는 인덱스/앵커까지만**(zero-LLM). **실소스 read는 change/dev 에이전트**가 수행(SCH 하이브리드 철학 동일).
- `spec_graph.json` **있으면 사용, 없으면 스펙 frontmatter에서 빌드**(의존 금지 — 닭달걀 회피).
- 첨부 추출은 **선택 의존성**(python-pptx/docx/openpyxl) lazy import, 없으면 해당 포맷 스킵+안내.

## 4. 신규 컴포넌트

### 4-1. `scripts/extract_attachments.py` (신규, 입력 보강)
- 입력: `docs/변경관리/{SR-ID}/attachments/` (Jira MCP `jira_download_attachments` 산출) 또는 경로 인자.
- 처리: 포맷별 텍스트 추출 — **pptx(python-pptx, 1순위)**, docx(python-docx), xlsx(openpyxl), pdf(텍스트 레이어), txt/md(직접). 이미지/HWP는 스킵 + "내용 직접 입력" 안내.
- 출력: `docs/변경관리/{SR-ID}/_extracted.md` (파일별 추출 텍스트 합본) → 요구사항 분석 입력.
- 의존성 없으면: 해당 포맷 `[추출 불가 — 라이브러리 미설치]` 표기 후 계속.

### 4-2. `scripts/build_change_context.py` (신규, JIT 리트리버 — zero-LLM)
- 입력: SR 엔티티(키워드/ID — SR 본문 + _extracted.md에서 추출), `docs/05_설계서/`, (선택)`_tmp/spec_graph.json`/`sch_draft`.
- 그래프 빌드(인메모리):
  - 노드: INF(frontmatter inf-id/method/path/`tables:`/근거소스), SCH(sch-id/table/inf), UIS.
  - forward: INF→SCH(테이블), INF→UIS.
  - **reverse(ripple): table→INF 역색인** (다른 도메인 포함 — 공유테이블 사용처).
- 영향슬라이스 특정:
  - SR 엔티티 → INF/SCH/UIS/테이블 매칭(ID 직접 + 키워드 + path/method).
  - 매칭된 노드의 forward+reverse 1~2홉 확장 → ripple 포함 영향집합.
- 출력: `docs/변경관리/{SR-ID}/_asis_brief.md` —
  - 영향 INF/SCH/UIS 목록(ID + 한줄)
  - **각 항목의 근거소스 앵커(file:line)** ← 에이전트 JIT read 대상
  - ripple 경고(공유테이블·교차도메인 사용처)
  - 미싱 신호(앵커 없는 항목, 그래프 빌드 실패) 표기.
- **요약 스펙 본문은 싣지 않음** — 앵커만. 본문이 필요하면 에이전트가 INF/SCH 파일 또는 실소스를 직접 read.

### 4-3. `skills/sl-change/SKILL.md` (변경)
- Step 1 이후 **Step 1-D: 첨부 추출**(`extract_attachments.py`) 추가 → `_extracted.md`를 요구사항에 병합.
- 구 Step 4-5(도메인 스펙 로드) → **`build_change_context.py` 호출 + `_asis_brief.md` 기반 JIT read**로 교체:
  - 브리프의 앵커 file:line을 **에이전트가 Read**(영향 슬라이스 실소스) → 최신·정밀 AS-IS 확보.
  - ripple 경고를 영향분석에 반영.
- 프로세 스펙(INF/SCH 본문)은 **폴백**(앵커가 비거나 소스 없을 때)으로만 로드.

## 5. 불변식 (보존)
- RECON 산출물(INF/SCH/UIS/FUNC) 형식·경로 무변경 — **납품물 역할 유지**, 추가로 그래프 소스가 됨.
- `/sl-change` 외 RECON·AIDD·status 무영향.
- 추적 축 = FUNC-ID + SR. 그래프는 표시/주입 도구.
- 범용성: frontmatter 파싱은 스택중립. 첨부 추출 라이브러리는 선택.

## 6. doc-sync (MUST)
- `scripts/README.md`: extract_attachments.py·build_change_context.py 등재.
- `CLAUDE.md`: sl-change 설명에 "그래프 기반 JIT AS-IS 주입" + 버전노트 v3.5.0.
- `skills/sl-change/SKILL.md`: Step 1-D + JIT 그라운딩 단계.
- setup-deps: python-pptx/docx/openpyxl 선택 의존성 명시(강제 X).

## 7. 검증
- 합성 픽스처: INF 2개(공유테이블) + SCH → build_change_context가 ripple(table→INF 역방향)로 두 번째 INF를 영향집합에 포함하는지.
- 앵커 추출: _asis_brief에 INF 근거소스 file:line이 실려 에이전트 read 대상이 되는지.
- spec_graph 부재 시 스펙 frontmatter 빌드 폴백 동작(nkshop, spec_graph 없음).
- extract_attachments: pptx/docx 샘플 → _extracted.md 텍스트(라이브러리 없으면 graceful skip).
- 2스택(Java nkshop + 합성).

## 8. 비범위
- 의도/why 포착, 런타임 암묵의존(동적SQL·이벤트) — RECON 천장, 이번 범위 아님(앵커로 부분 완화).
- 프로세 스펙 폐기 — 안 함(납품물 유지).
- spec_graph 생성 단계 RECON 추가 — 안 함(런타임 빌드로 대체).
- 신규 LLM 에이전트 — 없음(리트리버는 스크립트, read는 기존 에이전트).
