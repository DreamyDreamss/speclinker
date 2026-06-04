---
doc_id: DDD-API-001
doc_type: API 설계서 색인
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

# API 설계서 색인 (API Design Index)

> **문서 목적**: parseSISpecs 파싱용 3열 색인만 담는다.  
> 상세 명세는 각 도메인 파일로 이동. **이 파일에 API 상세 내용 절대 작성 금지.**

---

## INF 색인 (parseSISpecs 파싱 대상)

> **파싱 규약**: `si-spec-parser`가 이 표를 읽어 `inf` 노드와 `REQ→INF traces_to` 엣지를 생성한다.  
> 3열 형식 고정: `| INF-XXX | HTTP메소드 경로 — 기능명 | FUNC-XXX |`  
> **Obsidian 링크**: 2열을 `[텍스트](./도메인/API_도메인.md#INF-XXX)` 형식으로 작성

| INF-ID  | HTTP 메소드·경로·기능명 | FUNC-ID |
|---------|----------------------|--------|
| INF-001 | [POST /auth/login — 로그인](./auth/API_auth.md#INF-001) | FUNC-001 |
| INF-002 | [DELETE /auth/sessions — 로그아웃](./auth/API_auth.md#INF-002) | FUNC-001 |
| INF-003 | [GET /users/{id} — 사용자 조회](./user/API_user.md#INF-003) | FUNC-002 |

---

## 도메인별 파일 목록

| 도메인 | API 설계 | DB 스키마 | UI 명세 |
|--------|---------|----------|--------|
| auth | [API_auth.md](./auth/API_auth.md) | [DB_auth.md](./auth/DB_auth.md) | [UI_auth.md](./auth/UI_auth.md) |
| user | [API_user.md](./user/API_user.md) | [DB_user.md](./user/DB_user.md) | [UI_user.md](./user/UI_user.md) |

---

## 공통 규격

| 항목 | 내용 |
|------|------|
| Base URL | `https://{도메인}/api/v1` |
| 프로토콜 | HTTPS |
| 데이터 형식 | JSON |
| 인증 방식 | Bearer Token (JWT) |
| 문자 인코딩 | UTF-8 |
| 날짜 형식 | ISO 8601 (YYYY-MM-DDTHH:mm:ssZ) |

### 공통 에러 코드

| 코드 | HTTP Status | 의미 |
|------|------------|------|
| E001 | 400 | 요청 파라미터 오류 |
| E002 | 401 | 인증 실패 |
| E003 | 403 | 권한 없음 |
| E004 | 404 | 리소스 없음 |
| E005 | 500 | 서버 오류 |

---

## 변경 이력

| 버전 | 날짜 | 변경 내용 | 작성자 |
|------|------|----------|--------|
| 1.0 | YYYY-MM-DD | 최초 작성 | |

---

> **연결 문서**: [FUNC](../00_FUNC/FUNC_v1.0.md) | [SRS](../03_기능명세서/SRS_v1.0.md) | [DB 스키마](./DB_Schema.md) | [UI 명세](./UI_Spec_v1.0.md) | [RTM](../02_추적표/RTM_v1.0.md) | [SAD](../04_아키텍처설계서/SAD_v1.0.md)
