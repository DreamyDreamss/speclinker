---
name: sl-review
description: 생성된 코드가 TO-BE INF 스펙과 실제로 일치하는지 3-Layer 범용 검증
---

# /sl-review — 3-Layer 스펙↔코드 검증

## 역할

`/sl-dev`로 생성된 코드가 TO-BE INF 스펙과 실제로 일치하는지 다층 검증한다.  
검증 기준은 항상 INF 스펙이며 프레임워크에 무관하게 동작한다.

```
호출:
  /sl-review SR-2026-001       SR 단위 검증
  /sl-review FUNC-PRD-003      특정 FUNC 검증
  /sl-review SR-2026-001 --quick  Layer 1만 실행 (sl-quick 경유 시)
```

## 실패 조건

| 조건 | 동작 |
|------|------|
| TO-BE INF 파일 없음 | 중단 → "/sl-change 먼저 실행 필요" |
| project-context.md 없음 | Layer 2 경고 후 기본 보안 패턴으로 계속 |

---

## STEP 1: 입력 파악 + TO-BE INF 경로 결정

```bash
!ls docs/변경관리/{SR-ID}/after/ 2>/dev/null
```

`after/` 있으면 TO-BE INF 경로 사용. 없으면 현행 `docs/05_설계서/` INF 사용.

연결 소스 파일 확인:
```bash
!grep "근거 소스" {INF_PATH} 2>/dev/null
```

---

## STEP 2: Layer 1 — 스펙 감사 (Spec Auditor)

**기준:** TO-BE INF 파일

TO-BE INF를 Read한 후 근거 소스 파일을 Read하여 비교한다.

| 검증 항목 | 방법 |
|---------|------|
| 요청 파라미터 일치 | INF 요청 표 ↔ 실제 메서드 시그니처/어노테이션 비교 |
| 응답 JSON 구조 일치 | INF 응답 예시 ↔ 실제 반환값 구조 비교 |
| URL/경로 일치 | INF path ↔ 실제 라우팅 선언 비교 |
| 에러 응답 처리 일치 | INF 오류 표 ↔ 실제 예외 처리 코드 비교 |

결함 분류: `[CRITICAL]` / `[HIGH]` / `[MEDIUM]` / `[LOW]`

---

## STEP 3: Layer 2 — 보안 감사 (Security Auditor)

> `--quick` 플래그 시 이 Layer를 건너뛴다.

**기준:** `docs/project-context.md`의 보안 패턴 (없으면 아래 기본 패턴 사용)

| 검증 항목 | 기본 체크 |
|---------|---------|
| 인증/권한 체크 | 쓰기 API에 세션/토큰 검증 코드 있는가 |
| 입력값 검증 | SQL Injection, XSS 방어 코드 있는가 |
| 민감 데이터 노출 | 로그에 개인정보(전화번호, 이름 등) 출력되는가 |
| 하드코딩 시크릿 | 비밀번호, API 키가 코드에 직접 있는가 |

---

## STEP 4: Layer 3 — 회귀 감시 (Regression Guard)

> `--quick` 플래그 시 이 Layer를 건너뛴다.

**기준:** 변경되지 않은 기존 INF 파일

```bash
!grep -rl "{변경된 테이블명}" docs/05_설계서/*/INF/ --include="*.md" 2>/dev/null
```

| 검증 항목 | 방법 |
|---------|------|
| 다른 INF와 공유 테이블 영향 | 동일 테이블 참조 INF에서 기존 컬럼 사용 여부 |
| 공통 모듈 변경 파급 효과 | 변경된 공통 유틸/서비스를 호출하는 INF 목록 |
| SCH 변경 → 기존 쿼리 영향 | 컬럼 변경 시 기존 쿼리 SELECT 목록 확인 |

---

## STEP 5: 리뷰 보고서 저장 + sprint-status 업데이트

**보고서 저장:**

```bash
!mkdir -p docs/변경관리/{SR-ID}
```

`docs/변경관리/{SR-ID}/review_{날짜}.md` 저장.

**결과에 따른 sprint-status 업데이트:**

CRITICAL 없음:
```bash
!python3 -c "
import yaml
with open('.speclinker/sprint-status.yaml') as f: s = yaml.safe_load(f)
# {FUNC-ID}를 review → done으로 변경
# ... 업데이트 후 저장
"
```

CRITICAL 있음 → `/sl-dev 복귀` 안내.

**최종 출력:**

```
═══════════════════════════════════
리뷰 결과 — {SR-ID}
═══════════════════════════════════
Layer 1 스펙 감사:
  [CRITICAL] {N}건 / [HIGH] {N}건 / [MEDIUM] {N}건 / [LOW] {N}건

Layer 2 보안 감사:
  {PASS / 발견 N건}

Layer 3 회귀 감시:
  {PASS / 영향 N건}

결론: {PASS → sprint-status done 업데이트 / FAIL → /sl-dev 복귀}
보고서: docs/변경관리/{SR-ID}/review_{날짜}.md
═══════════════════════════════════
```
