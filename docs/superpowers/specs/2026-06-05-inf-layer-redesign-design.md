# INF 레이어 재설계 — 소스=진실, 스펙=소비자별 레이어 (A·B·C 동시 충족)

- 작성일: 2026-06-05
- 대상: RECON 산출물(INF/SCH)의 구조 + sl-change/AIDD/온보딩 활용
- 배경: "스펙이 A(완전·정확)·B(JIT 그라운딩)·C(SOP 온보딩)를 하나의 산문으로 동시 충족 불가"라는 결론. 소스를 진실로 두고 스펙을 소비자별 레이어로 분리·강화한다.

## 1. 문제 (A·B·C 충돌)
- **A 완전·정확**: 소스에 충실한 깊고 빠짐없는 것.
- **B JIT**: 얇은 구조 인덱스 + 소스 포인터(산문 요약은 lossy·중복).
- **C SOP**: 풍부한 내러티브(추상화·생략 허용).
- B↔C 정반대, A는 둘 다와 드리프트/추상화로 충돌. **lossy LLM 산문 요약을 "정본"으로 두는 것이 함정.**

## 2. 확정 원칙
1. **진실 = 소스.** 스펙은 별도 "완전 정본"을 만들지 않는다(드리프트 레이스 탈출).
2. **substrate 공유, 본문 분리.** 한 번의 RECON이 (구조 substrate)를 만들고, 그 위에 **기계용 인덱스**와 **사람용 내러티브**라는 *별도 본문*을 얹는다.
3. **현행성 기준을 소비자에 맞춤.** AI 그라운딩 = 드리프트 0(실소스 read). 사람 온보딩 = 개념수준, 약간 stale 관대.
4. **의미는 사실로 해소.** 코드값·의도는 DB/소스에서 *사실*로 가져오고 출처 표기, 못 풀면 `[미확인]`(추측 금지).
5. **온보딩 문서는 유지·강화.** "정본 완전성 부담"만 면제하고, 이해 도움(코드의미·내러티브)에 집중.

## 3. 레이어 구조
```
                  ┌── 기계 인덱스(B): frontmatter + full-chain 앵커 + 해소된 코드의미  → JIT 실소스 read
소스(진실) ──RECON─┤   (substrate: id·method·path·tables·도메인·링크 — 공유)
                  └── 사람 내러티브(C): 도메인 개요 + 기능단위 읽기쉬운 설명(코드의미 주입) → 온보딩
                      (A는 "앵커가 전체 체인을 가리키나 + 메타 정확한가"로 검증 — 산문완전성 아님)
```

## 4. 개선 컴포넌트 (레버리지 순)

### 4-1. 앵커 full-chain 확장 ★키스톤
- 현: INF `근거 소스` 앵커가 컨트롤러 1개. (충실도 eval에서 SQL앵커 14%만 → 이게 원인)
- 개선: `resolve_call_chain.py` 산출(controller→service→DAO→mapper)을 INF frontmatter `anchors:` 배열로 기록.
  ```yaml
  anchors:
    - src/.../Pr301Controller.java:162-229   # 진입
    - src/.../Pr301Service.java:..            # 비즈로직
    - src/.../PrdAppMapper.xml:7-331          # SQL
  ```
- 효과: **B**(JIT가 비즈로직·SQL까지 완전 read) + **A**(앵커 체인 커버리지로 검증) + **4-2**(코드 리터럴 스캔 대상 확보).

### 4-2. 코드값 → 쿼리 의도 복원 (DB+소스 권위) ★최고 가치
실데이터 확인: 공통코드 = `JT_CODE(CODE_GRP_ID, CODE, CODE_NM)`. 리터럴 풍부(`PRD_APP_STS_CD='20'` 등). 소스에 이미 `(SELECT CODE_NM FROM JT_CODE WHERE CODE_GRP_ID='X' AND CODE=t.COL)` 패턴 도처.

- **① 스캔 `scan_code_literals.py`(zero-LLM)**: 앵커 SQL에서
  - 코드 리터럴: `COL(_CD/_TP/_STS/_YN/_GB/_FL) (=|IN|<>) '리터럴'`
  - **컬럼→그룹 매핑(소스 정적)**: `JT_CODE … CODE_GRP_ID='X' … CODE=…COL` 서브쿼리/조인 패턴 → `COL→그룹 X` 복원.
  - 산출 `_tmp/code_literals.json` = `[{table?,column,group?,values:[],file:line}]`
- **② 해소(권위)**:
  - **그룹 알면(소스에서)** → DB 드라이버로 `SELECT CODE,CODE_NM FROM JT_CODE WHERE CODE_GRP_ID='X'` → 값:명 전체. (creds 없으면 ddd-db-agent MCP 폴백)
  - **그룹 모르면** → probe-match: `WHERE CODE IN (values)` → 매칭 그룹 추론(모호하면 `[후보 N]`).
  - **JT_CODE에 없으면** → 소스 enum/상수(`if(x.equals("Y"))`, `static final`) 2차 스캔. 그래도 없으면 `[미확인]`.
- **③ 주입**: SCH `### 코드값`(값·명·출처 `JT_CODE.X`) + INF 기계인덱스의 코드의미 맵 + **사람 본문의 "쿼리 의도"**(`WHERE PRD_APP_STS_CD='20'` → `상품승인대기`).
- 효과: 소스가 못 주는 **의도를 사실로** → A·B·C 동시. (probe-match는 소스 그룹신호로 모호성 대폭 감소)

### 4-3. 본문 분리·강화 (산문 ≠ 정본)
- 기계 인덱스: 산문 비즈규칙 요약을 **짧은 abstract(1~3줄 "무엇을 하나")**로. 정본 주장 제거 → 충실도 측정 대상 아님.
- 사람 내러티브: **유지·강화** — 기능단위 읽기쉬운 설명에 **4-2 코드의미를 주입**(신규자가 `'20'`→`상품승인대기` 이해). 추상화·생략 허용, 개념수준 현행성.
- ※ "온보딩 포기"가 아니라 "완전성 부담 면제 + 이해 강화".

### 4-4. 충실도 재측정 = 앵커 체인 커버리지
- 폐기: 산문 vs SQL 정규식(정답 없는 노이즈, P0.70/R0.18은 무의미했음).
- 신규 `eval_anchor_coverage.py`:
  - **앵커 체인 커버리지**: INF의 호출체인 단계(controller/service/dao/sql) 중 앵커가 실제로 가리키는 비율.
  - **메타 정확도**: frontmatter `method/path/tables`가 소스 라우트/SQL과 일치하는가(검증 가능·드리프트 없음).
  - 코드값 해소율: 스캔된 리터럴 중 의미 해소된 비율.
- 이게 *검증 가능한* 품질지표(정답 불필요). eval_fidelity는 이걸로 대체.

### 4-5. C 내러티브 정식화
- `build_domain_overview.py`(도메인 개요)를 RECON 정식 단계로 + **기능단위 사람설명** 생성(INF별, 코드의미 주입). 기계 인덱스와 파일/섹션 분리.

## 5. 데이터 모델 변경
- INF frontmatter: `anchors:` 배열(체인 단계 태그 포함), `code_values:` 맵(컬럼→{값:명,출처}) 추가.
- 출력 형식·경로는 **하위호환 유지**(기존 `## 근거 소스`도 병기). spec_graph_build `_anchors()`가 배열 frontmatter도 읽도록 확장.
- SCH 코드값은 4-2 출처표기 포맷 준수(T4-A 계승).

## 6. 불변식
- INF/SCH 파일 경로·핵심 frontmatter(inf-id/method/path/tables) 무변경 → 뷰어·그래프·JIT 무파괴.
- RECON 파이프라인 STEP 구조 보존(앵커 확장·코드스캔은 STEP 4-3/5 내 보강).
- sl-change JIT(graph+anchor)·AIDD 무영향(오히려 앵커 풍부해져 강화).
- 범용성: full-chain 앵커는 resolve_call_chain(스택 중립). 코드값은 공통코드 테이블 있을 때만(없으면 스킵). 2스택 검증.

## 7. 구현 분해 (각 자체 plan)
1. **4-1 full-chain 앵커** (키스톤 — 나머지의 입력)
2. **4-2 코드값 의도복원** (scan_code_literals + 소스 그룹신호 + DB/MCP 해소)
3. **4-4 앵커 커버리지 측정** (4-1 검증)
4. **4-3 본문 분리** (abstract + 사람설명)
5. **4-5 C 내러티브 정식화**

## 8. 검증
- 4-1: nkshop INF 1개 → 앵커가 controller+service+mapper 3단계 포함.
- 4-2: nkshop `PRD_APP_STS_CD`/`USE_YN` → 그룹·의미 해소(소스 JT_CODE 패턴 + (가능시)DB). 모호/미확인 분기 동작.
- 4-4: 앵커 커버리지·메타 정확도·코드해소율 리포트가 *재현 가능*.
- 2스택(Java nkshop + 합성/Next.js).

## 9. 비범위·한계 (정직)
- **동적 SQL**(Java에서 코드 조립) → SQL 텍스트에 리터럴 없음 → 소스 스캔 의존, 일부 미해소.
- **의도/why**(규제·역사적 이유) → 여전히 천장. 코드의미는 풀지만 "왜 그 규칙인지"는 못 줌.
- Java enum/상수 코드값 일부만 커버(2차 스캔 best-effort).
- 사람 내러티브의 "왜"는 자동생성 한계 → 핵심 도메인은 사람 보완 여지.
