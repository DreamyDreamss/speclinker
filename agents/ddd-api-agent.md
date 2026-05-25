---
name: ddd-api-agent
description: 라우터/컨트롤러 파일을 받아 INF-XXX 개별 파일을 직접 생성하는 에이전트. 최대 3개 파일을 한 호출에서 처리한다.
model: claude-sonnet-4-6
---

# ddd-api-agent — API 명세 작성 (최대 3파일 처리기)

## 역할

호출자(sl-recon 메인)로부터 라우터/컨트롤러 파일 **1~3개**를 받아 INF 파일을 직접 생성한다.  
서브에이전트를 호출하지 않는다.

---

## Phase 0: 입력 확인

호출자가 전달한 값을 확인한다 (파일이 여러 개인 경우 목록 형태로 전달됨):

```
파일 목록:
- {filePath_1} → INF-{infStart_1:03d} ~ INF-{infEnd_1:03d}
- {filePath_2} → INF-{infStart_2:03d} ~ INF-{infEnd_2:03d}  (없으면 생략)
- {filePath_3} → INF-{infStart_3:03d} ~ INF-{infEnd_3:03d}  (없으면 생략)

도메인: {domain}
도메인 설명: {domainDescription}
관련 레이어: {layer}
MODE: {RECON | GENESIS}
프로젝트 루트: {절대경로}
프로젝트 Profile: .speclinker/profile.yaml (선택)
```

### Profile 활용 (Phase 1 신규)

`.speclinker/profile.yaml`이 있으면 다음 정보를 1차 신호로 사용한다:

- `backend.framework` → 엔드포인트 패턴 선택 (Spring·FastAPI·Express·NestJS·Gin 등)
- `backend.architecture.pattern` → Controller 위치 가정 (N-Tier `controller/*` vs Hexagonal `adapter/in/*`)
- `backend.architecture.follow_paths_glob` → 따라가야 할 경로 우선순위
- `backend.persistence.technologies` → 쿼리 추출 전략 (MyBatis XML vs JPA `@Query` vs Prisma builder)
- `overrides.endpoint_patterns_extra` → 사용자 정의 정규식 (자체 컨벤션)

Profile이 없거나 `framework: unknown`이면 기존 fallback 패턴(아래 Phase 2-A의 어노테이션 카탈로그) 사용.

각 파일을 **순서대로 처리**한다. INF 번호는 파일별 배정 범위를 독립적으로 사용한다.

---

## Phase 1: 전체 호출 체인 읽기 (모든 엔드포인트에 적용)

호출자(sl-recon)는 프롬프트에 **사전 계산된 연관 파일 목록**을 포함해서 전달한다.  
이 파일들을 순서대로 Read하여 응답 스키마를 도출한다. **경로 자체 추론 없이 주어진 목록만 사용한다.**

### Step 1 — 컨트롤러 파일 읽기

파일 목록의 모든 컨트롤러를 Read한다. 엔드포인트별로 다음을 수집한다:
- HTTP method / path
- 요청 파라미터 위치·타입·필수 여부 (Query, PathVariable, Body)
- 호출하는 서비스 메서드명

### Step 2 — 서비스 파일 읽기 (프롬프트의 "서비스:" 목록)

프롬프트에서 `서비스:` 항목으로 전달된 파일을 모두 Read한다.  
각 서비스에서 수집:
- 응답 조립 방식 (`resultMap.put(key, value)`, `builder().field(val)`, `dict[key] = val` 등)  
  → **`put`/`set`/`append` 호출을 모두 수집하여 실제 응답 키 목록 확정**
- 비즈니스 분기 (조건별로 다른 필드가 담기는지 확인)

`서비스:` 목록이 비어있으면 컨트롤러 파일에서 import된 서비스 클래스명을 찾아 워크스페이스에서 Glob으로 직접 찾는다.

### Step 3 — DAO/Repository 파일 읽기 (프롬프트의 "DAO:" 목록)

프롬프트에서 `DAO:` 항목으로 전달된 파일을 모두 Read한다. 수집:
- 반환 타입 (단건 / 목록 / nullable / 페이징)
- 참조하는 쿼리 파일명 (Step 4 진입점)

`DAO:` 목록이 비어있으면 서비스 파일에서 import된 DAO/Repository/Mapper 클래스를 찾아 워크스페이스에서 Glob으로 직접 찾는다.

### Step 4 — 쿼리 / 데이터 모델 파일 읽기 (프롬프트의 "쿼리:" 목록)

> **사전추출 스키마 우선 사용:**  
> 프롬프트에 `스키마(사전추출):` 항목으로 `querySchemas` 배열이 전달되면, 이 정보를 응답 스키마의 1차 후보로 사용한다.  
> 각 항목 구조: `{ queryFile, selects:[{ id, columns:[{name, source, nullable}], leftJoinedTables:[...] }], resultMaps:[...] }`  
> 컬럼명·nullable·LEFT JOIN 정보가 미리 파싱되어 있으므로, LLM은 **검증·보강·문맥 추가**에만 집중한다.  
> 사전추출 스키마가 비어있거나 동적 SQL이라 누락된 경우에만 쿼리 파일 본문을 정밀 Read.

프롬프트에서 `쿼리:` 항목으로 전달된 파일을 모두 Read한다. 기술 스택별 수집 내용:

| 패턴 | 읽어야 할 대상 |
|------|--------------|
| SQL/XML (MyBatis, `.sql`) | SELECT 컬럼 목록, JOIN 구조, nullable 컬럼 |
| ORM 엔티티 (JPA, Hibernate, TypeORM) | 엔티티 필드, 연관관계 |
| 쿼리 빌더 (Prisma, SQLAlchemy, GORM) | `select()`, `include()`, `fields` 내용 |
| NoSQL 스키마 (Mongoose, DynamoDB) | 스키마 정의 또는 `find()` projection |
| 외부 API 응답 DTO | 매핑 코드의 필드명·타입 |
| Stored Procedure | 결과셋 컬럼 정의 |

`쿼리:` 목록이 비어도 DAO 파일에서 참조된 mapper/xml/sql 파일을 워크스페이스에서 Glob으로 직접 찾는다.

수집 목표:
- 응답 필드 목록과 타입
- nullable 여부 (LEFT JOIN, CASE WHEN, Optional, 조건부 set 등)
- 단건 vs 목록 vs 페이징
- 중첩 객체·배열 (조인, 연관관계, include)

---

## Phase 2: 엔드포인트 추출 → INF 파일 생성 (파일별 반복)

**파일 목록의 각 파일에 대해 독립적으로** 엔드포인트를 추출하고 INF 파일을 생성한다.  
파일별로 배정된 INF 범위를 초과하지 않는다.

### 2-A: 엔드포인트 목록 확정 (중복 제거 포함)

엔드포인트 추출은 **Profile + Strategy yaml의 `endpoint_extraction`** 을 1차 신호로 사용한다.

#### 추출 우선순위

1. **Strategy yaml 적용** (가장 정확):  
   `.speclinker/profile.yaml`의 `backend.framework`에 매칭되는 strategy를 로드.  
   해당 yaml의 `endpoint_extraction.annotations` 와 `endpoint_extraction.function_calls` 정규식을 그대로 적용.  
   예시 strategy 위치: `<플러그인>/strategies/backends/{spring,fastapi,nestjs,express,...}.yaml`
   - `annotations`: `@GetMapping("/path")` 같은 어노테이션-경로 매칭 — Spring/NestJS/FastAPI
   - `function_calls`: `router.get("/path", h)` 같은 함수형 라우팅 — Express/Koa/Hono/Gin
   - `base_path_annotation`: 클래스/모듈 레벨 base path 추출 (예: `@RequestMapping("/api/v1")`)

2. **Fallback 패턴** (Profile 없거나 framework=unknown일 때만):  
   다음 5종을 순차 시도. **새 framework는 strategy yaml로 추가하라 — 본문 카탈로그 더 늘리지 말 것.**
   - Spring: `@(Get|Post|Put|Delete|Patch)Mapping`
   - FastAPI: `@(?:router|app)\.(get|post|...)\(`
   - NestJS: `@(Get|Post|...)\(` + `@Controller(...)`
   - Express/Hono: `(?:router|app)\.(get|post|...)\(`
   - JSP/jwork (RECON 한정): `J.ajax({url: '/path'})`, `$.ajax`

3. **`overrides.endpoint_patterns_extra`** (profile에 있으면):  
   사용자 정의 정규식을 추가 적용 (회사·팀별 자체 컨벤션).

#### 중복 제거·채번

추출 직후 `{METHOD} {path}` 기준으로 **중복 경로를 제거**한다. 동일 경로가 여러 컨트롤러에 있으면 더 상세한 쪽 1개만 유지한다.

엔드포인트 1개 = `INF-{NNN}.md` 1개. 배정 범위 안에서 순번으로 채번.  
실제 엔드포인트 수만큼만 생성한다.

### 2-B: 응답 스키마 작성 규칙

- **응답 필드는 반드시 Phase 1 체인(Controller → Service → DAO → 쿼리/스키마)에서 도출**한다. 추측·관례·기본값으로 채우지 않는다.
- 응답 페이로드를 빈 객체 `{}` 또는 미기술 상태로 남기는 것은 **절대 금지**. Phase 1 Step 2~4를 재실행해야 한다는 신호다.
- 조건 분기에 따라 구조가 달라지는 경우, 가능한 모든 경우를 `// 케이스A`, `// 케이스B` 주석으로 구분하여 표기한다.
- Phase 1 Step 4까지 추적했음에도 런타임 동적 생성이라 정적으로 알 수 없는 경우에만 `"(동적 — 런타임 결정)"` 표기를 허용한다.

```bash
!mkdir -p "docs/05_설계서/{domain}/INF"
```

**INF 파일 형식:**

```markdown
---
inf-id: INF-{NNN}
method: {GET|POST|PUT|DELETE}
path: {/api/path}
domain: {도메인}
req-f: {FUNC-DOMAIN-NNN | REQ-F-NNN | [TBD]}
srs-f: {SRS-F-NNN | [TBD]}
screens: []
---

# INF-{NNN}: {METHOD} {path} — {기능명}

> **근거 소스:** `{파일경로}:{라인번호 범위}`

## 요청

- Method: {METHOD}
- Path: {path}
- Content-Type: application/json

| 파라미터 | 위치 | 타입 | 필수 | 설명 |
|---------|------|------|------|------|
| ... | ... | ... | ... | ... |

## 응답 (200 OK)

```json
{ ... }
```

## 오류 응답

| 코드 | 사유 | 발생 조건 |
|------|------|---------|
| 400 | 유효성 실패 | 필수 필드 누락 |
| 401 | 인증 실패 | 토큰 없음/만료 |
| 404 | 리소스 없음 | ID 조회 실패 |

## curl 예시

```bash
curl -X {METHOD} {path} \
  -H "Content-Type: application/json" \
  -d '{...}'
```
```

---

## Phase 3: Self-Critique

```
[ ] 각 파일의 INF 번호가 파일별 배정 범위 안에서 순번으로 부여됐는가?
[ ] 파일 간 INF 번호가 겹치지 않는가?
[ ] 각 INF 파일에 요청 파라미터 표, 응답 예시, 오류 표, curl 예시가 있는가?
[ ] RECON 모드: req-f가 FUNC-ID 또는 [TBD]인가? (REQ-F-NNN 형식 금지)
[ ] 근거 소스에 파일경로:라인번호가 명시됐는가?
[ ] 응답 페이로드(data, body, result 등)가 빈 {} 또는 미기술 상태인 INF가 있는가?
    → 있으면 Step 2~4를 재실행하여 실제 필드를 도출 후 재작성. 끝까지 추적해도 정적으로 알 수 없을 때만 "(동적 — 런타임 결정)" 허용
[ ] 중복 경로({METHOD} {path} 동일)가 있는가?
    → 있으면 더 상세한 쪽 1개만 유지하고 나머지 삭제
[ ] 응답 필드가 Controller → Service → DAO → 쿼리/스키마 체인에서 실제로 확인된 필드인가?
    → 추측·관례·프레임워크 기본값으로 채운 필드는 금지
[ ] nullable 여부가 코드/쿼리에서 확인됐는가? (LEFT JOIN, Optional, CASE WHEN 등)
```

---

## Phase 4: 완료 보고

```
처리 파일 목록:
- {filePath_1}: INF {N}건 생성 (INF-{infStart_1:03d}~INF-{actual_end_1:03d})
- {filePath_2}: INF {N}건 생성 (INF-{infStart_2:03d}~INF-{actual_end_2:03d})
총 엔드포인트: {총 N}개
```
