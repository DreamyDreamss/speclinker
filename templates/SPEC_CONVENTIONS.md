# SPEC_CONVENTIONS — 스펙 ID·체인·파일 규약

> **목적**: 에이전트·개발자가 **한 페이지**만 읽어 전체 산출물 체계를 파악한다.  
> **토큰 절약 원칙**: 각 ID는 SoT 파일에만 상세 내용이 있다. 다른 문서는 ID로만 참조한다.

---

## 1. 스펙 체인 (Spec Chain)

```
FUNC-XXX
  │ traces_to
  ├─► SRS-F-XXX   (기능 명세)
  │
  ├─► UIS-F-XXX  (화면 설계)    ← FUNC traces_to
  │       │ calls
  │       └─► INF-XXX          ← UIS calls (메소드 단위)
  │                 │ reads_from
  │                 └─► SCH-XXX  (DB 테이블)
  │
  ├─► INF-XXX    (인터페이스)    ← FUNC traces_to (직접 연결도 가능)
  │
  └─► TC-F-XXX   (테스트케이스)  ← FUNC traces_to

SRS-NF-XXX → SRS-NF-XXX → TC-NF-XXX
SR-XXX  (변경 요구사항, 독립 트리)
```

---

## 2. ID 규약


| 타입    | 패턴                                     | SoT 파일                        | 파싱 규약 (표 형식)                                 |
| ----- | -------------------------------------- | ----------------------------- | -------------------------------------------- |
| `func`| `FUNC-{도메인}-NNN`, `SRS-NF-NNN`, `SR-NNN` | `docs/00_FUNC/FUNC_v1.0.md` | `| FUNC-001 | 이름 |`                         |
| `srs` | `SRS-F-NNN`, `SRS-NF-NNN`              | `docs/03_기능명세서/SRS_v1.0.md`     | `| SRS-F-001 | 이름 | FUNC-001 |`             |
| `uis` | `UIS-F-NNN`                            | `docs/05_설계서/UI_Spec_v1.0.md` | `| UIS-F-001 | 화면명 | FUNC-001 |`            |
| `inf` | `INF-NNN`                              | `docs/05_설계서/API_Design.md`   | `| INF-001 | POST /path — 기능명 | FUNC-001 |` |
| `sch` | `SCH-NNN`                              | `docs/05_설계서/DB_Schema.md`    | `| SCH-001 | 테이블명 | INF-001 |`               |
| `tc`  | `TC-F-NNN`, `TC-NF-NNN`                | `docs/07_테스트케이스/TC_v1.0.md`       | `| TC-F-001 | 이름 | FUNC-001 |`              |


**INF 핵심 규칙**: **1 INF = 1 HTTP 메소드(엔드포인트).** 같은 `API_Design.md` 파일 안에 여러 행 → 각각 개별 `inf` 노드. 파일 단위가 아님.

**UIS→INF 링크** (별도): `docs/05_설계서/screens/UIS-F-NNN.md`  2.5 사용 INF 절  
→ `\| UIS-F-001 \| INF-001 \|` (2열, 한 화면이 여러 메소드 호출 시 행 추가)

---

## 3. 디렉터리 구조

```
docs/
  00_FUNC/           FUNC SoT (FUNC_v1.0.md + domains/)
  02_RTM/            추적 매트릭스 (마스터 체인 뷰)
  03_SRS/            SRS SoT
  04_SAD/            아키텍처 설계
  05_DDD/
    API_Design.md    INF SoT — INF 색인 표 필수 (1행=1메소드)
    DB_Schema.md     SCH SoT — 스키마 색인 표 필수
    UI_Spec_v1.0.md  UIS 색인 표 필수
    screens/         UIS-F-NNN.md (상세 와이어 + 2.5 사용INF 절)
  07_TC/             TC SoT
  08_TR/             테스트 결과
  ops/               운영 이슈·변경 로그

(소스코드)            실제 소스 트리 = project.env SOURCE_*_PATH (docs/ 밖, speclinker가 만들지 않음)
```

---

## 4. RTM — 마스터 체인 뷰

`docs/02_추적표/RTM_v1.0.md` 기능 요구사항 표:

```
| FUNC-ID | 요구사항명 | SRS-ID | UIS-ID | INF-ID | SCH-ID | TC-ID | 코드 | 상태 |
```

이 표 한 줄이 **한 요구사항의 전체 체인**을 표현한다.  
INF는 복수 개일 수 있으므로 대표 INF-ID 하나를 기입하고, 상세는 `API_Design.md` 색인 참조.

---

## 5. 에이전트 독서 순서 (토큰 최소화)

1. `SPEC_CONVENTIONS.md` (본 파일) — 체계 파악
2. `docs/02_추적표/RTM_v1.0.md` — 현재 체인 상태 확인
3. 작업 대상 ID의 SoT 파일만 읽는다
  - FUNC 변경 → `00_FUNC/`  
  - INF 구현 → `05_DDD/API_Design.md` + 해당 `SRS`  
  - DB 설계 → `05_DDD/DB_Schema.md`  
  - 화면 구현 → 해당 `UIS-F-NNN.md` + `API_Design.md` INF 색인
4. 코드 파일은 linked_func 주석 또는 RTM 코드 열에서 확인

> **중요**: 전체 문서를 통독하지 말 것. ID를 통해 필요한 섹션만 점프해서 읽는다.

---

## 6. UA 대시보드 활용


| 목적           | 방법                                              |
| ------------ | ----------------------------------------------- |
| 전체 체인 확인     | RTM 탭 → 표 확인                                    |
| 특정 FUNC 영향 범위 | FUNC 노드 클릭 → 연결 노드 확인                            |
| 미구현 INF 찾기   | `layer:si-inf` 레이어 → 코드 연결 없는 `inf` 노드          |
| 미설계 화면 찾기    | `layer:si-screens` 레이어 → `calls` 엣지 없는 `uis` 노드 |
| DB 의존성 확인    | `sch` 노드 → `reads_from` 역방향 → 어떤 INF가 사용하는지     |
| 화면↔인터페이스 연결  | `uis` 노드 → `calls` 엣지 → `inf` 노드                |


---

> 이 파일은 `sl-recon`, `sl-aidd`, `sl-test` 실행 전 자동으로 참조된다.
> 에이전트는 체인에 새 항목이 생길 때마다 RTM 해당 행을 갱신한다.

