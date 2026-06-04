---
name: sl-quick
description: 소규모 변경 전용 경량 경로 — SR 없이 빠르게 변경하되 스펙 동기화 유지
---

# /sl-quick — 경량 수정 개발

## 역할

단순 버그픽스나 소규모 수정 전용 경량 경로.  
전체 SR 파이프라인 없이 빠르게 변경하되, 스펙 동기화는 유지한다.

```
호출:
  /sl-quick "수정 내용 설명"
```

**스코프 기준 (이 범위를 초과하면 /sl-plan 사용 권장):**
- 단일 목표 (하나의 독립적 변경)
- INF 1~2개 이내
- SCH 변경 없음

## 실패 조건

| 조건 | 동작 |
|------|------|
| INF 3개 이상 영향 예상 | 경고 + "/sl-plan 사용 권장. 계속하시겠습니까?" |
| SCH 변경 예상 | 경고 + "/sl-plan 사용 권장. 계속하시겠습니까?" |
| `docs/05_설계서/` 없음 | 중단 → "/sl-recon 먼저 실행 필요" |

---

## STEP 1: 스코프 확인

수정 의도에서 키워드를 추출한다.

```bash
!grep -rl "{키워드}" docs/05_설계서/*/INF/ --include="*.md" 2>/dev/null | wc -l
```

INF 3개 이상이면 경고 후 사용자 확인.

---

## STEP 2: 영향 INF 탐색 + 인라인 스펙 기록

영향받는 INF 파일 1~2개를 특정한다.

`skills/sl-quick/spec-template.md`를 Read하여 변경 내용을 채운 후:

영향 INF 파일 하단에 `## 변경 이력` 섹션을 추가한다 (기존 섹션이 있으면 행 추가):

```markdown
## 변경 이력

| 날짜 | 변경 내용 | 변경자 |
|------|---------|-------|
| {YYYY-MM-DD} | {변경 한 줄 요약} | /sl-quick (auto) |
```

별도 SR 문서는 생성하지 않는다.

---

## STEP 3: project-context.md 로드

```bash
!cat docs/project-context.md 2>/dev/null | head -80
```

없으면 경고 후 계속 진행.

---

## STEP 4: TDD 구현

dev-agent에 위임한다:

> dev-agent에게:
> - 수정 목표: {수정 내용 설명}
> - 영향 INF: {INF-ID 목록}
> - project-context.md 패턴 준수
> - TDD: RED(실패 테스트) → GREEN(최소 구현) → REFACTOR
> - linked_func 주석 삽입 필수

---

## STEP 5: 경량 스펙 일치 점검 (Layer 1만)

소규모 변경이므로 인라인으로 Layer 1(스펙 감사)만 실행한다. Layer 2/3(보안·회귀)은 생략.
(본격 검증이 필요하면 `/sl-aidd` story 루프의 qa-agent 게이트를 사용)

CRITICAL 결함 없으면 완료. CRITICAL 있으면 수정 후 재실행.

---

## STEP 6: 완료 보고

```
/sl-quick 완료
═══════════════════════════════════
수정 내용: {수정 내용 설명}
영향 INF: {INF-ID 목록}
변경 이력: 각 INF 파일 하단에 기록됨
Layer 1 검증: PASS

수정된 파일:
  {소스 파일 목록}
  {INF 파일 — 변경이력 추가}
═══════════════════════════════════
```
