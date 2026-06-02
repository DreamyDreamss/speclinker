---
name: sl-drift
description: INF 근거소스 기반으로 코드 변경됐는데 스펙이 미업데이트된 "스펙 드리프트"를 자동 감지
---

# /sl-drift — 스펙-코드 정합성 주기 감지

## 역할

스펙 없이 직접 코드를 수정하는 "스펙 드리프트"를 자동 감지한다.  
INF 파일의 `근거 소스` 경로를 기준으로 추적하므로 프레임워크에 무관하게 동작한다.

```
호출:
  /sl-drift               전체 도메인 검사 (기본: 최근 30일)
  /sl-drift product       특정 도메인만
  /sl-drift --since 30d   최근 N일 변경 파일 대상
  /sl-drift --since 7d    최근 7일
```

## 실패 조건

| 조건 | 동작 |
|------|------|
| git 저장소 아님 | 중단 → "git 저장소에서만 실행 가능" |
| `docs/05_설계서/` INF 없음 | 중단 → "/sl-recon 먼저 실행 필요" |

---

## STEP 1: 변경 파일 탐색

```bash
!git log --since="{기간}" --name-only --format="" 2>/dev/null | sort -u | grep -v "^$"
```

기간 파싱:
- `--since 30d` → `30 days ago`
- `--since 7d` → `7 days ago`
- 기본값: `30 days ago`

도메인 필터가 있으면:
```bash
!git log --since="{기간}" --name-only --format="" -- "**/{도메인}/**" 2>/dev/null | sort -u
```

---

## STEP 2: INF 근거소스 매핑

모든 INF 파일에서 근거 소스 경로를 추출한다:

```bash
!grep -rh "근거 소스:" docs/05_설계서/*/INF/INF-*.md 2>/dev/null | grep -v "\[TBD\]"
```

각 INF의 근거소스 파일 경로 → INF-ID 역매핑 딕셔너리 구성.

---

## STEP 3: 드리프트 판정

변경된 각 소스 파일에 대해:

**DRIFT 판정 조건:**
1. 변경 파일이 어떤 INF의 `근거 소스`와 매핑됨
2. 해당 INF 파일의 수정일 < 소스 파일의 최근 git commit 날짜

```bash
!git log -1 --format="%ai" -- "{소스_파일_경로}" 2>/dev/null
!git log -1 --format="%ai" -- "docs/05_설계서/{도메인}/INF/{INF-ID}.md" 2>/dev/null
```

**NEW 판정 조건:**
1. 변경 파일에 새 라우트/핸들러가 추가됨 (파일 diff에서 `@GetMapping`/`router.get`/`@app.get` 등 신규 패턴 감지)
2. 해당 파일을 근거소스로 하는 INF가 없음

**OK:** 위 조건 해당 없음

---

## STEP 4: 보고서 출력

```
═══════════════════════════════════
스펙 드리프트 감지 결과 — {날짜}
대상: {기간} 변경 파일 {N}개
═══════════════════════════════════
DRIFT  {N}건 — 코드 변경됐으나 스펙 미업데이트
  {INF-ID}
    근거소스: {소스_파일_경로}
    소스 최근 변경: {날짜}
    스펙 마지막 업데이트: {날짜}
    → /sl-change로 스펙 업데이트 필요

NEW    {N}건 — 스펙 없는 신규 코드 감지
  {소스_파일_경로}
    신규 라우트: {감지된 라우트}
    대응 INF 없음 → /sl-recon --single 실행 권장

OK     {N}건 — 정합
═══════════════════════════════════
```

DRIFT + NEW가 0건이면:
```
✅ 스펙 드리프트 없음 — 모든 소스({N}건)가 스펙과 정합합니다.
```
