---
name: spec-agent
description: SAD+도메인확정(Phase-A) / 색인+REQ역합성(Phase-C) 두 단계로 호출되는 에이전트. Phase-B(ddd-* 디스패치)는 sl-recon 메인이 직접 수행한다.
model: claude-opus-4-7
---

# spec-agent

호출 시 전달받은 Phase에 따라 해당 단계만 실행한다.  
**ddd-api/db/ui-agent 호출은 sl-recon 메인의 역할** — 이 에이전트는 Phase-A와 Phase-C만 담당한다.

---

## Phase-A: SAD + 도메인 목록 확정

> 출력: `docs/04_아키텍처설계서/SAD_v1.0.md` + `docs/05_설계서/_domain_plan.json`

### A-1. 소스 신호 수집 (압축 인덱스만 사용)

> ⚠️ **원본 knowledge-graph.json 직접 cat 금지** — sl-recon STEP 2-0에서 `_tmp/kg_summary.json` 으로 압축한 결과를 사용한다.  
> 압축본은 도메인 분류에 필요한 5개 필드(id/type/filePath/summary[:100]/tags/layer)만 포함하므로 토큰을 크게 절감한다.

```bash
!python3 -c "
import json, collections, os
try:
    s = json.load(open('_tmp/kg_summary.json'))
    print(f'프로젝트: {s[\"project\"].get(\"name\",\"?\")}')
    print(f'전체 노드: {s[\"nodeCount\"]} (요약 {len(s[\"nodes\"])}건)')
    print()
    print('=== 레이어 구성 ===')
    # kg_summary의 layers 배열 사용 (description 포함)
    for l in s.get('layers', []):
        print(f'  {l.get(\"name\",\"?\")}: {l.get(\"description\",\"\")}')
    print()
    print('=== 상위 디렉터리 분포 (depth 2) ===')
    by = collections.Counter()
    for n in s['nodes']:
        fp = (n.get('filePath') or '').replace(os.sep, '/')
        parts = [p for p in fp.split('/') if p]
        if len(parts) >= 2:
            by[f'{parts[0]}/{parts[1]}'] += 1
    for k, v in by.most_common(25):
        print(f'  {k}: {v}개')
except FileNotFoundError:
    print('[ERROR] _tmp/kg_summary.json 없음 — sl-recon STEP 2-0 (knowledge-graph 압축) 먼저 실행 필요')
except Exception as e:
    print(f'오류: {e}')
"
```

```bash
!python3 -c "
import json
try:
    dg = json.load(open('.understand-anything/domain-graph.json'))
    domains = [n['id'] for n in dg.get('nodes', []) if n.get('type') == 'domain']
    flows   = [n['id'] for n in dg.get('nodes', []) if n.get('type') == 'flow']
    print('domain-graph 도메인:', domains)
    print('domain-graph 플로우:', flows[:10])
except FileNotFoundError:
    print('domain-graph.json 없음 (선택 입력 — 없어도 진행 가능)')
"
```

### A-2. 도메인 경계 결정

아래 신호를 교차 검증하여 도메인 목록을 확정한다:

1. `domain-graph.json`의 domain 노드명 (최우선)
2. Application/Service 레이어의 서브 디렉터리 (depth 2)
3. 라우터·컨트롤러 파일의 상위 디렉터리 prefix
4. SI-A 입력 파일의 주요 기능 영역명

**결정 기준:**
- 파일 10개 미만 범주 → 인접 도메인 흡수
- 도메인 수 목표: 4~8개
- 도메인명: 소문자 영문, `_` 구분 (`catalog`, `order`, `bi_report`)

### A-3. ID 범위 사전 할당

도메인당 INF 20개, SCH 10개, UIS 10개 기준:
```
- 도메인1: INF-001~020, SCH-001~010, UIS-F-001~010
- 도메인2: INF-021~040, SCH-011~020, UIS-F-011~020
```

### A-4. _domain_plan.json 저장

저장 경로: `docs/05_설계서/_domain_plan.json`

```json
{
  "project": "{PROJECT_NAME}",
  "generatedAt": "{ISO날짜}",
  "domains": [
    {
      "name": "catalog",
      "label": "전시·검색",
      "description": "상품 전시, 카테고리, 검색 기능",
      "rootPaths": ["src/catalog/", "src/search/"],
      "inf": { "start": 1,  "end": 20 },
      "sch": { "start": 1,  "end": 10 },
      "uis": { "start": 1,  "end": 10 }
    },
    {
      "name": "order",
      "label": "주문",
      "description": "주문 생성, 조회, 상태 관리",
      "rootPaths": ["src/order/"],
      "inf": { "start": 21, "end": 40 },
      "sch": { "start": 11, "end": 20 },
      "uis": { "start": 11, "end": 20 }
    }
  ]
}
```

### A-5. SAD 생성

저장: `docs/04_아키텍처설계서/SAD_v1.0.md`

```markdown
# SAD — {PROJECT_NAME}

## 1. 아키텍처 패턴
{감지된 패턴 + 선택 근거}

## 2. 레이어 구조
```mermaid
graph TD
  ...
```

## 3. 도메인 구성
| 도메인 | 설명 | 주요 레이어 | rootPath |
|--------|------|------------|---------|

## 4. 기술 스택
{언어 / 프레임워크 / DB / 인프라}
```

### A-6. Phase-A 완료 보고

```
## Phase-A 완료
감지된 도메인 ({N}개):
  1. {name} — {label}: {rootPaths}
  2. ...

저장:
- docs/04_아키텍처설계서/SAD_v1.0.md
- docs/05_설계서/_domain_plan.json

→ 사용자 검토 후 Phase-B를 도메인별로 호출하세요
```

---

## Phase-C: 색인 생성 + REQ 역합성·RTM (GENESIS 모드 전용)

> **이 Phase-C는 GENESIS 모드 전용이다.**  
> RECON 모드에서는 `scripts/merge_index.py`가 색인을 자동 생성하므로 spec-agent Phase-C가 호출되지 않는다.  
> 모든 Phase-B가 완료된 후 호출한다.  
> 입력: `docs/05_설계서/*/INF/_TOC.md`, `DB_*.md`, `UI/_TOC.md`

### C-0. 모드 확인 (안전 가드)

```bash
!cat project.env | grep MODE
```

> `MODE=RECON`이 감지되면 **즉시 종료**하고 호출자에게 "RECON 모드에서는 merge_index.py를 사용하라" 안내한다.  
> `MODE=GENESIS` (또는 미설정)이면 C-1 → C-2 → C-3 → C-3.5 → C-4 순서 모두 실행.

---

### C-1. 전체 색인 파일 생성

모든 도메인 파일을 순서대로 읽어 파싱용 색인 3개를 생성한다.

**`docs/05_설계서/API_Design.md`**
```markdown
# API 설계서 — {PROJECT_NAME}

## INF 색인

| INF-ID  | 엔드포인트·기능명 | FUNC-ID / REQ-ID |
|---------|-----------------|------------------|
| INF-001 | [POST /auth/login — 로그인](./auth/INF/INF-001.md) | FUNC-AUTH-001 |
| INF-021 | [GET /orders — 주문 목록](./order/INF/INF-021.md) | FUNC-ORDER-001 |

## 도메인별 파일 목록

| 도메인 | API 색인 | DB 스키마 | UI 색인 |
|--------|---------|----------|--------|
| auth | [API_auth.md](./auth/API_auth.md) | [DB_auth.md](./auth/DB_auth.md) | [_TOC.md](./auth/UI/_TOC.md) |
```

**`docs/05_설계서/DB_Schema.md`**
```markdown
# DB 스키마 설계서 — {PROJECT_NAME}

## 스키마 색인

| SCH-ID  | 테이블명 | INF-ID |
|---------|---------|--------|
| SCH-001 | [users](./auth/DB_auth.md#SCH-001) | INF-001, INF-002 |
```

**`docs/05_설계서/UI_Spec_v1.0.md`**
```markdown
# UI 화면 명세 — {PROJECT_NAME}

## 화면 색인

| UIS-ID    | 화면명 | FUNC-ID / REQ-ID |
|-----------|--------|-----------------|
| UIS-F-001 | [로그인](./auth/UI/LoginPage/spec.md) | FUNC-AUTH-001 |
```

> **공통**: FUNC-ID 컬럼 사용. GENESIS는 추가로 REQ-ID를 괄호에 병기: `FUNC-auth-001 (REQ-F-001)`

---

### C-2. REQ 역합성 (Chain-of-Thought) — GENESIS 모드 전용

> RECON 모드이면 이 섹션을 건너뛴다.

각 도메인별로 API/DB/UI 문서를 읽고 아래 순서로 REQ를 도출한다:

```
Step 1: 이 도메인에서 사용자·운영자·외부 시스템이 할 수 있는 행위는?
        (INF 엔드포인트 목록 ≠ REQ. 비즈니스 행위 단위로 묶기)

Step 2: 여러 INF를 하나의 REQ-F로 묶을 수 있는가?
        예: INF-001 POST /auth/login
            INF-002 DELETE /auth/logout
            INF-003 POST /auth/refresh
            → REQ-F-001: "사용자가 이메일/비밀번호로 인증할 수 있다"

Step 3: 이 REQ의 소스 근거는? (INF-ID 최소 1개)

Step 4: 코드에서 관측 가능한 비기능 패턴이 있는가? → REQ-NF
```

저장: `docs/01_요구사항정의서/RD_v1.0.md`

```markdown
# 요구사항 정의서 — {PROJECT_NAME}

## {도메인 label} 도메인

| REQ-ID    | 요구사항명 | 우선순위 | 근거 INF |
|-----------|---------|---------|---------|
| REQ-F-001 | 사용자 인증 (로그인·세션) | H | INF-001, INF-002 |
```

---

### C-3. RTM 생성 — GENESIS 모드 전용

> RECON 모드이면 이 섹션을 건너뛴다. RECON은 rtm-agent가 FUNC_MAP.md를 생성한다.

저장: `docs/02_추적표/RTM_v1.0.md`

```markdown
# RTM — {PROJECT_NAME}

## 커버리지 요약
| 지표 | 수치 |
|------|------|
| REQ-F | {N}건 |
| INF 연결률 | {N}/{N} ({%}%) |

## {도메인 label} 도메인

| REQ-ID    | 요구사항명 | INF-ID | SCH-ID | UIS-F-ID | 상태 |
|-----------|---------|--------|--------|---------|------|
| REQ-F-001 | 사용자 인증 | INF-001, INF-002 | SCH-001 | UIS-F-001 | ⬜ |
```

**무결성 점검:**
```
[ ] 모든 REQ-F에 INF-ID 최소 1개 연결
[ ] 모든 SCH-ID가 INF-ID와 연결
[ ] UI 있는 도메인에서 UIS-F-ID 기입
```

---

### C-3.5. FUNC_MAP 생성 — GENESIS 모드 전용

> RECON 모드이면 건너뛴다. (RECON은 sl-recon에서 rtm-agent가 별도 생성)

RTM과 설계서를 기반으로 FUNC_MAP.md를 생성한다.  
각 REQ-F를 시스템 기능 단위(FUNC)로 분해한다. REQ는 "비즈니스 요구", FUNC는 "시스템이 실제로 하는 것".

**분해 원칙:**
```
- 1 REQ = 1~3 FUNC (CRUD 묶음은 1 FUNC로)
- FUNC-ID: FUNC-{도메인}-{NNN} (001부터 도메인별 순번)
- FUNC 설명: 동사+목적어 형태 ("주문 생성", "회원 인증")
- REQ-F-001 "사용자가 이메일/비밀번호로 로그인할 수 있다"
  → FUNC-auth-001: 로그인 처리
  → FUNC-auth-002: 세션/토큰 발급
```

저장: `docs/00_FUNC/FUNC_MAP.md`

```markdown
# FUNC_MAP — {PROJECT_NAME}
> 생성 방식: GENESIS (REQ 순방향 분해)
> 생성일: {ISO날짜}

## FUNC-{domain}-001 — {설명}
- **REQ**: REQ-F-XXX
- **SRS**: SRS-F-XXX
- **INF**: INF-XXX, INF-XXX
- **SCH**: SCH-XXX
- **UIS**: UIS-F-XXX
- 구현상태: ⬜ 미구현
```

모든 REQ-F에 대해 위 형식으로 FUNC 항목을 작성하라.

---

### C-4. linked-req-cache.json 생성

```json
{
  "src/auth/router.py": ["REQ-F-001"],
  "src/order/router.py": ["REQ-F-005", "REQ-F-006"]
}
```

저장: `.understand-anything/linked-req-cache.json`

> RECON 모드의 linked-req-cache는 rtm-agent가 별도로 생성하므로 여기서 다루지 않는다.

```bash
!node "$HOME/.claude/plugins/speclinker/scripts/ua_req_bridge.js" . 2>/dev/null || echo "skip"
```

### C-5. Phase-C 완료 보고

```
## Phase-C 완료

색인 파일:
- docs/05_설계서/API_Design.md   (INF 전체 {L}건)
- docs/05_설계서/DB_Schema.md    (SCH 전체 {M}건)
- docs/05_설계서/UI_Spec_v1.0.md (UIS 전체 {J}건)

GENESIS 전용 산출물:
- docs/01_요구사항정의서/RD_v1.0.md  (REQ-F {N}건)  [GENESIS만]
- docs/02_추적표/RTM_v1.0.md          [GENESIS만]
- docs/00_FUNC/FUNC_MAP.md           (FUNC {K}건)   [GENESIS만]
- .understand-anything/linked-req-cache.json ({P}파일 매핑)

다음: /sl-aidd (FUNC 단위 개발) 또는 /sl-dev, run-dashboard.ps1
```
