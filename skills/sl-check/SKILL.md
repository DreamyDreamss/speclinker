---
name: sl-check
description: /sl-dev 진입 전 TO-BE 스펙 완전성 + 승인 토큰 범용 검증 게이트
---

# /sl-check — 구현 준비 게이트

## 역할

`/sl-dev` 실행 전 TO-BE 스펙이 완전하고 승인됐는지 범용적으로 검증한다.  
`[TBD]` 항목, 승인 토큰, INF/UIS/SCH 완전성을 확인하고 PASS/FAIL을 판정한다.

```
호출:
  /sl-check SR-2026-001      SR 단위 검증
  /sl-check FUNC-PRD-003     특정 FUNC 검증
  /sl-check --all            전체 ready-for-dev FUNC 검증
```

## 실패 조건

| 조건 | 동작 |
|------|------|
| `docs/05_설계서/` 없음 | 중단 → "/sl-recon 먼저 실행 필요" |
| SR-ID/FUNC-ID에 해당하는 INF 없음 | FAIL + "해당 스펙을 찾을 수 없음" |

---

## STEP 1: 입력 파악 + 검증 대상 INF 목록 결정

**SR-ID 입력 시:**
```bash
!ls docs/변경관리/{SR-ID}/after/ 2>/dev/null
```
`after/` 디렉토리가 있으면 TO-BE INF 경로 사용.  
없으면 현행 `docs/05_설계서/` INF 사용.

**FUNC-ID 입력 시:**
```bash
!grep "{FUNC-ID}" docs/00_FUNC/FUNC_MAP.md 2>/dev/null | head -5
```
FUNC_MAP에서 연결 INF-ID 추출.

**--all 입력 시:**
```bash
!grep "ready-for-dev" .speclinker/sprint-status.yaml 2>/dev/null
```

---

## STEP 2: 승인 토큰 확인

```bash
!ls .speclinker/approved/{SR-ID}.lock 2>/dev/null && echo "EXISTS" || echo "MISSING"
```

- `EXISTS` → 통과
- `MISSING` → FAIL 항목으로 기록. `/sl-quick` 경유 시 예외 허용.

---

## STEP 3: INF 파일 완전성 검증

각 INF 파일에 대해:

```bash
!grep -c "\[TBD\]" {INF_PATH} 2>/dev/null
```

| 검증 항목 | 통과 조건 |
|---------|---------|
| [TBD] 항목 없음 | `[TBD]` grep 결과 0 |
| 요청 파라미터 표 존재 | `## 요청` 섹션 + 표 행 1개 이상 |
| 응답 구조 정의됨 | `## 응답` 섹션 + 빈 `{}` 아님 |
| 에러 응답 표 존재 | `## 오류 응답` 섹션 + 표 행 1개 이상 |

---

## STEP 4: UIS/SCH 검증 (해당 시)

**UIS 검증:**
- `## §5 인터랙션 이벤트 매핑` 섹션 존재
- frontmatter `apis:` 필드에 INF-ID 있음

**SCH 검증 (변경이 있는 경우):**
- 컬럼 타입·NOT NULL 정의됨
- `[TBD]` 없음

---

## STEP 5: 결과 출력

`skills/sl-check/readiness-report-template.md` 형식으로 출력한다.

**PASS 시:**
```
✅ PASS — 구현 준비 완료
다음: /sl-dev {SR-ID 또는 FUNC-ID}
```

**FAIL 시:**
```
❌ FAIL — {N}개 항목 미완성

미완성 항목:
1. {항목} → {수정 방법}
2. {항목} → {수정 방법}

해결 후 /sl-check 재실행
```
