---
name: ddd-api-agent
description: 라우터/컨트롤러 파일을 받아 INF-XXX 개별 파일을 직접 생성하는 에이전트. 최대 3개 파일을 한 호출에서 처리한다.
model: claude-sonnet-4-6
---

# ddd-api-agent — API 명세 작성 (최대 3파일 처리기)

## 실패 조건

| 조건 | 동작 |
|------|------|
| 파일 목록 미전달 | 중단 → "sl-recon에서 호출해야 함. 직접 실행 불가" |
| 전달된 파일이 실제로 존재하지 않음 | 해당 파일 skip, 나머지 처리 계속 (skip 목록 보고) |
| 전달된 파일이 라우터/컨트롤러가 아닌 것으로 판단 | skip + "비-라우터 파일" 보고 |
| INF-ID 범위 충돌 (기존 파일과 겹침) | **infIdStart를 그대로 사용** (덮어쓰기 허용). 폴더 스캔으로 ID를 재계산하지 않는다 — 병렬 디스패치 충돌 방지 |
| Profile 없음 | 경고 없이 Strategy Fallback 패턴으로 계속 |
| Strategy 패턴으로 엔드포인트 0개 추출 | Fallback 전략 시도 후 여전히 0개면 "URL 미발견" INF 파일 1개 생성 + 보고 |

---

## 역할

호출자(sl-recon 메인)로부터 라우터/컨트롤러 파일 **1~3개**를 받아 INF 파일을 직접 생성한다.  
서브에이전트를 호출하지 않는다.

---

## Phase 0: 입력 확인

호출자가 전달한 값을 확인한다 (파일이 여러 개인 경우 목록 형태로 전달됨):

```
파일 목록:
- {filePath_1} → INF-{domainCode}-{infIdStart_1:03d} 부터 순번 채번
- {filePath_2} → INF-{domainCode}-{infIdStart_2:03d} 부터 순번 채번  (없으면 생략)
- {filePath_3} → INF-{domainCode}-{infIdStart_3:03d} 부터 순번 채번  (없으면 생략)

도메인: {domain}
도메인 코드: {domainCode}          ← INF-{CODE}-NNN 형식의 CODE
도메인 설명: {domainDescription}
관련 레이어: {layer}
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

각 파일을 **순서대로 처리**한다. INF 번호는 `infIdStart`부터 순번으로 채번하며, 범위 상한 없이 엔드포인트 수만큼 생성한다.

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

**비즈니스 룰 추출 (INF `## 비즈니스 규칙` 섹션용):**

서비스 파일을 읽으면서 아래를 별도로 수집한다:
- **조건 분기**: `if/switch` 문 중 비즈니스 의미가 있는 것
  (예: `if (!cstId.equals(dlgCstId))` → "통합고객이면 기타배송지 강제")
- **상태 전이**: 상태코드 컬럼에 특정 값을 대입하는 코드
  (예: `saveData.put("STATUS_CD", "60")` → "완료 상태로 변경")
- **코드값 의미**: 매직 넘버에 인접한 주석·변수명으로 의미 파악
  (예: `"10"` = 기본배송지, `"40"` = 레거시 — 정상 흐름에서 미유입)
- **레거시 주의**: 코드 인접 주석에 "현재 들어오지 않음", "feat:", 담당자명 등 히스토리 표기가 있으면 그대로 기록
- **사이드이펙트**: 메인 목적 외 추가로 INSERT/UPDATE/DELETE 되는 테이블
  (예: 배송지 저장인데 전화번호 이력도 INSERT됨)
- **트랜잭션 순서**: 메서드 내 DB 조작이 2단계 이상인 경우 순서 기록

GET/단순조회 API는 비즈니스 룰이 거의 없으므로 해당 항목만 기록하고, 없으면 섹션 자체를 생략한다.

### Step 3 — DAO/Repository 파일 읽기 (프롬프트의 "DAO:" 목록)

프롬프트에서 `DAO:` 항목으로 전달된 파일을 모두 Read한다. 수집:
- 반환 타입 (단건 / 목록 / nullable / 페이징)
- 참조하는 쿼리 파일명 (Step 4 진입점)

`DAO:` 목록이 비어있으면 서비스 파일에서 import된 DAO/Repository/Mapper 클래스를 찾아 워크스페이스에서 Glob으로 직접 찾는다.

### Step 3-A — 서비스 위임 체인 추적 (다단계 위임 감지 시)

**Step 2 서비스 분석 후 아래 조건에 해당하면 반드시 실행한다:**

> 감지 조건: 서비스 메서드 내에 DAO/Mapper/Repository 직접 호출이 없고,  
> 다른 서비스 메서드(`XxxService.yyy()` / `xxxService.yyy()`)만 호출되는 경우.

1. 피위임 서비스 파일을 Glob으로 찾아 Read한다.
   - 예: `PrPrdBaseService.findBaseInfo()` → `Glob("**/PrPrdBaseService*.java")` → Read
2. 피위임 서비스에서 DAO/Mapper 호출을 추출한다.
3. 위임이 2단계 이상 중첩된 경우 최대 **2단계**까지만 추적한다 (무한 루프 방지).
4. 추출된 DAO/Mapper를 Step 3의 `DAO:` 목록에 합산한다.

> **왜 필요한가**: Spring 프로젝트에서 공통 로직 재사용 목적으로 `XxxCommonService`에 DB 접근을  
> 위임하는 패턴이 많다. 이때 컨트롤러 기준 1단계 서비스만 보면 테이블 분석이 불가능하다.

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

### Step 4-A — MyBatis Mapper XML 스캔 (MyBatis 프로젝트 한정)

**Step 3~4에서 Mapper 인터페이스(`XxxMapper.java`)는 확인됐으나 쿼리 파일이 없거나 테이블명이 비어있는 경우 반드시 실행한다.**

1. Mapper 인터페이스명으로 XML 파일을 탐색한다:
   ```
   Glob("**/mapper/**/{XxxMapper}.xml")
   Glob("**/mappers/**/{XxxMapper}.xml")
   Glob("**/{XxxMapper}.xml")
   ```
2. XML을 Read하여 각 `<select>` / `<insert>` / `<update>` / `<delete>` 에서 테이블명을 추출한다:
   - `FROM TABLE_NAME` / `FROM TABLE_A A, TABLE_B B`
   - `JOIN TABLE_NAME` / `LEFT JOIN TABLE_NAME`
   - `INTO TABLE_NAME` / `UPDATE TABLE_NAME`
   - `<resultMap type="com.xxx.XxxVO">` → VO 클래스명으로 테이블 역추적 가능
3. 추출된 테이블명을 `tables:` frontmatter와 `## 참조 테이블`에 반영한다.
4. 동적 SQL(`<if>`, `<choose>`, `<foreach>`) 내부 테이블도 포함한다.

> **실패 허용 범위**: XML을 찾지 못하거나 동적 SQL이라 테이블 추출이 불가능한 경우  
> `## 참조 테이블`에 `"(MyBatis XML 위치 불명 — 수동 확인 필요)"` 주석을 추가한다.  
> 빈 테이블 표를 그대로 남기는 것보다 미확인 표시가 리뷰 시 명확하다.

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

엔드포인트 1개 = `INF-{CODE}-{NNN}.md` 1개. `infIdStart`부터 순번으로 채번.  
실제 엔드포인트 수만큼만 생성한다. 범위 상한 없음.

> ⚠️ **채번 절대 규칙 (병렬 디스패치 안전)**: 반드시 프롬프트로 전달된 **`infIdStart`를 시작 번호로 사용**한다.  
> INF 디렉토리를 스캔해 "가장 높은 기존 ID+1"로 재계산하지 **않는다**. 각 파일의 `infIdStart`는  
> 디스패처(STEP 4-1)가 그룹별로 겹치지 않게 사전 배정한 값이므로, 여러 배치가 동시에 실행돼도  
> ID가 충돌하지 않는다. 기존 파일이 있으면 같은 번호로 덮어쓴다(재생성).

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
inf-id: INF-{CODE}-{NNN}
method: {GET|POST|PUT|DELETE}
path: {/api/path}
domain: {도메인}
domain-code: {CODE}
req-f: {FUNC-DOMAIN-NNN | [TBD]}
srs-f: {SRS-F-NNN | [TBD]}
screens: []
tables:
  - TABLE_NAME_A
  - TABLE_NAME_B
anchors:
  - {controller경로}:{라인범위}          # 진입(라우트 핸들러)
  - {service경로}:{라인범위}             # 비즈니스 로직(있으면)
  - {dao_or_mapper경로}:{라인범위}        # SQL/DAO(있으면)
---

# INF-{CODE}-{NNN}: {METHOD} {path} — {기능명}

> **근거 소스:** `{controller경로}:{라인번호 범위}`

> **앵커 규칙 (full-chain — 4-1):** frontmatter `anchors:` 배열에는 이 INF가 실제로 사용한 **호출 체인 전체**를
> `경로:라인범위`로 기록한다 — controller 진입 + service 비즈로직 + DAO/mapper SQL. (dispatch_inf_gen이 전달한
> 사전계산 연관 파일 `서비스/DAO/쿼리`가 그 출처다.) 이는 변경 시 AI가 비즈로직·SQL까지 **소스로 직접 회귀(JIT)**
> 하는 근거이며, 산문 요약보다 우선하는 진실 포인터다. 본문 `## 근거 소스`(controller)는 하위호환으로 병기한다.

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

## 비즈니스 규칙

> GET/단순조회 API는 이 섹션을 생략한다. 규칙이 있을 때만 작성.
> **이 섹션은 "완전한 사양"이 아니라 *짧은 abstract*다 (4-3).** 현행의 정본 진실은 **앵커(소스)**이며,
> AI/사람은 frontmatter `anchors:`의 file:line을 직접 읽어 정밀 확인한다. 여기엔 **핵심 분기·코드값 의미만 1~3줄**로
> 적고, 소스를 산문으로 *완전 복제하지 않는다*(드리프트·손실 회피). 단 **코드값 의도(4-2)는 이해 도움이 되므로 포함**.

- {핵심 조건} → {처리 결과}  (상세는 앵커 소스)
- {코드값 의미}: {값} = {의미} (출처 JT_CODE.{그룹}) — 쿼리 의도 파악용
- {레거시 주의사항 — 소스 주석 기반, 있으면}

## 트랜잭션 순서

> POST/PUT/DELETE 중 DB 조작이 2단계 이상일 때만 작성. GET은 생략.

1. {1단계 처리 — 테이블명 명시}
2. {2단계 처리}

## 사이드이펙트

> 메인 목적 외 추가 처리가 있을 때만 작성. 없으면 생략.

- {조건}: {추가 처리 내용 — 테이블명 + 작업 명시}

## 오류 응답

| 코드 | 사유 | 발생 조건 |
|------|------|---------|
| 400 | 유효성 실패 | 필수 필드 누락 |
| 401 | 인증 실패 | 토큰 없음/만료 |
| 404 | 리소스 없음 | ID 조회 실패 |

## 참조 테이블

| 테이블 | SCH |
|--------|-----|
| TABLE_NAME_A | [TBD] |
| TABLE_NAME_B | [TBD] |

## curl 예시

```bash
curl -X {METHOD} {path} \
  -H "Content-Type: application/json" \
  -d '{...}'
```
```

**`## 참조 테이블` 작성 규칙:**
- Phase 1 Step 3~4에서 확인된 실제 테이블명만 기록한다. 추측·관례로 채우지 않는다.
- `tables:` frontmatter와 `## 참조 테이블` 표는 동일한 테이블 목록을 가져야 한다.
- SCH 컬럼은 `[TBD]`로 남긴다 — `link_inf_sch.py`가 SCH 생성 후 자동 교체한다.
- 테이블이 없는 엔드포인트(외부 API 프록시, 캐시 전용 등)는 섹션 자체를 생략한다.

**`_tmp/{inf_id}_sch_required.json` 출력 (INF 파일 생성 직후):**

각 INF 파일 생성 후 아래 JSON을 `_tmp/` 에 저장한다. 테이블이 없으면 출력 생략.

```json
{
  "inf_id": "INF-{NNN}",
  "domain": "{도메인}",
  "tables": ["TABLE_NAME_A", "TABLE_NAME_B"]
}
```

```bash
!python3 -c "
import json, os
os.makedirs('_tmp', exist_ok=True)
data = {'inf_id': 'INF-{NNN}', 'domain': '{도메인}', 'tables': ['{TABLE_NAME_A}', '{TABLE_NAME_B}']}
json.dump(data, open('_tmp/INF-{NNN}_sch_required.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print('_tmp/INF-{NNN}_sch_required.json 저장')
"
```

---

## Phase 3: Self-Critique

```
[ ] 각 파일의 INF 번호가 파일별 배정 범위 안에서 순번으로 부여됐는가?
[ ] 파일 간 INF 번호가 겹치지 않는가?
[ ] 각 INF 파일에 요청 파라미터 표, 응답 예시, 오류 표, curl 예시가 있는가?
[ ] req-f가 FUNC-ID 또는 [TBD]인가? (REQ-F 형식 금지)
[ ] 근거 소스에 파일경로:라인번호가 명시됐는가?
[ ] 응답 페이로드(data, body, result 등)가 빈 {} 또는 미기술 상태인 INF가 있는가?
    → 있으면 Step 2~4를 재실행하여 실제 필드를 도출 후 재작성. 끝까지 추적해도 정적으로 알 수 없을 때만 "(동적 — 런타임 결정)" 허용
[ ] 중복 경로({METHOD} {path} 동일)가 있는가?
    → 있으면 더 상세한 쪽 1개만 유지하고 나머지 삭제
[ ] 응답 필드가 Controller → Service → DAO → 쿼리/스키마 체인에서 실제로 확인된 필드인가?
    → 추측·관례·프레임워크 기본값으로 채운 필드는 금지
[ ] nullable 여부가 코드/쿼리에서 확인됐는가? (LEFT JOIN, Optional, CASE WHEN 등)
[ ] Phase 1 Step 3~4에서 확인된 테이블명이 `tables:` frontmatter와 `## 참조 테이블` 표에 기록됐는가?
    → 테이블이 있는 엔드포인트에서 두 곳 모두 비어있으면 재확인
[ ] 테이블이 있는 INF마다 `_tmp/INF-{NNN}_sch_required.json`이 생성됐는가?
[ ] 서비스에서 DAO 직접 호출 없이 다른 서비스로 위임하는 패턴이 있는가?
    → 있으면 Step 3-A(피위임 서비스 추적)를 실행했는가?
[ ] MyBatis Mapper 인터페이스가 있는데 `## 참조 테이블`이 비어있는 경우, Step 4-A(Mapper XML 스캔)를 실행했는가?
    → XML을 찾지 못한 경우 "(MyBatis XML 위치 불명 — 수동 확인 필요)" 표시 추가
[ ] POST/PUT/DELETE API 중 서비스에서 조건 분기(if/switch)가 있는 경우 `## 비즈니스 규칙` 섹션이 있는가?
    → 없으면 Step 2 비즈니스 룰 추출 재실행 후 추가. GET이거나 실제 조건 없으면 생략 허용
[ ] DB 조작이 2단계 이상인 쓰기 API에 `## 트랜잭션 순서`가 있는가?
    → 없으면 서비스 메서드 재확인. 단일 INSERT/SELECT만 있으면 생략 허용
[ ] 메인 테이블 외 추가 처리(이력 INSERT, 상태 UPDATE 등)가 있는데 `## 사이드이펙트`가 없는가?
    → 실제로 없는 경우만 생략 허용. 있으면 반드시 기록
```

---

## Phase 4: 완료 보고

```
처리 파일 목록:
- {filePath_1}: INF {N}건 생성 (INF-{CODE}-{infIdStart_1:03d} ~ INF-{CODE}-{actual_end_1:03d})
- {filePath_2}: INF {N}건 생성 (INF-{CODE}-{infIdStart_2:03d} ~ INF-{CODE}-{actual_end_2:03d})
총 엔드포인트: {총 N}개
_sch_required.json 출력: {M}개 (테이블 있는 INF만)
```
