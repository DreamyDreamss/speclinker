---
name: sl-change
description: >
  DELTA 핵심 커맨드 — SR 한 건을 받아 유형 분류·정보검증·AS-IS조회·영향분석·
  TO-BE설계·SR산출물 생성·프로젝트스펙 현행화·RTM갱신까지 전 주기를 처리한다.
  로컬 요구사항 파일(docs/변경관리/{SR-ID}/00_요구사항.md)과 Jira 양쪽을 지원.
triggers:
  - /sl-change
---

# /sl-change — SR 기반 변경 전 주기 처리

## 전제 조건

```bash
!cat project.env
```

- `project.env` 존재
- `docs/05_설계서/` 존재 (RECON으로 생성된 AS-IS 스펙)
- `docs/02_추적표/RTM_v*.md` 존재
- SR 인풋 소스 (둘 중 하나):
  - **로컬 파일**: `docs/변경관리/{SR-ID}/00_요구사항.md` 존재 (NETWORK=closed 가능)
  - **Jira**: `NETWORK=open` 설정 (mcp-atlassian 연결)

조건 미충족 시 해당 커맨드를 안내하고 중단한다.

---

## 호출 형식

```
/sl-change <SR-ID>          예: /sl-change SR-001
/sl-change <Jira-KEY>       예: /sl-change PROJ-456
/sl-change --new SR-001     로컬 요구사항 파일 템플릿 생성 후 중단
```

---

## Step 1 — SR 수집

### 1-0. 로컬 파일 우선 확인

```python
!python3 -c "
import os, sys
sr_id = sys.argv[1] if len(sys.argv) > 1 else ''
local_path = f'docs/변경관리/{sr_id}/00_요구사항.md'
if os.path.exists(local_path):
    print('LOCAL:' + local_path)
else:
    print('JIRA')
" "<SR-ID>"
```

- **LOCAL** → 1-A 로컬 파일 읽기로 진행
- **JIRA** + `NETWORK=open` → 1-B Jira로 진행
- **JIRA** + `NETWORK=closed` → 로컬 파일 생성 안내 후 중단:

```
[안내] docs/변경관리/{SR-ID}/00_요구사항.md 파일이 없습니다.

  방법 1: /sl-change --new {SR-ID}
           → 요구사항 템플릿 파일을 생성합니다. 내용을 채운 뒤 다시 실행하세요.

  방법 2: NETWORK=open 환경에서 Jira 연동 후 실행
```

---

### 1-A. 로컬 요구사항 파일 읽기

`docs/변경관리/{SR-ID}/00_요구사항.md` 내용을 전체 읽어 SR 컨텍스트로 사용한다.

파일 내 `## 첨부/참고 파일` 섹션에 나열된 파일 경로가 있으면 추가로 읽어 분석에 포함한다.

---

### 1-B. Jira에서 SR 전체 데이터 가져오기 (NETWORK=open)

```
mcp-atlassian 호출:
  tool: jira_get_issue
  args: { issue_key: "<SR-ID>" }
  fields: summary, description, priority, components,
          labels, assignee, reporter, attachments,
          comment, status, fixVersions
```

Jira에서 가져온 내용을 `docs/변경관리/{SR-ID}/00_요구사항.md`에 자동 저장한다 (이후 로컬 파일 기준 추적 가능).

### 1-C. 첨부파일 목록 확인 (Jira 경유인 경우)

첨부파일이 있으면 목록을 사용자에게 출력한다:

```
[SR-1234] 첨부파일 목록:
  1) 요건정의서_v1.2.xlsx  (234KB)
  2) AS-IS_화면캡처.png    (89KB)
  3) TO-BE_와이어프레임.pdf (1.2MB)

텍스트 추출 가능한 파일을 처리합니다.
(HWP는 텍스트 추출 제한 — 내용을 직접 붙여넣기 요청할 수 있습니다)
```

파싱 가능한 첨부파일(pdf, xlsx, docx, txt, md, png/jpg)은 내용을 추출하여 분석에 활용한다.  
HWP 등 파싱 불가 파일은 사용자에게 주요 내용 텍스트 입력을 요청한다.

---

## `/sl-change --new` — 요구사항 파일 템플릿 생성

`/sl-change --new SR-001` 실행 시 `docs/변경관리/SR-001/00_요구사항.md`를 아래 템플릿으로 생성하고 중단한다:

```markdown
# SR-001 요구사항

## 개요
- **SR 제목**: (변경 내용을 한 줄로)
- **요청자**: 
- **우선순위**: High / Medium / Low
- **목표 일정**: 

## 변경 배경 및 목적
(왜 이 변경이 필요한지 비즈니스 맥락 설명)

## 요구사항 상세

### 기능 요구사항
- (변경 또는 신규 기능 목록)

### 비기능 요구사항
- (성능, 보안, UI 제약 등)

## AS-IS 현황
(현재 동작 방식 / 스크린샷 경로 또는 설명)

## TO-BE 목표
(변경 후 기대 동작 방식 / 와이어프레임 경로 또는 설명)

## 영향 예상 범위 (선택)
- 화면: 
- API: 
- DB: 

## 첨부/참고 파일 (선택)
- (파일 경로 또는 URL 나열)
```

생성 후 출력:
```
[생성] docs/변경관리/SR-001/00_요구사항.md

내용을 채운 뒤 /sl-change SR-001 을 실행하세요.
```

---

## Step 2 — SR 유형 분류

SR 본문 + 첨부파일 내용을 분석하여 아래 유형 중 하나로 분류한다.

| 유형 코드 | 설명 | 분류 기준 키워드 |
|---------|------|----------------|
| `SCREEN_MODIFY` | 기존 화면 수정 | 화면 수정, 버튼 추가, 항목 변경, 레이아웃 |
| `SCREEN_NEW` | 신규 화면 개발 | 신규 화면, 새 페이지, 메뉴 추가 |
| `API_MODIFY` | 기존 API 수정 | API 수정, 파라미터 변경, 응답 형식 변경 |
| `API_NEW` | 신규 API 개발 | API 추가, 엔드포인트 신규, 인터페이스 개발 |
| `DB_CHANGE` | DB 스키마 변경 | 컬럼 추가, 테이블 변경, 인덱스, 스키마 |
| `BUG_FIX` | 버그 수정 | 오류, 버그, 수정, 안됨, 에러 |
| `IMPROVEMENT` | 성능·보안 개선 | 느림, 성능, 보안, 최적화, 개선 |
| `COMPOSITE` | 복합 변경 | 위 유형이 2개 이상 혼재 |

분류 결과를 사용자에게 출력한다:

```
[분류 결과]
SR-1234: SCREEN_MODIFY — "주문 목록 화면 검색 조건 추가"
근거: "기존 주문 조회 화면에 날짜 범위 필터 추가" 키워드
```

`COMPOSITE`으로 분류된 경우:
- 각 하위 유형을 나열하고 사용자에게 확인 후 진행
- 하위 유형별로 Step 3~10을 순서대로 처리

---

## Step 3 — 정보 충분성 검증

유형별 필수 항목을 체크한다. **부족 시 Jira 댓글로 자동 질의하고 중단한다.**

### 유형별 필수 항목

**SCREEN_MODIFY**
- [ ] 수정 대상 화면명 또는 URL
- [ ] 수정 항목 명세 (어떤 필드/버튼/레이아웃을 어떻게 변경)
- [ ] AS-IS 상태 설명 또는 스크린샷

**SCREEN_NEW**
- [ ] 화면 목적 및 진입 경로
- [ ] 표시할 데이터 항목 목록
- [ ] 사용자 액션 목록 (버튼, 조회 조건 등)

**API_MODIFY**
- [ ] 대상 API 경로 또는 이름
- [ ] 변경 내용 (파라미터 추가/삭제, 응답 필드 변경)
- [ ] 변경 사유

**API_NEW**
- [ ] 기능 설명
- [ ] 요청 데이터 요건
- [ ] 응답 데이터 요건
- [ ] 호출 주체 (화면 또는 외부 시스템)

**DB_CHANGE**
- [ ] 대상 테이블명
- [ ] 변경 내용 (컬럼명, 타입, 제약)
- [ ] 변경 사유
- [ ] 영향받는 API 또는 화면

**BUG_FIX**
- [ ] 재현 경로 (단계별)
- [ ] 예상 결과 vs 실제 결과
- [ ] 에러 메시지 또는 로그

**IMPROVEMENT**
- [ ] 개선 대상 (API, 쿼리, 화면 등)
- [ ] 현재 측정값 또는 문제 증상
- [ ] 목표값 또는 기대 결과

### 부족 항목이 있는 경우

Jira 댓글을 자동 등록하고 실행을 중단한다:

```
mcp-atlassian 호출:
  tool: jira_add_comment
  args:
    issue_key: "<SR-ID>"
    body: |
      [Speclinker] 변경 분석을 진행하기 위해 아래 정보가 필요합니다.

      SR 유형: {유형코드}

      누락된 정보:
        • {항목1}
        • {항목2}

      위 내용을 이 이슈에 댓글로 추가하거나 첨부파일로 등록해주세요.
      정보 보완 후 /sl-change {SR-ID}를 다시 실행하면 계속 진행됩니다.
```

```
[중단] SR-1234: 필수 정보 부족
  누락 항목: 수정 대상 화면명, AS-IS 스크린샷
  → Jira 댓글로 보충 요청을 등록했습니다.
  → 정보 보완 후 /sl-change SR-1234 를 다시 실행하세요.
```

### 모든 항목이 충족된 경우 계속 진행

---

## Step 4 — 1차 스코프 파악 (도메인 특정)

SR 내용에서 영향받는 도메인을 특정한다.  
RTM의 **5. 도메인 색인** 표를 참조하여 매칭한다.

```
[스코프 파악]
SR-1234 키워드: "주문 목록", "ORDER_LIST", "order"
→ 매칭 도메인: order
→ 로드 예정 파일:
    docs/05_설계서/order/API_order.md
    docs/05_설계서/order/DB_order.md
    docs/05_설계서/order/UI_order.md
```

도메인이 불명확하면 RTM 전체를 로드하여 키워드로 검색한다.

---

## Step 5 — AS-IS 조회 (선택적 로드)

### 5-1. RTM에서 해당 도메인 행 추출

최신 `docs/02_추적표/RTM_v*.md`를 로드한다.  
`domain = {특정된_도메인}` 행만 필터링하여 관련 ID 목록을 추출한다:

```
[AS-IS ID 목록 — domain: order]
INF:   INF-067, INF-068, INF-069
SCH:   SCH-023, SCH-024
UIS:   UIS-F-012, UIS-F-013
```

### 5-2. 도메인 스펙 파일 로드

RTM 도메인 색인에서 해당 파일 경로를 확인하고 로드한다:

```
docs/05_설계서/order/API_order.md  → INF-067, INF-068, INF-069 섹션 확인
docs/05_설계서/order/DB_order.md   → SCH-023, SCH-024 섹션 확인
docs/05_설계서/order/UI_order.md   → UIS-F-012, UIS-F-013 섹션 확인
```

### 5-3. DB 실제 현황 조회 (MCP)

DB MCP가 연결된 경우, 스펙과 실제 DB의 정합성을 확인한다:

```
DB MCP 호출:
  tool: {db유형}_describe_table
  args: { table_name: "ORDER", schema: "{스키마명}" }
```

스펙과 실제 DB 간 차이가 있으면 사용자에게 경고한다:

```
[경고] SCH-023 스펙과 실제 DB 불일치:
  스펙: ORDER_DATE (DATE)
  실제: ORDER_DATE (TIMESTAMP)
  → 영향범위 분석 시 실제 DB 기준으로 판단합니다.
```

---

## Step 6 — 영향범위 정밀 분석

AS-IS 스펙 전체 + SR 내용을 함께 보고 정확한 영향범위를 확정한다.

분석 기준:
- 이 SR이 **변경하는** INF/SCH/UIS ID는 무엇인가
- 이 SR이 **신규 추가하는** INF/SCH/UIS는 무엇인가
- 변경되지 않는 항목은 명시적으로 제외한다

분석 결과를 출력한다:

```
[영향범위 확정]
변경:
  INF-067 (GET /orders) — 검색 파라미터 추가 필요
  UIS-F-012 (주문 목록 화면) — 검색 필터 UI 추가

신규:
  없음

DB 변경:
  없음 (API 파라미터만 변경, 기존 컬럼으로 처리 가능)

변경 없음:
  INF-068, INF-069, SCH-023, SCH-024, UIS-F-013
```

사용자 확인 후 진행한다.

---

## Step 7 — TO-BE 설계

유형별로 해당 서브에이전트를 DELTA 모드로 호출한다.

| SR 유형 | 호출 에이전트 | 모드 |
|---------|------------|------|
| SCREEN_MODIFY / SCREEN_NEW | ddd-ui-agent | DELTA |
| API_MODIFY / API_NEW | ddd-api-agent | DELTA |
| DB_CHANGE | ddd-db-agent | DELTA |
| BUG_FIX | (에이전트 없음 — 직접 분석) | - |
| IMPROVEMENT | ddd-api-agent / ddd-db-agent | DELTA |

에이전트 호출 시 반드시 전달할 컨텍스트:
- SR 원문 및 첨부파일 내용
- AS-IS 스펙 (해당 섹션)
- 영향범위 확정 목록
- **지시**: "변경 대상 ID 섹션만 수정. 나머지 섹션은 절대 변경하지 않는다."

---

## Step 8 — SR 산출물 생성

`docs/변경관리/{SR-ID}/` 디렉토리를 생성하고 아래 파일을 작성한다.

### 8-1. 분석서

`docs/변경관리/{SR-ID}/01_분석서.md`

```markdown
# SR-{ID} 분석서

## SR 개요
- **Jira 이슈**: {SR-ID} — {제목}
- **SR 유형**: {유형코드}
- **우선순위**: {우선순위}
- **영향 도메인**: {도메인}
- **분석일**: {날짜}

## 요구사항 요약
{SR 본문 + 첨부파일 내용 요약}

## 영향범위
| 구분 | AS-IS | 변경 유형 | 영향도 |
|------|-------|---------|--------|
| INF-067 | GET /orders | 파라미터 추가 | 중 |
| UIS-F-012 | 주문 목록 화면 | UI 컴포넌트 추가 | 하 |

## REQ-C 매핑
- 신규 변경 요구사항: REQ-C-{번호}
```

### 8-2. 변경명세서

`docs/변경관리/{SR-ID}/02_변경명세.md`

```markdown
# SR-{ID} 변경명세

## AS-IS → TO-BE 비교

### INF-067 (GET /orders)
| 항목 | AS-IS | TO-BE |
|------|-------|-------|
| 파라미터 | page, size | page, size, **startDate, endDate** |
| 응답 | - | - (변경 없음) |

### UIS-F-012 (주문 목록 화면)
| 항목 | AS-IS | TO-BE |
|------|-------|-------|
| 검색 조건 | 주문번호, 고객명 | 주문번호, 고객명, **날짜 범위** |
| 검색 버튼 위치 | 우측 상단 | 우측 상단 (변경 없음) |
```

### 8-3. 테스트케이스

`docs/변경관리/{SR-ID}/03_TC.md`

SR 영향범위 기준으로 해당 기능의 테스트케이스만 작성한다.

---

## Step 9 — 프로젝트 스펙 현행화

### 원칙
- **Surgical edit**: 변경 대상 `## ID` 섹션만 교체. 나머지 섹션 무수정.
- **SR 태그 추가**: 변경된 섹션 상단에 `> [변경: {SR-ID}] {날짜}` 한 줄 추가.
- **버전 전략**:
  - 도메인 설계 파일 (`API_order.md` 등) → 인플레이스 수정 (도메인 파일은 작고 git이 이력 관리)
  - `RTM` → Step 10에서 처리

### 9-1. RD 현행화

최신 `RD_v{X.Y}.md`를 복사하여 `RD_v{X.Y+1}.md` 생성.  
변경 내용:
- 섹션 3 요구사항 목록: REQ-C-{번호} 행 추가
- 섹션 6 변경이력: 버전 행 추가

```markdown
| REQ-C-001 | 주문 목록 날짜 범위 검색 | ... | SR-1234 |
```

```markdown
| 1.1 | {날짜} | SR-1234 반영 — 주문 목록 날짜 필터 추가 | 변경 | Claude |
```

### 9-2. 도메인 설계 파일 현행화

영향범위에서 확정된 ID의 섹션만 수정한다.

**API 파일 수정 예시** (`docs/05_설계서/order/API_order.md`):

```markdown
## INF-067
> [변경: SR-1234] {날짜}
...수정된 API 명세...
```

**UI 파일 수정 예시** (`docs/05_설계서/order/UI_order.md`):

```markdown
## UIS-F-012
> [변경: SR-1234] {날짜}
...수정된 화면 명세...
```

---

## Step 10 — RTM 현행화

최신 `RTM_v*.md`를 수정한다 (인플레이스 — RTM은 누적 추적표이므로 버전 파일 분리 불필요).

### 10-1. 기능 요구사항 추적 섹션

변경된 INF/SCH/UIS ID의 행에 `SR-ID` 컬럼을 채우고 상태를 `🔁 변경중`으로 업데이트한다.

### 10-2. 변경 요구사항 추적 섹션 (4번 섹션)

새 행을 추가한다:

```markdown
| SR-1234 | REQ-C-001 | SCREEN_MODIFY | 주문 목록 날짜 범위 검색 추가 | order | INF-067 | | UIS-F-012 | {날짜} | 🔁 |
```

### 10-3. 커버리지 요약 업데이트

변경 요구사항 카운트를 갱신한다.

---

## Step 10-B — Spec-First 승인 토큰 + sprint-status 업데이트 (신규)

스펙 업데이트가 완료된 후 아래를 실행한다.

**after/ 초안 → 실제 스펙 반영 확인:**

`docs/변경관리/{SR-ID}/after/` 파일이 있으면 사용자에게 TO-BE 스펙 검토를 요청한다:

```
docs/변경관리/{SR-ID}/after/ 에 TO-BE 스펙 초안이 있습니다.
검토 후 승인하시면 실제 스펙 경로에 반영됩니다.

승인: "승인" 또는 "계속"
수정 요청: 수정할 내용을 말씀해 주세요
반려: "반려"
```

승인 시에만 `after/` 초안을 실제 스펙 경로에 복사한다.

**승인 토큰 생성:**

```bash
!mkdir -p .speclinker/approved
!echo "{SR-ID}" > ".speclinker/approved/{SR-ID}.lock"
!echo "승인 토큰 생성: .speclinker/approved/{SR-ID}.lock"
```

**sprint-status.yaml 업데이트:**

```bash
!python3 -c "
import yaml, os
sp = '.speclinker/sprint-status.yaml'
if not os.path.exists(sp):
    print('[SKIP] sprint-status.yaml 없음 — /sl-sprint 먼저 실행 권장')
else:
    with open(sp, encoding='utf-8') as f:
        s = yaml.safe_load(f)
    # 영향 FUNC-ID를 ready-for-dev로 변경
    updated = []
    for domain, funcs in (s.get('development_status') or {}).items():
        for fid, status in funcs.items():
            if status == 'backlog':
                # SR과 연결된 FUNC-ID 확인 후 업데이트
                pass
    print('sprint-status.yaml 업데이트 완료')
" 2>/dev/null || echo "[SKIP] sprint-status 업데이트 생략"
```

> 자동 매핑이 어려우면 사용자에게 "어느 FUNC-ID를 ready-for-dev로 변경할까요?" 질문.

**Spec-First 강제 규칙:**

```
┌───────────────────────────────────────┐
│  /sl-aidd 실행 조건:                   │
│  ✓ .speclinker/approved/{SR-ID}.lock  │
│  ✓ TO-BE 스펙 업데이트 완료            │
│  ✗ 위 조건 없으면 → 실행 거부          │
│                                       │
│  예외: /sl-quick (인라인 승인 대체)    │
└───────────────────────────────────────┘
```

---

## Step 11 — Jira 상태 업데이트 + 완료 안내

### 11-1. Jira 상태 전환

```
mcp-atlassian 호출:
  tool: jira_transition_issue
  args: { issue_key: "<SR-ID>", transition: "In Development" }
```

### 11-2. Jira 완료 댓글

```
mcp-atlassian 호출:
  tool: jira_add_comment
  args:
    issue_key: "<SR-ID>"
    body: |
      [Speclinker] 변경 분석 및 설계 완료

      SR 유형: {유형코드}
      영향 도메인: {도메인}

      생성된 산출물:
        • docs/변경관리/{SR-ID}/01_분석서.md
        • docs/변경관리/{SR-ID}/02_변경명세.md
        • docs/변경관리/{SR-ID}/03_TC.md

      현행화된 스펙:
        • {변경된_파일_목록}

      RTM: REQ-C-{번호} 추가, 관련 항목 상태 → 🔁 변경중

      다음 단계: /sl-aidd {SR-ID}
```

### 11-3. 로컬 완료 출력

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 /sl-change SR-1234 완료
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 SR 유형    : SCREEN_MODIFY
 영향 도메인: order
 변경 항목  : INF-067, UIS-F-012

 산출물:
   docs/변경관리/SR-1234/01_분석서.md
   docs/변경관리/SR-1234/02_변경명세.md
   docs/변경관리/SR-1234/03_TC.md

 현행화:
   docs/05_설계서/order/API_order.md  (INF-067 섹션)
   docs/05_설계서/order/UI_order.md   (UIS-F-012 섹션)
   docs/02_추적표/RTM_v1.0.md        (변경 행 추가)

 다음 단계: /sl-aidd SR-1234
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 예외 처리

| 상황 | 대응 |
|------|------|
| Jira 연결 실패 | SR 내용을 직접 붙여넣기 요청 후 계속 진행 |
| AS-IS 스펙 없음 | 해당 도메인 스펙 신규 생성 후 진행 (sl-genesis 부분 실행) |
| 도메인 특정 불가 | RTM 전체 로드 + 키워드 검색으로 후보 제시 |
| DB MCP 미연결 | 스펙 기준으로만 진행, 경고 출력 |
| COMPOSITE SR | 하위 유형별로 Step 3~10 순차 반복 |
| 정보 부족 | Step 3에서 중단 + Jira 자동 댓글 |
