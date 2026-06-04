---
name: sl-context
description: RECON 결과물 + 소스코드 샘플을 분석해 프로젝트 고유 패턴을 귀납 추출 → docs/project-context.md 생성
---

# /sl-context — 프로젝트 컨텍스트 자동 추출

## 역할

RECON으로 생성된 INF/UIS/SCH와 소스코드 샘플을 분석해 **이 프로젝트 고유의** 코딩 패턴·규칙을 귀납적으로 추출한다.  
생성된 `docs/project-context.md`는 `/sl-aidd` 실행 시 AI가 자동으로 로드하는 **persistent facts**가 된다.

```
호출:
  /sl-context          최초 생성
  /sl-context --update RECON 갱신 후 업데이트
```

## 실패 조건

| 조건 | 동작 |
|------|------|
| `docs/05_설계서/` INF 파일 없음 | 중단 → "/sl-recon 먼저 실행 필요" |
| project-context.md 이미 존재 + --update 없음 | 사용자 확인 후 진행 ("덮어쓰시겠습니까?") |
| 프레임워크 감지 실패 | 경고 후 "unknown"으로 진행 |

---

## STEP 1: 사전 확인 + 프레임워크 감지

```bash
!cat project.env 2>/dev/null | grep -E "FRAMEWORK|PROJECT_NAME"
```

**프레임워크 감지 우선순위:**

**1순위 — project.env 명시값**
- `FRAMEWORK=spring` → Spring/jwork
- `FRAMEWORK=nextjs` → Next.js
- `FRAMEWORK=fastapi` → FastAPI
- `FRAMEWORK=django` → Django

**2순위 — 루트 파일 스캔**

```bash
!ls package.json pom.xml build.gradle requirements.txt pyproject.toml go.mod Cargo.toml 2>/dev/null
```

| 파일 | 판정 |
|------|------|
| `package.json` | Node.js 계열 → `"next"` 의존성이면 Next.js, `"express"`면 Express |
| `pom.xml` / `build.gradle` | Java 계열 → jwork 의존성이면 jwork, spring-boot면 Spring Boot |
| `requirements.txt` / `pyproject.toml` | Python 계열 → fastapi면 FastAPI, django면 Django |
| `go.mod` | Go |
| `Cargo.toml` | Rust |

**3순위 — INF 파일 근거소스 확장자**

```bash
!grep -h "근거 소스" docs/05_설계서/*/INF/INF-*.md 2>/dev/null | head -5
```

`.java` → Java, `.ts/.tsx` → TypeScript, `.py` → Python, `.go` → Go

---

## STEP 2: INF 패턴 수집

대표 INF 파일 5~10개를 Read하여 공통 패턴을 추출한다.

```bash
!ls docs/05_설계서/*/INF/INF-*.md 2>/dev/null | head -10
```

각 INF에서 수집:
- **API 구조**: URL 패턴, HTTP 메서드 분포, Content-Type
- **요청 파라미터 구조**: 페이징 방식(page+rows vs cursor), 공통 파라미터명
- **응답 JSON 구조**: 최상위 키 패턴(`total`+`rows` vs `data`+`pagination` vs 직접 배열)
- **에러 응답 패턴**: HTTP 상태코드 조합, 에러 body 구조
- **인증 패턴**: 헤더명, 세션 방식, 권한 체크 위치

---

## STEP 3: 소스코드 샘플링

각 INF의 `근거 소스` 필드에서 대표 파일 경로를 수집한다.

```bash
!grep -h "근거 소스:" docs/05_설계서/*/INF/INF-*.md 2>/dev/null | grep -v TBD | head -20
```

다양한 도메인에서 5개 이하로 선별하여 Read한다.  
수집:
- 실제 사용되는 어노테이션/데코레이터 패턴
- 클래스/메서드/변수 명명 규칙
- 인증/권한 처리 방식 (실제 코드)
- 에러 처리 방식 (try/catch, 예외 클래스명)
- DB 접근 패턴 (Mapper 호출 방식, 트랜잭션 어노테이션)

---

## STEP 4: project-context.md 생성

`skills/sl-context/project-context-template.md`를 Read한 후 수집한 정보로 채운다.

**채우는 항목 우선순위:**
1. `## 환경 정보` — STEP 1 감지 결과로 채움 (필수)
2. `## 공통 패턴` → `### API 구조 패턴` — STEP 2 결과 (필수)
3. `## 공통 패턴` → `### 인증/권한 처리 패턴` — STEP 3 결과 (필수)
4. `## 명명 규칙` — STEP 3 결과 (필수)
5. `## 금지 패턴` — STEP 3에서 안티패턴 발견 시만 (선택)
6. `## 프로젝트별 특이사항` — 특이 패턴 발견 시만 (선택)
7. `## speclinker 연동 정보` — 자동 채움 (필수)

**저장:**

```bash
!mkdir -p docs
```

`docs/project-context.md`에 Write 도구로 저장한다.

---

## STEP 5: 완료 보고

```
/sl-context 완료
═══════════════════════════════════
프레임워크 감지: {감지된 프레임워크} ({감지 방법})
INF 분석: {N}개 파일
소스 샘플링: {N}개 파일
출력: docs/project-context.md

주요 발견 패턴:
  API 구조: {한 줄 요약}
  인증 방식: {한 줄 요약}
  명명 규칙: {한 줄 요약}

다음: /sl-aidd 실행 시 이 파일이 자동으로 로드됩니다.
═══════════════════════════════════
```
