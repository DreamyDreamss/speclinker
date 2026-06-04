---
name: sl-genesis
description: GENESIS 모드 전용 — 인터뷰·회의록 문서에서 RD/SRS/SAD/DDD 전체 산출물을 순방향으로 생성. Phase-A(SAD+도메인확정)→사용자검토→Phase-B(INF/SCH/UIS 생성)→Phase-C(색인+REQ+RTM+FUNC_MAP) 순으로 진행.
triggers:
  - /sl-genesis
---

# /sl-genesis — 순방향 산출물 생성 (GENESIS)

인터뷰·회의록·기획서 등 입력 문서에서 전체 설계 산출물을 생성합니다.  
GENESIS 모드 (`project.env`의 `MODE=GENESIS`)에서 실행합니다.

## 호출 형식

```
/sl-genesis [파일경로]
```

`파일경로`는 `docs/00_입력자료/` 하위 파일 또는 여러 파일의 공백 구분 목록.

## 실행 전 확인

```bash
!cat project.env
!ls docs/00_입력자료/
```

`MODE=GENESIS`가 아니면 실행 중단한다:
- 코드 역분석이 필요하면 → `/sl-recon`
- 변경 관리가 필요하면 → `/sl-change`

입력 파일이 없으면 `docs/00_입력자료/`에 파일을 넣도록 안내한다.

---

## STEP 1 — 입력 문서 읽기

지정된 파일을 모두 읽고 내용을 요약한다:

```bash
!ls -la docs/00_입력자료/
```

---

## STEP 2 — Phase-A: SAD + 도메인 목록 확정

`agents/spec-agent.md`를 서브에이전트로 실행한다.

> spec-agent에게 (Phase-A, GENESIS):  
> 입력 파일들을 분석하여 도메인을 식별하고  
> SAD(`docs/04_아키텍처설계서/SAD_v1.0.md`)와 도메인 계획(`docs/05_설계서/_domain_plan.json`)을 생성하라.  
> 도메인 수는 4~8개, 각 도메인에 INF/SCH/UIS ID 범위를 사전 배정하라.  
> 코드가 없으므로 입력 문서에서 도메인을 추론한다.

```bash
!cat docs/05_설계서/_domain_plan.json
```

---

## ✋ STEP 3 — 사용자 도메인 검토 (필수 체크포인트)

`_domain_plan.json`의 내용을 사용자에게 출력하고 **반드시 확인을 받는다.**

```bash
!python3 -c "
import json
plan = json.load(open('docs/05_설계서/_domain_plan.json'))
print(f'프로젝트: {plan[\"project\"]}')
print()
print('도메인 목록:')
for i, d in enumerate(plan['domains'], 1):
    inf = f'INF-{d[\"inf\"][\"start\"]:03d}~{d[\"inf\"][\"end\"]:03d}'
    sch = f'SCH-{d[\"sch\"][\"start\"]:03d}~{d[\"sch\"][\"end\"]:03d}'
    uis = f'UIS-F-{d[\"uis\"][\"start\"]:03d}~{d[\"uis\"][\"end\"]:03d}'
    print(f'  {i}. {d[\"name\"]:15} {d[\"description\"][:30]:30} {inf} {sch} {uis}')
print(f'\n총 {len(plan[\"domains\"])}개 도메인')
"
```

수정 없으면 "계속", 수정 필요하면 변경 내용 입력 받아 `_domain_plan.json` 수정 후 진행.  
**확인 전 STEP 4 절대 진행 금지.**

---

## STEP 4 — Phase-B: INF · SCH · UIS 생성 (ddd-* 에이전트 직접 호출)

> **호출 구조 주의**: sl-genesis 메인이 ddd-* 에이전트를 직접 호출한다 (1단계).  
> spec-agent를 경유하지 않는다.

`docs/05_설계서/_domain_plan.json`의 모든 도메인에 대해 세 그룹을 순서대로 실행한다.

**[그룹 A] ddd-api-agent — 도메인당 1호출 (최대 3개씩 배치 병렬)**

> ⚠️ 토큰 절약: 도메인 전체를 한 번에 띄우지 말고 **3개씩 배치**로 나눠 순차 실행한다.
> 예: 도메인이 9개면 → [1,2,3] 완료 → [4,5,6] 완료 → [7,8,9]

```
도메인 목록을 3개씩 묶어 배치 단위로 반복:
  각 배치 내에서 Agent 도구 호출 (배치 내 동시):
  subagent_type: "speclinker:ddd-api-agent"
  description: "{도메인명} INF 생성 (GENESIS)"
  prompt: |
    처리 대상 파일: docs/00_입력자료/{입력파일명}  ← 요구사항 문서
    도메인: {도메인명}
    도메인 설명: {description}
    INF 범위: INF-{inf.start:03d} ~ INF-{inf.end:03d}
    SAD: docs/04_아키텍처설계서/SAD_v1.0.md
    MODE: GENESIS
    워크스페이스: {현재 작업 디렉토리 절대경로}
```

> GENESIS 모드에서 ddd-api-agent는 소스 파일 파싱 대신 요구사항 문서와 도메인 설명에서 API를 추론하여 INF-NNN.md를 생성한다.

**[그룹 B] ddd-db-agent — 도메인당 1호출 (그룹A 완료 후 3개씩 배치 병렬)**

```
도메인 목록을 3개씩 묶어 배치 단위로 반복:
  각 배치 내에서 Agent 도구 호출 (배치 내 동시):
  subagent_type: "speclinker:ddd-db-agent"
  description: "{도메인명} SCH 생성 (GENESIS)"
  prompt: |
    도메인: {도메인명}
    SCH 범위: SCH-{sch.start:03d} ~ SCH-{sch.end:03d}
    INF 디렉토리: docs/05_설계서/{도메인명}/INF/
    가용 DB MCP 서버: []  ← GENESIS는 MCP 없음
    MODE: GENESIS
    워크스페이스: {현재 작업 디렉토리 절대경로}

    산출물 (테이블당 개별 파일 구조 — INF와 대칭):
    - docs/05_설계서/{도메인명}/SCH/SCH-{CODE}-NNN.md (테이블 1개=파일 1개, frontmatter 필수)
    - docs/05_설계서/{도메인명}/DB_{도메인명}.md (슬림 개요: 도메인 ERD + 테이블 목록, DDL 없음)
    - docs/05_설계서/DB_Schema.md (전역 색인, 파일 직링크)
    ※ 3NF 검증 결과·통과 여부 섹션은 작성하지 않는다.
```

**[그룹 C] ddd-ui-agent — 도메인당 1호출 (그룹A 완료 후 3개씩 배치 병렬)**

```
도메인 목록을 3개씩 묶어 배치 단위로 반복:
  각 배치 내에서 Agent 도구 호출 (배치 내 동시):
  subagent_type: "speclinker:ddd-ui-agent"
  description: "{도메인명} UIS 생성 (GENESIS)"
  prompt: |
    도메인: {도메인명}
    UIS 범위: UIS-F-{uis.start:03d} ~ UIS-F-{uis.end:03d}
    INF 디렉토리: docs/05_설계서/{도메인명}/INF/
    입력 문서: docs/00_입력자료/{입력파일명}
    MODE: GENESIS
    워크스페이스: {현재 작업 디렉토리 절대경로}
```

> 그룹 B와 C는 그룹 A 완료 후 동시에 시작한다.  
> **모든 그룹 완료 전 STEP 5 절대 진행 금지.**

---

## STEP 5 — Phase-C: REQ 작성 + RTM 생성

`agents/spec-agent.md`를 서브에이전트로 실행한다.

> spec-agent에게 (Phase-C, GENESIS):  
> `docs/05_설계서/` 하위 모든 도메인 파일을 읽어  
> 전체 색인(API_Design.md, DB_Schema.md, UI_Spec_v1.0.md)을 생성하고  
> REQ는 입력 문서 기반으로 작성(역합성이 아닌 순방향)하여 RD_v1.0.md를 작성하고  
> RTM_v1.0.md를 도메인별 섹션으로 작성하라.

---

## 완료 안내

```
산출물 생성이 완료되었습니다.

생성 파일:
- docs/04_아키텍처설계서/SAD_v1.0.md
- docs/05_설계서/{도메인}/ × N개
- docs/05_설계서/API_Design.md / DB_Schema.md / UI_Spec_v1.0.md
- docs/01_요구사항정의서/RD_v1.0.md
- docs/02_추적표/RTM_v1.0.md
- docs/00_FUNC/FUNC_MAP.md          ← REQ를 FUNC 단위로 분해

대시보드: run-dashboard.ps1 → http://localhost:5173 → SDD 탭
다음 단계:
  /sl-aidd             ← FUNC 단위 AI 개발 파이프라인 (권장)
  /sl-aidd --list      ← 구현할 FUNC 목록 확인
  /sl-dev              ← 수동 코드 생성
```
