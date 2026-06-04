---
doc_id: DDD-DB-001
doc_type: DB 스키마 설계서
version: 1.0
status: draft
created: YYYY-MM-DD
updated: YYYY-MM-DD
project: {프로젝트명}
linked_docs:
  - SAD-001
  - SRS-001
  - RTM-001
---

# DB 스키마 템플릿 (테이블당 개별 파일 구조)

> SCH는 INF와 대칭이다. 테이블 1개 = 파일 1개(`{도메인}/SCH/SCH-{CODE}-NNN.md`).
> 색인은 2단계(전역 `DB_Schema.md` + 도메인 슬림 개요 `DB_{도메인}.md`).
> **3NF 검증 결과/통과 여부는 산출물에 기록하지 않는다(노이즈 제거).**

---

## A. 전역 색인 — `docs/05_설계서/DB_Schema.md`

> parseSISpecs 파싱 대상. **이 파일에 DDL/컬럼 절대 작성 금지.**
> 헤더 고정: `| SCH-ID | 테이블명 | INF-ID |`. 2열 = 개별 파일 직링크(앵커 없음).

```markdown
# DB 스키마 설계서 색인 — {프로젝트명}

## 스키마 색인

| SCH-ID | 테이블명 | INF-ID |
|--------|---------|--------|
| SCH-AUTH-001 | [users](./auth/SCH/SCH-AUTH-001.md) | INF-AUTH-001 |
| SCH-AUTH-002 | [sessions](./auth/SCH/SCH-AUTH-002.md) | INF-AUTH-001, INF-AUTH-003 |
| SCH-DSH-001 | [bi_daily_summary](./dashboard/SCH/SCH-DSH-001.md) | INF-DSH-001 |

## 도메인별 파일 목록

| 도메인 | DB 개요 | API 색인 | UI 명세 |
|--------|---------|---------|--------|
| auth | [DB_auth.md](./auth/DB_auth.md) | [API_auth.md](./auth/API_auth.md) | [UI_auth.md](./auth/UI_auth.md) |
| dashboard | [DB_dashboard.md](./dashboard/DB_dashboard.md) | [API_dashboard.md](./dashboard/API_dashboard.md) | [UI_dashboard.md](./dashboard/UI_dashboard.md) |
```

---

## B. 슬림 도메인 개요 — `docs/05_설계서/{도메인}/DB_{도메인}.md`

> 도메인 전체 ERD 1개 + 테이블 색인만. **DDL 절대 없음.**
> (INF의 `API_{도메인}.md` 도메인 색인 + 도메인 ERD 역할)

```markdown
# {도메인} DB 개요

## 도메인 ERD

(mermaid erDiagram — 도메인 내 모든 테이블·관계 1개 다이어그램)

## 테이블 목록

| SCH-ID | 테이블명 | INF-ID |
|--------|---------|--------|
| SCH-{CODE}-001 | [users](./SCH/SCH-{CODE}-001.md) | INF-{CODE}-001 |
| SCH-{CODE}-002 | [sessions](./SCH/SCH-{CODE}-002.md) | INF-{CODE}-001, INF-{CODE}-003 |
```

---

## C. 개별 테이블 파일 — `docs/05_설계서/{도메인}/SCH/SCH-{CODE}-NNN.md`

> frontmatter는 색인·뷰어 네비게이션용 필수. 상대경로 기준점이 한 단계 깊다
> (INF 링크 `../INF/…`, 상위 산출물 `../../../…`).

```markdown
---
sch-id: SCH-{CODE}-NNN
table: {테이블명}
domain: {도메인}
domain-code: {CODE}
inf: [INF-{CODE}-NNN]
---

# SCH-{CODE}-001: users

> **FUNC-ID:** [FUNC-{도메인}-001](../../../00_FUNC/FUNC_v1.0.md) | **SRS-F:** [TBD] | **API:** [INF-{CODE}-001](../INF/INF-{CODE}-001.md) | **화면:** [UIS-{CODE}-001](../UI/UIS-{CODE}-001_화면명/spec.md)

**근거 소스:** `{모델/ORM 파일:라인}`

### DDL
(CREATE TABLE + 인덱스)

### 컬럼 설명
| 컬럼명 | 타입 | NULL | 기본값 | 설명 |

### 인덱스
| 인덱스명 | 컬럼 | 타입 | 목적 |

### 코드값
(_CD/_TP/_STS/_YN/_FL 계열 컬럼만. 없으면 섹션 생략)

### 관계 (FK)
| 참조 컬럼 | 참조 테이블 | ON DELETE |

### mini-ERD
(mermaid erDiagram — 이 테이블 + 직결 FK 이웃만)

### 비즈니스 주의사항
(참조 INF의 비즈니스 규칙·트랜잭션·사이드이펙트 있을 때만)
```

> 3NF 검증 결과/통과 여부 섹션 없음 — 의도적 제외. 정규화는 테이블 분리 설계 시 참고만.

---

## 공통 컬럼 규칙

> 프로젝트 관례에 맞게 각 테이블 DDL에 반영.

| 컬럼명 | 타입 | 설명 |
|--------|------|------|
| id | BIGINT AUTO_INCREMENT | 기본키 |
| created_at | DATETIME | 생성일시 |
| updated_at | DATETIME | 최종 수정일시 |
| created_by | VARCHAR(50) | 생성자 ID |
| is_deleted | TINYINT(1) | 논리 삭제 플래그 (0: 정상, 1: 삭제) |

## 네이밍 규칙

| 대상 | 규칙 | 예시 |
|------|------|------|
| 테이블명 | snake_case, 복수형 | users, order_items |
| 컬럼명 | snake_case | user_name, created_at |
| PK | id | id |
| FK | {참조테이블 단수}_id | user_id, order_id |
| 인덱스 | idx_{테이블}_{순번} | idx_users_01 |

---

> **연결 문서**: [FUNC](../00_FUNC/FUNC_v1.0.md) | [SRS](../03_기능명세서/SRS_v1.0.md) | [API 색인](./API_Design.md) | [UI 명세](./UI_Spec_v1.0.md) | [RTM](../02_추적표/RTM_v1.0.md) | [SAD](../04_아키텍처설계서/SAD_v1.0.md)
