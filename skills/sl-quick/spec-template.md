# Quick Change Spec — {변경 제목}

> **기반**: BMAD-METHOD bmad-quick-dev/spec-template.md (MIT © BMad Code, LLC) + speclinker 확장  
> 소규모 변경 전용 인라인 스펙. SR 문서 없이 INF 파일 하단 변경이력에 기록됩니다.

---

## Intent

{이 변경이 달성하고자 하는 것 — 1~3줄}

---

## Boundaries & Constraints

- **In scope**: {이 변경에 포함되는 것}
- **Out of scope**: {이 변경에 포함되지 않는 것}
- **Constraints**: {제약 조건 — 하위호환성, 성능 요건 등}

---

## I/O & Edge-Case Matrix

| 입력 | 기대 출력 | 엣지 케이스 |
|------|---------|-----------|
| {정상 입력} | {정상 출력} | |
| {경계값} | {기대 출력} | 경계 처리 |
| {에러 입력} | {에러 응답} | 에러 핸들링 |

---

## speclinker 연동

```yaml
linked_inf:
  - INF-{CODE}-{NNN}     # 영향받는 INF 파일 (1~2개)

근거_소스:
  - {수정할 소스 파일 경로}

변경_이력: inline         # SR 없이 INF 하단 ## 변경 이력 섹션에 기록
변경_일자: "{YYYY-MM-DD}"
변경_내용: "{한 줄 요약}"
```

---

## Acceptance Criteria

- [ ] {검증 조건 1}
- [ ] {검증 조건 2}
