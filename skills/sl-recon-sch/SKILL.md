---
name: sl-recon-sch
description: RECON Phase 2.5 — INF 생성 후 DB 스키마(SCH) 명세를 생성한다. 추출대상 테이블 레지스트리 갱신 + ddd-db-agent enrichment. /sl-recon-inf(INF) 완료 후 실행.
triggers:
  - /sl-recon-sch
---

# /sl-recon-sch — SCH(DB 스키마) 명세 생성

> `/sl-recon`에서 분리된 **독립 SCH 생성 단계**. INF가 먼저 생성돼 있어야 한다(SCH 추출대상=INF `tables:` 합집합).
> INF/UIS를 고친 뒤 SCH만 다시 만들고 싶을 때 단독 재실행한다.

## 전제 조건

```bash
!python -c "import os,sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
plan=os.path.exists('docs/05_설계서/_domain_plan.json');
import glob; inf=len(glob.glob('docs/05_설계서/*/INF/INF-*.md'));
print('_domain_plan.json:', '있음' if plan else '없음');
print('INF 파일:', inf, '개');
print('→ /sl-recon-inf 먼저 실행 필요' if not (plan and inf) else '→ SCH 생성 진행 가능')"
```

- `docs/05_설계서/_domain_plan.json` 없음 또는 INF 0개 → **중단**, `/sl-recon` 먼저 안내.

---

## STEP 5-0': 추출대상 테이블 레지스트리 갱신

추출대상 테이블 목록(발견출처 INF/SQL/UIS + SCH 생성여부)을 `.speclinker/table_registry.json`에 영속 기록한다.
SpecLens가 이 레지스트리로 "추출대상 vs 생성/미생성"을 표시한다.

```bash
!python "{PLUGIN_PATH}/scripts/build_table_registry.py" .
```

> zero-LLM·멱등·carry-forward. SQL(`_tmp/sch_draft`)·UIS 연결에서 발견된 테이블도 기록되지만,
> **자동 생성 대상은 INF `tables:`만**이다(아래 5-0). SQL/UIS-only 테이블은 뷰어에 '미생성'으로 노출되어
> [⚙ 생성] 버튼으로 온디맨드 생성한다.

---

## STEP 5: SCH 명세 생성 (ddd-db-agent)

> `resolve_call_chain.py`가 생성한 `_tmp/sch_draft/` + INF 파일의 `tables:` frontmatter를 기반으로
> 도메인별 DB 스키마(SCH)를 생성한다.

```bash
!python -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
import json, os
plan = json.load(open('docs/05_설계서/_domain_plan.json'))
sch_draft_dir = '_tmp/sch_draft'
domains_with_draft = []
if os.path.exists(sch_draft_dir):
    for d in plan['domains']:
        domain_draft = os.path.join(sch_draft_dir, d['name'])
        if os.path.isdir(domain_draft):
            tables = os.listdir(domain_draft)
            domains_with_draft.append((d['name'], len(tables)))
if domains_with_draft:
    print('SCH 초안 (sch_draft):')
    for name, cnt in domains_with_draft:
        print(f'  {name}: 테이블 {cnt}개')
else:
    print('sch_draft 없음 — ddd-db-agent가 INF tables: frontmatter + SQL 직접 분석')
print()
print(f'처리 도메인: {len(plan[\"domains\"])}개')
"
```

### STEP 5-0: SCH 스킵 판정 (idempotency)

도메인별로 **기대 테이블(INF `tables:` 합집합) 대비 이미 생성된 SCH(frontmatter `table:`)**를 비교해, 누락 테이블이 없는 도메인은 스킵하고 **생성 대상만 `_tmp/sch_todo.json`에 기록**한다. (INF의 `group_already_done`과 동형 — 재실행 안전)

```bash
!python "{PLUGIN_PATH}/scripts/build_sch_todo.py" .
```

> 누락 테이블이 0인 도메인은 스킵된다(sch_todo.json에서 제외). 부분 생성 도메인은 `existing`을 넘겨 **누락분만** 생성한다.

### STEP 5-0.5: 쿼리 패턴 채굴 (zero-token — JIT 기계 레이어)

소스 SQL/XML에서 **관찰된 조인쌍 + 상시 필터 관례**(`scan_query_patterns.py`)와 **코드값 리터럴**(`scan_code_literals.py`)을
`docs/05_설계서/_machine/`(영속)에 추출한다. build_sch_static이 이를 읽어 SCH의 `### 관계`·`🔧 쿼리 작성 가이드`를 채우고,
AIDD/JIT는 이 JSON을 **마크다운 재파싱 없이 직접 소비**한다. (조인 정확성·상시필터 = 소스에만 존재하는 사실 → 카탈로그로는 불가)

```bash
!python "{PLUGIN_PATH}/scripts/scan_query_patterns.py" . --out docs/05_설계서/_machine/query_patterns.json
!python "{PLUGIN_PATH}/scripts/scan_code_literals.py" . --out docs/05_설계서/_machine/code_literals.json
```

> 레거시 DB는 FK 미선언이 흔해 `*_get_foreign_keys`가 비어 나온다 — 이때 **관찰 조인이 유일한 JOIN 근거**다.
> 무소스/무쿼리면 빈 JSON(graceful) — build_sch_static은 관찰 섹션을 생략한다.

### STEP 5-A: 정적 스켈레톤 생성 (build_sch_static.py — zero-token)

사실(컬럼·타입·키·인덱스·FK·관찰조인·상시필터·mini-ERD·크로스링크·도메인개요·전역색인)을 **스크립트로** 생성한다. LLM 토큰 0.
의미 섹션(코드값·비즈니스 주의사항·컬럼 한글설명·상시필터 의미)은 `<!-- LLM-TODO -->` 마커로 남긴다.

```bash
!python "{PLUGIN_PATH}/scripts/build_sch_static.py" .
```

> **컬럼 타입 권위 순위**: DB 드라이버(project.env `DB_TYPE`/`DB_HOST`/…) > `CREATE TABLE`(*.sql) > ORM > sch_draft(이름만).
> 무DB·무DDL이면 컬럼명 스켈레톤 + 타입칸 `<!-- LLM-TODO -->`. 산출물: 개별 `SCH-{CODE}-NNN.md` + `DB_{도메인}.md` + `DB_Schema.md` + `_tmp/sch_enrich_todo.json`(의미보강 필요 도메인).
> 기존 SCH는 재생성하지 않고 채번을 이어간다(멱등). 3NF 검증 결과·통과 여부는 작성하지 않는다.

### STEP 5-B: 의미 enrichment 디스패치 (dispatch_sch_gen.py)

코드성 컬럼/INF 비즈규칙이 있어 보강이 필요한 도메인(`_tmp/sch_enrich_todo.json`)만,
`ddd-db-agent`(enrichment 모드)를 **서브프로세스로 병렬 호출**해 `<!-- LLM-TODO -->`만 채운다.
사실 섹션은 건드리지 않으며, 메인 컨텍스트에 SCH 본문이 쌓이지 않는다(컨텍스트 격리).

```bash
!python "{PLUGIN_PATH}/scripts/dispatch_sch_gen.py" .
```

> exit 0 = 완료(또는 enrichment 대상 없음 — 전부 정적으로 충분).
> exit 1이면 `_tmp/sch_dispatch_status.json`의 `failed` 확인 후 재실행 — 완료 도메인은 자동 스킵.

### STEP 5-1: INF → SCH 링크 패치 (link_inf_sch_new.py)

ddd-db-agent 완료 후, INF 파일의 `## 참조 테이블` 셀 `[TBD]`를 `[[SCH-{CODE}-NNN]]` 링크로 교체한다.
LLM 재호출 없이 스크립트가 `{도메인}/SCH/SCH-*.md` frontmatter를 읽어 테이블명↔SCH-ID를 매칭 — 토큰 절약.
**이 패치가 뷰어 INF→SCH 네비게이션(`goToId`/크로스링크)의 근거다.**

```bash
!python "{PLUGIN_PATH}/scripts/link_inf_sch_new.py" .
```

---

## STEP 6: 레지스트리·인덱스 갱신 + 다음 단계

```bash
!python "{PLUGIN_PATH}/scripts/build_table_registry.py" .     # generated 여부 반영(생성 후 재계산)
!python "{PLUGIN_PATH}/scripts/gen_docsify.py" .              # SpecLens 인덱스 갱신
```

```
SCH 생성 완료.
다음: /sl-recon-uis (화면설계서) → /sl-recon-doc (FUNC/SRS/FUNC_MAP)
SpecLens 도메인 SCH 탭에서 추출대상 테이블 대비 생성/미생성 상태를 확인할 수 있습니다.
```
