# Definition of Done Checklist

> **기반**: BMAD-METHOD bmad-dev-story/checklist.md (MIT © BMad Code, LLC) + speclinker 확장  
> `/sl-dev` 완료 전 반드시 이 체크리스트를 실행한다.

---

## Context & Requirements Validation

- [ ] TO-BE INF 스펙을 정확히 이해했는가?
- [ ] project-context.md의 코딩 패턴을 숙지했는가?
- [ ] 승인 토큰(`.speclinker/approved/{SR-ID}.lock`)이 존재하는가?
- [ ] 변경 범위(영향 INF/UIS/SCH)가 명확한가?

---

## Implementation Completion

- [ ] TO-BE INF의 모든 요청 파라미터가 구현됐는가?
- [ ] TO-BE INF의 응답 구조가 정확히 구현됐는가?
- [ ] TO-BE INF의 에러 응답이 처리됐는가?
- [ ] project-context.md의 명명 규칙을 준수했는가?
- [ ] project-context.md의 금지 패턴을 사용하지 않았는가?
- [ ] project-context.md의 인증/권한 처리 패턴을 적용했는가?

---

## Testing & Quality Assurance

- [ ] RED: 실패 테스트가 먼저 작성됐는가?
- [ ] GREEN: 모든 테스트가 통과하는가?
- [ ] REFACTOR: 중복 제거 및 명명 규칙 적용이 됐는가?
- [ ] 엣지 케이스(빈 값, 경계값, 에러 상황)가 테스트됐는가?

---

## speclinker 스펙 연동

- [ ] `linked_func` 주석이 삽입됐는가? (`// linked_func: FUNC-{domain}-{NNN}`)
- [ ] TO-BE INF의 모든 AC(Acceptance Criteria)가 충족됐는가?
- [ ] INF 파일이 업데이트됐는가? (스펙 변경이 있는 경우)
- [ ] `sprint-status.yaml`이 `in-progress → review`로 업데이트됐는가?

---

## Documentation & Tracking

- [ ] 변경된 파일 목록이 기록됐는가?
- [ ] 새로운 환경 변수나 설정이 있다면 문서화됐는가?
