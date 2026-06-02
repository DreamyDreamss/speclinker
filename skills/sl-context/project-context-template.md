# Project Context — {PROJECT_NAME}

> **자동 생성 파일** — `/sl-context` 또는 `/sl-context --update`로 갱신.  
> 수동 수정 시 다음 갱신 시 덮어씌워질 수 있습니다.  
> **기반**: BMAD-METHOD project-context-template.md (MIT © BMad Code, LLC) + speclinker 확장

---

## 환경 정보

| 항목 | 값 |
|------|-----|
| 언어 | {감지된 언어 — Java / TypeScript / Python / Go 등} |
| 프레임워크 | {감지된 프레임워크 — Spring / Next.js / FastAPI / Django 등} |
| API 스타일 | {REST / GraphQL / RPC} |
| 빌드 도구 | {Maven / Gradle / npm / pip 등} |
| DB | {MySQL / PostgreSQL / Oracle 등} |
| ORM/쿼리 | {MyBatis / JPA / Prisma / SQLAlchemy 등} |

---

## Technology Stack & Versions

{의존성 파일(package.json/pom.xml 등)에서 추출한 핵심 라이브러리 버전}

---

## Critical Implementation Rules

> 이 프로젝트에서 반드시 지켜야 할 코딩 규칙 (RECON 귀납 추출)

1. {규칙 1}
2. {규칙 2}

---

## 공통 패턴 (RECON 귀납 추출)

> 아래 내용은 RECON 결과물(INF/소스 샘플)에서 자동 추출됩니다.  
> **수동 수정 금지** — `/sl-context --update`로 갱신하세요.

### API 구조 패턴

```
{예시:
Spring + jwork:
  - @RequestMapping(value="/app/{domain}/{screen}", method=POST)
  - GridParameter 페이징: page, rows 파라미터
  - ModelAndView 반환

Next.js:
  - /api/route/[id].ts 패턴
  - getServerSideProps 사용
}
```

### 인증/권한 처리 패턴

```
{예시:
Spring:
  - SessionUtils.getSessionVO().getUserId() — 모든 쓰기 메서드에서 호출

Next.js:
  - middleware.ts에서 NextAuth 세션 검증
}
```

### 에러 응답 패턴

```
{예시:
Spring:
  - BizRuntimeException.create("error.code", params)
  - { "result": "error", "message": "..." }

FastAPI:
  - raise HTTPException(status_code=400, detail="...")
  - { "detail": "..." }
}
```

### 페이징/목록 조회 패턴

```
{예시:
Spring + jwork:
  - 요청: page, rows (GridParameter)
  - 응답: { "total": N, "rows": [...] }

Next.js:
  - 요청: ?page=1&limit=20
  - 응답: { "data": [...], "pagination": { "total": N } }
}
```

---

## 명명 규칙 (RECON 귀납 추출)

### 파일/디렉토리 명명

```
{예시:
Spring:
  - Controller: {Domain}{Screen}Controller.java
  - Service: {Domain}{Screen}Service.java
  - Mapper: {Domain}{Entity}Mapper.java

Next.js:
  - Page: app/{domain}/{screen}/page.tsx
  - API: app/api/{resource}/route.ts
}
```

### 함수/메서드 명명

```
{예시:
Java:
  - 목록 조회: {screen}SelectList
  - 단건 조회: {screen}SelectOne
  - 저장: {screen}Save / {screen}Insert / {screen}Update
}
```

### DB 컬럼/테이블 명명

```
{예시:
- 테이블: {DOMAIN}_{ENTITY}_{TYPE} (예: ORD_ORD_BSC_D)
- PK: {TABLE_PREFIX}_ID
- 등록자: INSTPR_ID, 등록일시: INST_DTM
- 수정자: MDFPR_ID, 수정일시: MDF_DTM
- 사용여부: USE_YN (Y/N)
}
```

---

## 금지 패턴 (RECON에서 발견된 안티패턴)

> AI 코드 생성 시 아래 패턴을 사용하지 않습니다.

- {안티패턴 1 — 이유}
- {안티패턴 2 — 이유}

---

## 프로젝트별 특이사항

> RECON에서 발견된 이 프로젝트 고유의 특이한 구조나 규칙

- {특이사항 1}
- {특이사항 2}

---

## speclinker 연동 정보

> `/sl-context` 자동 생성 메타데이터

| 항목 | 값 |
|------|-----|
| framework_detected | {감지된 프레임워크} |
| inf_count | {RECON으로 생성된 INF 파일 수} |
| uis_count | {RECON으로 생성된 UIS 파일 수} |
| sch_count | {RECON으로 생성된 SCH 파일 수} |
| last_recon | {최종 RECON 실행 날짜 YYYY-MM-DD} |
| last_updated | {이 파일 마지막 갱신 날짜} |
