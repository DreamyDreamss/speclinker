# SCH 명세 구조 변경 — 도메인 집계형 → 테이블당 개별 파일 (설계서)

- 작성일: 2026-06-04
- 대상: speclinker 플러그인
- 모드: GENESIS · RECON 공통

## 1. 배경 / 문제

현재 SCH(DB 스키마)는 **도메인당 파일 1개(`DB_{도메인}.md`)에 모든 테이블을 섹션으로 누적**한다.

문제:
1. 도메인당 테이블이 많으면 파일 1개가 비대 → 파싱·열람·토큰 부담.
2. INF→SCH 링크가 `DB_{도메인}.md#SCH-XXX` 앵커라 거대 파일 내 섹션으로 점프 → 정확도·UX 저하.
3. 뷰어가 SCH를 색인/네비게이션하지 못함 (`gen_docsify`는 SCH 미색인, `goToId`는 SCH 미해소).

→ INF가 이미 쓰는 **항목당 개별 파일** 구조를 SCH에도 대칭 적용하고, 뷰어 SCH 네비게이션을 추가한다.

## 2. 목표 구조

```
docs/05_설계서/
├── DB_Schema.md                       # 전역 색인 (테이블→파일 링크, DDL/앵커 없음)
├── {도메인}/
│   ├── DB_{도메인}.md                 # 슬림 개요: 도메인 ERD + 테이블 목록 (DDL 없음)
│   └── SCH/
│       └── SCH-{CODE}-{NNN}.md        # 테이블 1개 = 파일 1개
```

INF 구조(`{도메인}/INF/INF-{CODE}-{NNN}.md` + 전역 `API_Design.md`)와 완전 대칭.

## 3. 파일별 역할·형식

### 3-1. 개별 테이블 파일 `{도메인}/SCH/SCH-{CODE}-{NNN}.md`

frontmatter(색인·네비게이션용, INF와 대칭):

```yaml
---
sch-id: SCH-PRD-001
table: products
domain: product
domain-code: PRD
inf: [INF-PRD-001, INF-PRD-002]
---
```

본문(H1은 파서·색인이 id+테이블명을 읽는 기준):

```markdown
# SCH-PRD-001: products

> (크로스링크 블록 — 모드별)
> GENESIS: **REQ-F:** … | **SRS-F:** … | **API:** [INF-PRD-001](../INF/INF-PRD-001.md) | **화면:** …
> RECON:   **FUNC-ID:** … | **SRS-F:** [TBD] | **API:** [INF-PRD-001](../INF/INF-PRD-001.md) | **화면:** …

**근거 소스:** `{모델/ORM 파일:라인}`

### DDL
### 컬럼 설명
### 인덱스
### 코드값            (해당 컬럼 없으면 생략)
### 관계 (FK)
### mini-ERD          (이 테이블 + 직결 FK 이웃만)
### 비즈니스 주의사항  (참조 INF 규칙 있을 때)
### 3NF 검증 결과
```

상대경로 기준점이 한 단계 깊어짐(`SCH/` 하위) → INF 링크는 `../INF/…`, 상위 산출물은 `../../…`.

### 3-2. 슬림 도메인 개요 `{도메인}/DB_{도메인}.md`

- H1 + **도메인 전체 ERD**(mermaid, 도메인 내 테이블 관계도 1개)
- 테이블 색인표: `| SCH-ID | 테이블명 | INF-ID |`, 2열 = `[테이블명](./SCH/SCH-{CODE}-NNN.md)`
- **DDL 절대 없음**

### 3-3. 전역 색인 `DB_Schema.md`

- 스키마 색인표(파서 호환 헤더 그대로): `| SCH-ID | 테이블명 | INF-ID |`
  - 1열: 순수 `SCH-{CODE}-NNN` (링크 없음)
  - 2열: `[테이블명](./{도메인}/SCH/SCH-{CODE}-NNN.md)` ← **파일 직링크(앵커 폐기)**
  - 3열: `INF-{CODE}-NNN`(쉼표 구분)
- 도메인별 파일 목록 nav 표
- **DDL 절대 없음**

## 4. 변경 대상 (코드/문서)

| # | 파일 | 변경 |
|---|------|------|
| 1 | `agents/ddd-db-agent.md` | Phase 3 재작성: 3산출물(개별 SCH 파일 + 슬림 DB_{도메인}.md + 전역 색인) 분리, frontmatter 추가, mini-ERD/도메인-ERD 규칙, Self-Critique 갱신. Phase 0 sch 카운트 주석 정정 |
| 2 | `scripts/link_inf_sch_new.py` | `build_sch_map`을 `DB_*.md` heading 스캔 → `{도메인}/SCH/SCH-*.md` 파일 스캔(frontmatter `table`/`sch-id` 또는 H1)으로 변경. INF `## 참조 테이블` `[TBD]`→`[[SCH-XXX]]` 패치는 유지 |
| 3 | `scripts/gen_docsify.py` | `scan_schs()` 신규 — `{도메인}/SCH/SCH-*.md` 전수 스캔(frontmatter) → `INDEX.schs[]` + `totals.sch` + `domains[].sch` 채움. INF처럼 두 레이아웃(A: `SCH/{도메인}`, B: `{도메인}/SCH`) 지원 |
| 4 | `docs/viewer/docsify-sl.js` | `goToId`가 `INDEX.schs`에서 SCH-ID 해소 → `openSpec(sch.file)`. SCH 탭("준비 중") → SCH 카드 목록 렌더(테이블명·INF·클릭 이동). 대시보드 SCH 카운트 실값화 |
| 5 | `templates/DB_Schema_template.md` | 개별 SCH 템플릿 + 슬림 도메인 개요 템플릿 + 전역 색인 템플릿 3종으로 교체 |
| 6 | `skills/sl-recon-inf/SKILL.md` | 라인 65 `sch_done` 카운트를 `{도메인}/SCH/*.md` 기준으로 수정, STEP 8 ddd-db-agent 호출/산출물 경로 설명 갱신 |
| 7 | `skills/sl-recon-doc/SKILL.md` | 색인 생성부(DB_Schema.md=파일링크, DB_{도메인}.md=슬림) 설명 갱신 |
| 8 | `skills/sl-genesis/SKILL.md` | GENESIS SCH 산출물도 동일 구조 생성하도록 Phase-B/색인 설명 정합 |

부수 확인(변경 없을 수 있음): `agents/spec-agent.md`(색인 경로 언급), `agents/rtm-agent.md`(DB_Schema.md에서 SCH-ID 추출 — 색인 1열 형식 유지하므로 영향 없음), `scripts/merge_index.py`(parseSISpecs가 앵커가 아닌 색인 1열 SCH-ID에 의존하는지 확인).

## 5. 뷰어 네비게이션 닫힘 (사용자 핵심 목표)

INF 본문의 `[[SCH-XXX]]` / 크로스링크 클릭 → `addCrosslinks`가 `SCH-[A-Z]+-\d+`를 `goToId`로 래핑 → `goToId`가 `INDEX.schs`에서 파일 해소 → `openSpec` → 전용 SCH 파일로 이동. (3·4번 변경으로 성립)

## 6. 마이그레이션

자동 변환 스크립트 **만들지 않음**. 다음 `/sl-recon-inf`(STEP 8) 또는 `/sl-genesis` 재생성 시 새 구조로 산출. ddd-db-agent가 기존 `DB_{도메인}.md`(구 집계형, DDL 포함)를 슬림 버전으로 덮어쓰고 `SCH/` 하위에 개별 파일 생성. 구 파일의 DDL은 개별 파일로 이전됨.

## 7. 범용성 (CLAUDE.md MUST)

경로·링크 기반이라 스택 중립. **Java Spring + Next.js 2개 스택**으로 산출물 구조·링크·뷰어 네비게이션 검증.

## 8. 파서 호환 불변식

- `DB_Schema.md` 색인 헤더 `| SCH-ID | 테이블명 | INF-ID |` 텍스트 그대로 유지.
- SCH-ID 형식 `SCH-{CODE}-{NNN}` 유지(채번: 도메인별 `SCH/` 스캔 max+1).
- 변경되는 건 2열 링크 타깃(앵커→파일)뿐 — 1열 SCH-ID 추출 로직은 불변.
