# SCH 생성 개선 — 정적 스켈레톤 + LLM enrichment 하이브리드 (디스패처화)

- 작성일: 2026-06-04
- 대상: speclinker `/sl-recon` STEP 5 (SCH 명세 생성)
- 배경: SCH는 INF와 달리 디스패처 서브프로세스가 없어 ① 메인 컨텍스트 누적 ② 실패 재시도 없음 ③ 대규모 불안정. 또한 SCH 본문의 70~80%가 **사실(static)** 이라 LLM 토큰이 낭비된다.

## 1. 목표

SCH 생성을 **2단 하이브리드**로 재구성한다.
1. **정적 스켈레톤**: 사실(컬럼·타입·인덱스·FK·ERD·링크)을 **zero-token 스크립트**로 생성.
2. **LLM enrichment**: 의미(코드값·비즈니스 주의사항·컬럼 한글설명)만 **디스패처 서브프로세스**로 ddd-db-agent에 위임.

INF의 `dispatch_inf_gen.py` 패턴을 SCH에 대칭 적용하면서, 정적/의미 분리로 토큰을 ~70% 절감한다.

## 2. static / LLM 경계 (확정)

| 섹션 | 성격 | 1차 출처 |
|------|------|----------|
| frontmatter (sch-id/table/domain/domain-code/inf) | static | sch_draft + sch_todo + INF range |
| 크로스링크(FUNC/SRS/API/화면) | static | 도메인·INF range·네이밍 규칙 |
| 근거 소스 | static | sch_draft evidence |
| DDL(CREATE TABLE) / 컬럼표(타입·NULL·기본값) | static | DB 드라이버 > DDL > ORM > sch_draft |
| 인덱스 / FK 관계 | static | 〃 |
| mini-ERD · 도메인 ERD (Mermaid) | static | FK 그래프 자동 생성 |
| 컬럼 "한글 설명" | **LLM** | 주석·추론 |
| 코드값 의미(`_CD/_TP/_STS/_YN/...`) | **LLM** | INF 비즈규칙·소스 분기 |
| 비즈니스 주의사항 | **LLM** | INF·소스 추론 |

## 3. 확정 결정
- **DDL 권위 소스 = 파일 파싱 + 직접 DB 드라이버**(사용자 결정). 우선순위: **DB 드라이버(creds 有) > CREATE TABLE(*.sql/migrations) > ORM 모델 > sch_draft**.
- **MCP는 스크립트에서 호출하지 않는다**(MCP는 에이전트 런타임 전용). 권위 DDL은 드라이버로, 의미는 에이전트로.
- **오프라인·범용 우선**: 드라이버 미설치/creds 없음/무DB → 자동으로 파일 파싱 폴백. `NETWORK=closed`에서도 동작. 드라이버 의존성 강제 안 함(lazy import).
- ddd-db-agent는 **enrichment 전용 모드**로 전환 — 스켈레톤의 사실은 건드리지 않고 `[LLM-TODO]` 섹션 + 컬럼 한글설명만 채운다.

## 4. 신규/변경 컴포넌트

### 4-1. `scripts/build_sch_static.py` (신규, zero-token)
입력: `_tmp/sch_todo.json`(생성 대상 도메인·테이블), `_tmp/sch_draft/`, `docs/05_설계서/{도메인}/INF/`, `docs/05_설계서/_domain_plan.json`, (선택) DB 접속정보.

처리(도메인·테이블별):
1. **사실 수집(우선순위 merge):**
   - DB 드라이버(있으면): `information_schema.COLUMNS`(타입·NULL·DEFAULT·코멘트) + `STATISTICS`(인덱스) + `KEY_COLUMN_USAGE`/`REFERENTIAL_CONSTRAINTS`(FK).
   - `CREATE TABLE` 정규식 파싱(*.sql, migrations) — sch_draft evidence 경로 우선.
   - ORM 파싱(JPA `@Column`/`@Id`/`@ManyToOne`, Prisma `model`, TypeORM `@Entity`, SQLAlchemy `Mapped`, MyBatis `<resultMap>`).
   - sch_draft 컬럼 union(최후 보강).
2. **스켈레톤 파일 출력** (ddd-db-agent Phase 3-2 구조 그대로):
   - `docs/05_설계서/{도메인}/SCH/SCH-{CODE}-NNN.md`: frontmatter + 크로스링크 + 근거 + DDL + 컬럼표(설명 칸 비움) + 인덱스 + FK + mini-ERD.
   - 코드값/비즈니스 주의사항 섹션은 마커: `### 코드값\n<!-- LLM-TODO: 코드성 컬럼 의미 -->` / `### 비즈니스 주의사항\n<!-- LLM-TODO -->`.
   - 컬럼표 "설명" 칸: `<!-- LLM-TODO -->`(코멘트 있으면 DB 코멘트로 선채움).
   - `docs/05_설계서/{도메인}/DB_{도메인}.md`(도메인 ERD + 테이블 목록), `docs/05_설계서/DB_Schema.md`(전역 색인) — **전부 스크립트 생성**.
3. **채번**: 기존 `{도메인}/SCH/SCH-*.md` max+1(멱등). `sch_todo.existing`은 재생성 금지.
4. **enrichment 필요 여부 산출**: 코드성 컬럼(`_CD/_TP/_STS/_YN/_FL/_GB/_DIV`) 또는 참조 INF 비즈규칙이 있는 테이블만 `_tmp/sch_enrich_todo.json`에 기록. 없으면 LLM 스킵 대상.

DB 접속정보(선택): `project.env`의 `DB_TYPE`(mysql|postgres|mariadb), `DB_HOST`,`DB_PORT`,`DB_NAME`,`DB_USER`,`DB_PASSWORD`. 없거나 연결 실패 시 경고 후 파일 파싱만으로 계속.

### 4-2. `scripts/dispatch_sch_gen.py` (신규, 디스패처 — dispatch_inf_gen 미러)
입력: `_tmp/sch_enrich_todo.json`(enrichment 필요 도메인만).
- 도메인별로 `claude --print` 서브프로세스 병렬(MAX_PARALLEL=3, STAGGER, TIMEOUT), ddd-db-agent.md(enrichment 모드) + 도메인 프롬프트.
- `_tmp/sch_dispatch_status.json` done/failed, 이전 완료 자동 스킵, 실패 재실행.
- 메인 컨텍스트에 SCH 본문 누적 없음.
- enrich_todo가 비면 즉시 exit 0(전부 정적으로 충분).

### 4-3. `agents/ddd-db-agent.md` (변경 — enrichment 전용 모드)
- 신규 입력: `enrichment 모드` 플래그 + 대상 스켈레톤 파일 목록.
- 동작: 스켈레톤 SCH 파일을 읽고 **`<!-- LLM-TODO -->` 마커만** 채운다(코드값·비즈니스 주의사항·컬럼 한글설명). DDL·컬럼타입·인덱스·FK·ERD·frontmatter·링크는 **읽기 전용, 수정 금지**.
- 사실 재생성 경로(기존 Phase 1~3 from-scratch)는 **스켈레톤 없을 때만** 폴백으로 유지.

### 4-4. `skills/sl-recon/SKILL.md` STEP 5 (변경)
```
STEP 5-0  build_sch_todo.py        (그대로 — 생성 대상 판정)
STEP 5-A  build_sch_static.py .    (신규 — zero-token 스켈레톤 + DB_Schema/DB_{d} 색인)
STEP 5-B  dispatch_sch_gen.py .    (신규 — enrichment 디스패처, enrich_todo 있을 때만)
STEP 5-1  link_inf_sch_new.py      (그대로 — INF↔SCH 링크 패치)
```
구 "Agent 도구로 ddd-db-agent 3도메인씩" 인라인 호출 블록은 STEP 5-A/5-B로 대체.

## 5. 불변식 (절대 보존)
- SCH 파일 **출력 형식·경로**(개별 파일 + DB_{도메인} + DB_Schema 색인, frontmatter) 무변경 → 뷰어/링크/merge_index 무영향.
- `build_sch_todo.py`(멱등 게이트)·`link_inf_sch_new.py`(링크) 무변경.
- INF 파이프라인·RECON 그 외 STEP·AIDD·DELTA 무영향.
- 범용성: 파일 파싱은 스택 중립(Java/Next/Python/Go). DB 드라이버는 선택. **최소 2스택(Java Spring + Next.js/무DB) 검증 의무**.
- 3NF 검증 결과·통과 여부 미작성(현행 유지).

## 6. doc-sync (MUST)
- `docs/RECON_PIPELINE.md`: STEP 5를 5-0/5-A/5-B/5-1로 갱신.
- `scripts/README.md`: build_sch_static.py·dispatch_sch_gen.py 등재(사용 STEP).
- `CLAUDE.md`: ddd-db-agent 표 설명(enrichment) + 버전노트.
- `agents/ddd-db-agent.md`: enrichment 모드 반영(4-3).
- `setup-deps.js`: pymysql/psycopg2는 **선택 의존성** — 강제 설치 안 함(없으면 파일 파싱). 문서에만 명시.

## 7. 검증
- 픽스처(Java Spring, DDL/ORM 有) 1도메인: build_sch_static만으로 SCH 스켈레톤·컬럼표·FK·ERD·색인 생성, `[LLM-TODO]` 마커 위치 확인.
- enrich_todo 있는 도메인: dispatch_sch_gen → 코드값·비즈주의 채워지고 사실 섹션 불변(diff로 확인).
- DB creds 없는 환경: 드라이버 폴백 → 파일 파싱만으로 정상 산출(에러 없음).
- 멱등 재실행: 기존 SCH 스킵, 누락만 생성.
- 산출물 형식/경로 무변경 → 뷰어 INF→SCH 네비게이션 정상.
- 2스택(Java+무DB Next.js) 통과.

## 8. 비범위
- SCH 출력 템플릿 구조 변경 — 없음(섹션 동일, 생성 주체만 분리).
- MCP를 통한 스키마 조회 — 안 함(스크립트는 드라이버, 에이전트는 의미).
- INF 파이프라인 변경 — 없음.
- B(명령어 통합) 관련 — 무관.
