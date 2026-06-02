---
name: sl-analyze
description: DELTA 모드 전용 — Jira SR 또는 변경 요청을 받아 현행 설계 대비 변경영향분석서(CIA)를 작성. /sl-change 실행 전 반드시 먼저 실행.
triggers:
  - /sl-analyze
---

# /sl-analyze — 변경영향분석서 작성

SR(Service Request) 또는 변경 요청을 현행 설계와 대조하여  
**무엇이 어디까지 바뀌어야 하는지** 확정한 뒤 `/sl-change`로 넘깁니다.

## 호출 형식

| 형식 | 용도 |
|------|------|
| `/sl-analyze --jira <SR-ID>` | Jira MCP로 SR 조회 후 분석 |
| `/sl-analyze --jira-batch <JQL>` | JQL로 여러 SR 일괄 분석 |
| `/sl-analyze` | 수동 입력 모드 (변경 내용 직접 기술) |

## 실행 전 확인

```bash
!cat project.env
!ls docs/05_설계서/API_Design.md docs/04_아키텍처설계서/SAD_v1.0.md 2>/dev/null
```

`docs/05_설계서/`가 없으면 분석 기준이 없으므로 중단하고 안내한다.

`docs/변경관리/` 디렉토리가 없으면 생성한다 (DELTA는 sl-init을 거치지 않으므로):

```bash
!mkdir -p docs/변경관리
```

---

## STEP 1 — SR 수집

### Jira MCP (`--jira`)

```
Jira MCP 호출:
  - tool: get_issue
  - issue_key: <SR-ID>
  - fields: summary, description, acceptance_criteria, priority, components, fixVersions, reporter
```

### 수동 입력

사용자에게 다음 항목을 물어본다:

```
변경 요청 내용을 입력해 주세요:

1. 변경 제목:
2. 변경 배경/이유:
3. 요청 기능/동작:
4. 기대 결과 (완료 기준):
5. 영향 예상 영역 (알고 있다면):
```

---

## STEP 2 — 현행 시스템 분석 (AS-IS)

현행 설계서를 읽어 SR과 관련된 현재 상태를 파악한다:

```bash
!cat docs/04_아키텍처설계서/SAD_v1.0.md
!cat docs/05_설계서/API_Design.md
!cat docs/05_설계서/DB_Schema.md
```

`si-graph.json`이 있으면 SR의 키워드로 관련 노드를 탐색한다:

```bash
!node -e "
const fs = require('fs');
if (!fs.existsSync('.understand-anything/si-graph.json')) { console.log('si-graph 없음 — 설계서 직접 탐색'); process.exit(0); }
const g = JSON.parse(fs.readFileSync('.understand-anything/si-graph.json', 'utf-8'));
const keyword = process.argv[1].toLowerCase();
const hits = g.nodes.filter(n =>
  (n.label||'').toLowerCase().includes(keyword) ||
  (n.description||'').toLowerCase().includes(keyword)
);
console.log('관련 노드:', hits.map(n => n.id).join(', '));
" -- <SR_키워드>
```

---

## STEP 3 — 영향 범위 확정

현행 분석 결과를 바탕으로 영향받는 영역을 정리한다:

| 영역 | 영향 여부 | 변경 내용 요약 |
|------|---------|--------------|
| SRS | O/X | |
| API (INF-XXX) | O/X | |
| DB (SCH-XXX) | O/X | |
| UI (UIS-F-XXX) | O/X | |
| 코드 모듈 | O/X | |
| 테스트케이스 | O/X | |

---

## STEP 3-B — Before 스냅샷 + After 초안 자동 생성 (신규)

영향 INF/UIS 파일이 확정되면 변경 전/후를 보존한다.

**디렉토리 생성:**
```bash
!mkdir -p "docs/변경관리/{SR-ID}/before" "docs/변경관리/{SR-ID}/after"
```

**Before 스냅샷 (현재 스펙 그대로 복사):**

영향 INF/UIS 파일 각각을 Read한 후 `docs/변경관리/{SR-ID}/before/` 에 동일한 이름으로 Write한다.
```
docs/변경관리/{SR-ID}/before/INF-PRD-129.md  ← 현재 스펙 그대로
docs/변경관리/{SR-ID}/before/UIS-PRD-201.md
```

**After 초안 자동 생성 (AI 변경 반영):**

SR의 요구사항을 Before 파일에 반영하여 `docs/변경관리/{SR-ID}/after/` 에 초안을 생성한다.
- 추가될 파라미터/필드: `[신규]` 표기
- 제거될 파라미터/필드: `~~취소선~~` 표기
- 변경될 내용: 값 교체 후 `<!-- 변경: {이전값} → {새값} -->` 주석

```
docs/변경관리/{SR-ID}/after/INF-PRD-129.md   ← 변경사항 반영 초안
docs/변경관리/{SR-ID}/after/UIS-PRD-201.md
```

**Diff 뷰 생성:**

`docs/변경관리/{SR-ID}/01_스펙변경_diff.md` 생성:

```markdown
# 스펙 변경 Diff — {SR-ID}

## INF-PRD-129 변경 내용

+ 추가: `category_id` (Integer, 필수) — 카테고리 필터링용
- 제거: `type_cd` (String) — category_id로 통합
~ 변경: `sort_order` 기본값 `"asc"` → `"desc"`
```

---

## STEP 4 — 변경영향분석서 작성

분석 결과를 `docs/변경관리/CIA-<SR-ID>.md`로 저장한다:

```markdown
# 변경영향분석서 (CIA) — <SR-ID>

## 1. 변경 개요
- **SR**: <SR-ID>
- **제목**: {sr.summary}
- **요청자**: {sr.reporter}
- **우선순위**: {sr.priority}
- **분석일**: <오늘_날짜>

## 2. 변경 배경
{sr.description}

## 3. AS-IS (현행)
> 현재 설계서 기준으로 관련 기능의 현재 동작 설명

## 4. TO-BE (변경 후)
> SR의 요구사항대로 동작이 어떻게 바뀌어야 하는지

## 5. 영향 범위
| 영역 | 대상 ID | 변경 내용 |
|------|---------|---------|
| SRS  | SRS-F-XXX | |
| API  | INF-XXX | |
| DB   | SCH-XXX | |
| UI   | UIS-F-XXX | |

## 6. REQ-C 생성
- REQ-C-<번호>: {변경 요구사항 제목}

## 7. 완료 기준
{sr.acceptance_criteria}
```

---

## ✋ STEP 5 — 사용자 검토 (필수 체크포인트)

작성된 CIA 내용을 출력하고 반드시 확인을 받는다:

```
변경영향분석서를 검토해 주세요.

수정이 필요하면 말씀해 주세요.
문제 없으면 "확인" 또는 "계속"을 입력해 주세요.
```

**확인 전 STEP 6으로 절대 진행하지 않는다.**

---

## STEP 6 — 완료 처리

```
분석 완료.

생성 파일:
- docs/변경관리/CIA-<SR-ID>.md

확정된 변경 범위:
  - 영향 도메인: {도메인_목록}
  - REQ-C: REQ-C-<번호>

다음 단계: /sl-change REQ-C-<번호>
```

`NETWORK=open`이면 Jira SR 상태를 "In Analysis → In Progress"로 업데이트한다.
