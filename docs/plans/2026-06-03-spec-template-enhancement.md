# Spec 산출물 템플릿 개선 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** INF·SCH·BAT·UIS·FUNC_MAP 5개 산출물 템플릿을 SM 운영 + AIDD에 실용적인 수준으로 개선한다.

**Architecture:** 에이전트 프롬프트 파일(agents/*.md)을 직접 수정하여 생성 산출물 형식을 변경. 소스 분석 파이프라인(scripts/)은 건드리지 않음. 각 Task는 독립적이며 커밋 단위로 분리.

**Tech Stack:** Markdown 에이전트 프롬프트 수정, 기존 ddd-*-agent.md 패턴 준수

---

## 변경 파일 맵

| 파일 | Task | 변경 요약 |
|------|------|---------|
| `agents/ddd-api-agent.md` | Task 1 | INF에 비즈니스룰·트랜잭션순서·사이드이펙트 섹션 추가 |
| `agents/ddd-db-agent.md` | Task 2 | SCH에 코드값·비즈니스주의사항 섹션 추가 |
| `agents/ddd-batch-agent.md` | Task 3 | BAT에 비즈니스룰·재처리방법 섹션 추가 |
| `agents/ddd-ui-agent.md` | Task 4 | UIS frontmatter에 apis/related-screens 필드 추가 |
| `agents/rtm-agent.md` | Task 5 | FUNC_MAP 매핑표에 BAT 컬럼 추가 |

---

## Task 1: ddd-api-agent.md — INF 비즈니스 룰 섹션 추가

**Files:**
- Modify: `agents/ddd-api-agent.md` (Phase 1 Step 2, Phase 2-B 템플릿, Phase 3 Self-Critique)

### 배경

현재 INF는 API 계약(요청/응답)만 담는다. 서비스 레이어의 조건 분기, 상태 전이, 사이드이펙트가 문서화되지 않아 AIDD 시 AI가 틀린 코드를 생성한다. ddd-api-agent는 이미 서비스 파일을 읽으므로(Phase 1 Step 2) 추출 지침만 추가하면 된다.

---

- [ ] **Step 1: Phase 1 Step 2 서비스 읽기에 비즈니스 룰 추출 지침 추가**

`agents/ddd-api-agent.md`의 **Phase 1 Step 2** (현재 라인 76~83 "서비스 파일 읽기") 끝에 아래 블록을 추가한다:

```markdown
**비즈니스 룰 추출 (INF `## 비즈니스 규칙` 섹션용):**

서비스 파일을 읽으면서 아래를 별도로 수집한다:
- **조건 분기**: `if/switch` 문에서 비즈니스 의미 있는 조건
  (예: `if (!cstId.equals(dlgCstId))` → "통합고객이면 기타배송지 강제")
- **상태 전이**: 상태코드 컬럼에 특정 값을 대입하는 코드
  (예: `saveData.put("DLVP_RCRDG_HNG_STS_CD", "60")` → "녹취완료 상태로 변경")
- **코드값 의미**: 매직 넘버에 인접한 주석이나 변수명으로 의미를 파악
  (예: `"10"` = 기본배송지, `"40"` = 레거시 코드)
- **레거시 주의**: 코드에 인접한 주석으로 "현재 들어오지 않음", "feat:" 등 히스토리 표기 있으면 그대로 기록
- **사이드이펙트**: 메인 목적 외 추가로 INSERT/UPDATE/DELETE 되는 테이블
  (예: 배송지 저장인데 전화번호 이력도 INSERT됨)
- **트랜잭션 순서**: 메서드 내에서 DB 조작이 2단계 이상인 경우 순서 기록

GET/조회 API는 비즈니스 룰이 거의 없으므로 해당 항목만 기록하고, 없으면 섹션 자체를 생략한다.
```

---

- [ ] **Step 2: Phase 2-B INF 파일 형식에 3개 신규 섹션 추가**

`agents/ddd-api-agent.md` Phase 2-B의 INF 파일 형식 코드블록에서 `## 오류 응답` 섹션 앞에 아래 3개 섹션을 삽입한다:

```markdown
## 비즈니스 규칙

> GET/단순조회 API는 이 섹션을 생략한다. 규칙이 있을 때만 작성.

- {조건} → {처리 결과}
  (예: 통합고객(cstId ≠ dlgCstId)이면 BSC_ADDR_YN 강제 N)
- {코드값 의미}: {값} = {의미}, {값} = {의미} (레거시: {값}은 현재 미유입)
- {레거시 주의사항 — 소스 주석 기반}

## 트랜잭션 순서

> POST/PUT/DELETE 중 DB 조작이 2단계 이상일 때만 작성. GET은 생략.

1. {1단계 처리 — 테이블명 명시}
2. {2단계 처리}
3. ...

## 사이드이펙트

> 메인 목적 외 추가 처리가 있을 때만 작성. 없으면 생략.

- {조건}: {추가 처리 내용 — 테이블명 + 작업 명시}
  (예: BSC_ADDR_YN=Y인 경우에만 ORD_CST_TELNO_H DELETE 후 INSERT)
```

---

- [ ] **Step 3: Phase 3 Self-Critique에 체크 항목 3개 추가**

`agents/ddd-api-agent.md` Phase 3의 체크리스트 마지막에 추가:

```markdown
[ ] POST/PUT/DELETE API 중 서비스에서 조건 분기가 있는 경우, `## 비즈니스 규칙` 섹션이 있는가?
    → 없으면 Step 2 재분석 후 추가
[ ] DB 조작이 2단계 이상인 쓰기 API에 `## 트랜잭션 순서`가 있는가?
    → 없으면 서비스 메서드를 재확인하여 추가
[ ] 메인 테이블 외 추가 처리(이력 INSERT, 상태 UPDATE 등)가 있는데 `## 사이드이펙트`가 없는가?
    → 있으면 추가. 실제로 없는 경우만 생략 허용
```

---

- [ ] **Step 4: 변경 결과 검증 — INF 재생성 테스트**

nkshop-bos-admin 워크스페이스에서 Or231Controller.java 1개 파일로 INF를 재생성한다:

```bash
# nkshop-bos-admin 워크스페이스에서 실행
# 기존 INF-ORD-011.md 백업
cp "D:\nkshop-bos\nkshop-bos-admin\docs\05_설계서\order\INF\INF-ORD-011.md" \
   "D:\nkshop-bos\nkshop-bos-admin\docs\05_설계서\order\INF\INF-ORD-011.md.bak"
```

생성된 INF-ORD-011.md에서 아래를 수동으로 확인:
- `## 비즈니스 규칙` 섹션에 "통합고객이면 기타배송지" 조건이 있는가
- `## 트랜잭션 순서` 섹션에 6단계 처리 순서가 있는가
- `## 사이드이펙트` 섹션에 전화번호 이력 처리가 있는가

---

- [ ] **Step 5: 커밋**

```bash
cd "D:\gen-harness\plugins\speclinker"
git add agents/ddd-api-agent.md
git commit -m "feat(template): INF에 비즈니스룰·트랜잭션순서·사이드이펙트 섹션 추가 (v2.50.0)"
```

---

## Task 2: ddd-db-agent.md — SCH 코드값·비즈니스 주의사항 추가

**Files:**
- Modify: `agents/ddd-db-agent.md` (Phase 3-2 도메인 상세 파일 형식, Phase 4 Self-Critique)

### 배경

현재 SCH는 DDL/컬럼설명/인덱스/관계/ERD만 있다. 코드 컬럼(예: `BSC_ADDR_YN`, `DLVP_RCRDG_HNG_STS_CD`)의 값 의미와 운영 중 알아야 할 제약(레거시 코드, 고객당 1개 제한 등)이 없다. 이 정보는 ddd-api-agent가 서비스 파일에서 이미 읽는 정보이므로, ddd-db-agent가 INF + sch_draft를 통해 교차 추출한다.

---

- [ ] **Step 1: Phase 3-2 SCH 파일 형식에 코드값 섹션 추가**

`agents/ddd-db-agent.md` Phase 3-2의 각 테이블 항목 필수 구조 코드블록에서 `### 인덱스` 섹션 뒤에 추가:

```markdown
### 코드값

> VARCHAR/CHAR 컬럼 중 고정된 의미 값을 저장하는 컬럼만 작성. 없으면 섹션 생략.

**{컬럼명} ({컬럼 한글명})**
| 값 | 의미 | 비고 |
|----|------|------|
| {값} | {의미} | |
| {값} | {의미} | 레거시 — 현재 정상 흐름에서 미유입 |

**코드값 추출 방법:**
1. sch_draft의 컬럼 목록에서 타입이 VARCHAR/CHAR이고 컬럼명에 `_CD`, `_TP`, `_STS`, `_YN`, `_FL`, `_GB`, `_DIV` 가 포함된 컬럼 우선 검토
2. 해당 테이블을 참조하는 INF 파일 응답 예시에서 실제 값 추출
3. INF의 `## 비즈니스 규칙` 섹션에서 코드값 의미 교차 확인
4. JT_CODE, CMM_CODE 등 공통코드 테이블을 참조하면 `JT_CODE.{GROUP_CD}` 형태로 표기
```

---

- [ ] **Step 2: Phase 3-2 SCH 파일 형식에 비즈니스 주의사항 섹션 추가**

같은 코드블록에서 `### 3NF 검증 결과` 섹션 앞에 추가:

```markdown
### 비즈니스 주의사항

> 이 테이블을 운영 중 건드릴 때 알아야 할 제약·규칙. 없으면 생략.

- {제약 또는 규칙 — 소스 기반 사실로 서술}
  (예: 기본배송지(BSC_ADDR_YN=Y)는 고객당 최대 1건. 신규 등록 시 기존 것을 USE_YN=N으로 폐기 후 INSERT)
- {레거시 주의사항}
  (예: USE_YN=N 레코드는 삭제하지 않음 — BAT-ORD-003이 6개월 후 정리)

**비즈니스 주의사항 추출 방법:**
1. 이 테이블을 참조하는 INF 파일의 `## 비즈니스 규칙`, `## 트랜잭션 순서`, `## 사이드이펙트` 섹션 읽기
2. sch_draft evidence 파일(서비스 구현체)에서 INSERT/UPDATE 조건 확인
3. 소스 주석(한글 주석, feat: 표기 등) 그대로 인용 가능
```

---

- [ ] **Step 3: Phase 4 Self-Critique에 체크 항목 추가**

`agents/ddd-db-agent.md` Phase 4 체크리스트에 추가:

```markdown
[ ] VARCHAR/CHAR 컬럼 중 _CD/_TP/_STS/_YN 계열이 있는 테이블에 `### 코드값` 섹션이 있는가?
    → 없으면 INF 응답 예시 + 비즈니스 룰 섹션에서 값 의미 추출 후 추가
[ ] 동일 테이블을 참조하는 INF가 있을 때 `### 비즈니스 주의사항`이 있는가?
    → INF의 ## 비즈니스 규칙에 이 테이블 관련 내용 있으면 복사·요약하여 추가
```

---

- [ ] **Step 4: 변경 결과 검증**

nkshop-bos-admin order 도메인 SCH 재생성 시 ORD_CST_DLV_ADDR_D 테이블 항목에서 확인:
- `### 코드값`에 BSC_ADDR_YN (Y=기본, N=기타) 있는가
- `### 비즈니스 주의사항`에 "기본배송지 고객당 1건" 제약 있는가

---

- [ ] **Step 5: 커밋**

```bash
git add agents/ddd-db-agent.md
git commit -m "feat(template): SCH에 코드값·비즈니스주의사항 섹션 추가 (v2.50.0)"
```

---

## Task 3: ddd-batch-agent.md — BAT 비즈니스 룰·재처리 방법 추가

**Files:**
- Modify: `agents/ddd-batch-agent.md` (Phase 4 BAT 파일 형식, Phase 5 Self-Critique)

### 배경

현재 BAT는 처리흐름/데이터흐름/오류처리/멱등성이 있다. "비즈니스 룰" 섹션이 없어 배치 내 조건 분기(예: 특정 코드면 처리 제외, 금액 기준 등)가 문서화되지 않는다. "재처리 방법"도 멱등성에 묻혀있어 SM 운영자가 실제로 필요한 "실패 시 어떻게 다시 돌리나"가 명확하지 않다.

---

- [ ] **Step 1: Phase 4 BAT 파일 형식에 비즈니스 룰 섹션 추가**

`agents/ddd-batch-agent.md` Phase 4 BAT 파일 형식 코드블록에서 `## 오류 처리` 섹션 앞에 추가:

```markdown
## 비즈니스 규칙

> 처리 대상 선별 조건, 스킵 조건, 특수 케이스 처리. 없으면 생략.

- {조건} → {처리 방식}
  (예: USE_YN=Y AND MDF_DTM < 6개월 전인 레코드만 처리)
- {스킵 조건}: {이유}
  (예: STATUS_CD='90' 레코드는 처리 제외 — 수동 완료 처리됨)
```

---

- [ ] **Step 2: Phase 4 BAT 파일 형식에 재처리 방법 섹션 추가**

같은 코드블록에서 `## 멱등성` 섹션을 아래로 교체한다 (기존 멱등성 내용을 재처리 방법 안으로 통합):

```markdown
## 재처리 방법

| 항목 | 내용 |
|------|------|
| 멱등성 | {동일 파라미터 재실행 시 결과 — "안전" / "중복 처리 위험" / "조건부 안전"} |
| 재실행 방법 | {실패 시 재실행 커맨드 또는 절차} |
| 부분 실패 시 | {이미 처리된 건 처리 여부 — "재처리 제외" / "전체 재처리" / "오류 건만"} |
| 데이터 복구 | {실패로 인한 데이터 정합성 문제 발생 시 복구 절차} |
```

---

- [ ] **Step 3: Phase 5 Self-Critique에 체크 항목 추가**

`agents/ddd-batch-agent.md` Phase 5 체크리스트에 추가:

```markdown
[ ] 처리 대상 선별 조건(WHERE 조건)이 `## 비즈니스 규칙`에 명시됐는가?
    → 없으면 DAO/쿼리의 WHERE 절 기반으로 추가
[ ] `## 재처리 방법`의 멱등성이 "알 수 없음"이 아닌 소스 기반 서술인가?
    → DELETE 후 INSERT 패턴이면 "전체 재처리 안전", UPDATE라면 "조건부 안전" 등으로 구체화
```

---

- [ ] **Step 4: 커밋**

```bash
git add agents/ddd-batch-agent.md
git commit -m "feat(template): BAT에 비즈니스룰·재처리방법 섹션 추가 (v2.50.0)"
```

---

## Task 4: ddd-ui-agent.md — UIS frontmatter apis/related-screens 추가

**Files:**
- Modify: `agents/ddd-ui-agent.md` (spec.md frontmatter 생성 부분, Self-Critique)

### 배경

현재 UIS spec.md frontmatter에 `uis-id`와 `route` 정도만 있다. `apis:` (이 화면이 호출하는 INF 목록)와 `related-screens:` (이전/다음 화면)가 없어 IMP 자동 생성이 불가하다. §5 인터랙션 이벤트 매핑 섹션에 INF 링크가 있으므로 그것을 frontmatter로 끌어올리면 된다.

---

- [ ] **Step 1: spec.md 생성 시 frontmatter 형식 확인 및 변경**

`agents/ddd-ui-agent.md`에서 spec.md frontmatter를 생성하는 부분을 찾아 (현재 라인 약 384~392 "UIS-ID" 헤더 부분) `apis:` 와 `related-screens:` 필드를 추가한다.

기존:
```markdown
> **UIS-ID:** UIS-F-{uisId:03d} | **INF:** [INF-XXX](...) | **DB:** [SCH-XXX](...)
```

추가할 frontmatter 형식 (spec.md 파일 최상단에 들어가도록):
```yaml
---
uis-id: UIS-F-{uisId:03d}
screen-name: {화면명}
domain: {domain}
route: {route 경로 또는 파일 경로}
apis:
  - INF-{CODE}-{NNN}   # {API 기능명}
related-screens:
  - UIS-F-{NNN}        # {이전/다음/팝업 화면명} ({관계: 진입전/진입후/팝업})
---
```

**apis 추출 방법:** §5 인터랙션 이벤트 매핑 표의 "API 호출" 컬럼에서 INF-ID를 수집한다.
**related-screens 추출 방법:** §7 화면 전환 표에서 대상 UIS-ID를 수집한다. 없으면 `[]`로 빈 배열.

---

- [ ] **Step 2: Self-Critique 체크 항목 추가**

`agents/ddd-ui-agent.md` Self-Critique(Phase 7) 체크리스트에 추가:

```markdown
[ ] frontmatter에 `apis:` 필드가 있고, §5에서 호출하는 모든 INF-ID가 포함됐는가?
    → §5 인터랙션 표에서 "API 호출" 컬럼 전수 확인 후 frontmatter 동기화
[ ] frontmatter에 `related-screens:` 필드가 있는가?
    → 전환 화면이 없으면 `[]`, 있으면 §7에서 추출
```

---

- [ ] **Step 3: 커밋**

```bash
git add agents/ddd-ui-agent.md
git commit -m "feat(template): UIS frontmatter에 apis/related-screens 필드 추가 (v2.50.0)"
```

---

## Task 5: rtm-agent.md — FUNC_MAP BAT 컬럼 추가

**Files:**
- Modify: `agents/rtm-agent.md` (Phase 0-R R-2 FUNC_MAP.md 작성)

### 배경

현재 FUNC_MAP 매핑표: `FUNC-ID | 화면 | SRS-F | INF | DB 테이블 | 코드 파일 | 상태`

BAT 컬럼이 없어 배치 기능(BAT-XXX)이 FUNC_MAP에서 추적되지 않는다. SM 운영 중 "이 기능에 관련 배치가 있나"를 FUNC_MAP만 봐서는 알 수 없다.

---

- [ ] **Step 1: FUNC_MAP 매핑표 컬럼 수정**

`agents/rtm-agent.md` Phase 0-R R-2의 FUNC_MAP.md 형식에서 헤더 행을 수정한다.

기존:
```markdown
| FUNC-ID | 화면 | SRS-F | INF | DB 테이블 | 코드 파일 | 상태 |
|---------|------|-------|-----|-----------|----------|------|
| [FUNC-ORDER-001](...) | [Or701Form](...) | [SRS-F-001](...) | [INF-001](...) | TB_ORD_MST | `order/ordr/form.jsp` | ✅ 구현완료 |
```

변경 후:
```markdown
| FUNC-ID | 화면 | SRS-F | INF | BAT | DB 테이블 | 코드 파일 | 상태 |
|---------|------|-------|-----|-----|-----------|----------|------|
| [FUNC-ORDER-001](...) | [Or701Form](...) | [SRS-F-001](...) | [INF-001](...) | — | TB_ORD_MST | `order/ordr/form.jsp` | ✅ 구현완료 |
```

**BAT 컬럼 작성 원칙 (매핑 생성 원칙에 추가):**
- 배치 전용 기능(`type=batch`)은 화면 컬럼에 `— (배치)` 표시, BAT 컬럼에 `[BAT-XXX](../05_설계서/{도메인}/BAT/BAT-{NNN}.md)` 링크
- API 기능 중 관련 배치가 있으면 같이 표시 (예: 상품 등록 + 야간 배치 후처리)
- 배치가 없으면 `—`

---

- [ ] **Step 2: 커밋**

```bash
git add agents/rtm-agent.md
git commit -m "feat(template): FUNC_MAP에 BAT 컬럼 추가 (v2.50.0)"
```

---

## Task 6: plugin.json 버전 업 + 최종 커밋

**Files:**
- Modify: `.claude-plugin/plugin.json`
- Modify: `CLAUDE.md`

---

- [ ] **Step 1: plugin.json 버전 2.49.0 → 2.50.0으로 업**

`.claude-plugin/plugin.json`의 `version`과 `description`:

```json
"version": "2.50.0",
"description": "SI/ITO SDD 전주기 자동화 — 산출물↔소스 FUNC-ID 체이닝. v2.50: INF 비즈니스룰·트랜잭션·사이드이펙트, SCH 코드값·주의사항, BAT 비즈니스룰·재처리, UIS apis/related-screens frontmatter, FUNC_MAP BAT컬럼 — SM 운영 + AIDD 최적화 템플릿. ..."
```

---

- [ ] **Step 2: CLAUDE.md 버전 노트 갱신**

기존 `v2.49:` 노트 뒤에 추가:

```
v2.50: 5개 산출물 템플릿 SM+AIDD 최적화 — INF(비즈니스룰·트랜잭션순서·사이드이펙트), SCH(코드값·비즈니스주의사항), BAT(비즈니스룰·재처리방법), UIS(apis/related-screens frontmatter), FUNC_MAP(BAT컬럼).
```

---

- [ ] **Step 3: git add + commit + push**

```bash
cd "D:\gen-harness\plugins\speclinker"
git add .claude-plugin/plugin.json CLAUDE.md
git commit -m "chore: bump version to v2.50.0"
git push origin main
```

---

## Self-Review

### Spec Coverage 확인

| 요구사항 | Task |
|---------|------|
| INF에 비즈니스 룰 추가 | Task 1 |
| INF에 트랜잭션 순서 추가 | Task 1 |
| INF에 사이드이펙트 추가 | Task 1 |
| SCH에 코드값 섹션 추가 | Task 2 |
| SCH에 비즈니스 주의사항 추가 | Task 2 |
| BAT에 비즈니스 룰 추가 | Task 3 |
| BAT에 재처리 방법 추가 | Task 3 |
| UIS frontmatter apis 추가 | Task 4 |
| UIS frontmatter related-screens 추가 | Task 4 |
| FUNC_MAP BAT 컬럼 추가 | Task 5 |

### 누락 없음. 

### Placeholder 없음 — 모든 Step에 실제 추가할 내용 명시.

### Type Consistency
- INF 섹션명: `## 비즈니스 규칙`, `## 트랜잭션 순서`, `## 사이드이펙트` — 모든 Task에서 일관
- SCH 섹션명: `### 코드값`, `### 비즈니스 주의사항` — Task 2에서 일관
- frontmatter 필드: `apis:`, `related-screens:` — Task 4 전체 일관
- FUNC_MAP 컬럼: `BAT` — Task 5 일관
