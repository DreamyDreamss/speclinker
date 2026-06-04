---
name: sl-sprint
description: FUNC_MAP → sprint-status.yaml 생성/갱신 + 개발 진행 상태 대시보드
---

# /sl-sprint — 개발 진행 추적

## 역할

FUNC_MAP의 정적 기능 목록을 **상태가 있는 개발 트래킹**으로 전환한다.  
어떤 프레임워크 프로젝트든 동일 구조로 적용된다.

```
호출:
  /sl-sprint              FUNC_MAP → sprint-status.yaml 생성/갱신
  /sl-sprint --status     현재 진행 현황 대시보드
  /sl-sprint --next       다음 구현할 FUNC 추천
```

## 실패 조건

| 조건 | 동작 |
|------|------|
| `docs/00_FUNC/FUNC_MAP.md` 없음 | 중단 → "/sl-recon-doc 먼저 실행 필요" |

---

## [생성/갱신 모드] STEP 1: FUNC_MAP 파싱

```bash
!grep -E "^\| FUNC-" docs/00_FUNC/FUNC_MAP.md 2>/dev/null
```

각 행에서 추출:
- FUNC-ID
- 도메인 (FUNC-{DOMAIN}-NNN에서 DOMAIN 추출)
- 화면명 (UIS-ID)
- INF-ID 목록

---

## [생성/갱신 모드] STEP 2: 기존 상태 보존

```bash
!cat .speclinker/sprint-status.yaml 2>/dev/null
```

기존 파일이 있으면:
- 기존 FUNC-ID의 상태 유지 (done/review/in-progress는 절대 backlog으로 되돌리지 않음)
- FUNC_MAP에 새로 추가된 FUNC-ID만 `backlog`으로 추가
- FUNC_MAP에서 제거된 FUNC-ID는 삭제

---

## [생성/갱신 모드] STEP 3: sprint-status.yaml 저장

`skills/sl-sprint/sprint-status-template.yaml` 기반으로 작성한다.

```bash
!mkdir -p .speclinker
```

`.speclinker/sprint-status.yaml`에 Write 도구로 저장.

프레임워크 정보 채우기:
```bash
!cat docs/project-context.md 2>/dev/null | grep "프레임워크" | head -1
```

완료 메시지:
```
sprint-status.yaml 생성/갱신 완료
총 FUNC: {N}개 | 도메인: {N}개
backlog: {N} | ready-for-dev: {N} | in-progress: {N} | review: {N} | done: {N}
저장: .speclinker/sprint-status.yaml
```

---

## [대시보드 모드] STEP 4: --status 출력

```bash
!cat .speclinker/sprint-status.yaml 2>/dev/null
```

상태별 건수 집계 후 출력:

```
══════════════════════════════════
개발 진행 현황 — {PROJECT_NAME}
프레임워크: {framework}
══════════════════════════════════
✅ done           xxx / {전체} (xx%)
🔍 review           xx
🔨 in-progress       x
📋 ready-for-dev    xx
📦 backlog        xxxx
══════════════════════════════════
도메인별:
  {domain}: done {N} / 전체 {N} ({%})
══════════════════════════════════
```

---

## [추천 모드] STEP 5: --next 출력

`ready-for-dev` 상태 FUNC-ID 중 아래 기준으로 추천:
1. 가장 많은 INF가 연결된 것 (핵심 기능 우선)
2. 이전에 `in-progress`였다가 `backlog`으로 내려온 것 (재개 우선)
3. 없으면 `backlog` 중 상단 항목

```
다음 구현 추천: {FUNC-ID} — {기능명}
  연결 INF: {INF-ID 목록}
  연결 UIS: {UIS-ID}
  이유: {추천 이유}

시작하려면: /sl-aidd {FUNC-ID}
```
