# Speclinker Docsify Viewer + IA Navigation Design

## Goal

speclinker RECON 산출물(INF/UIS/SCH/BAT/FUNC_MAP)을 브라우저에서 탐색·열람할 수 있는 웹 뷰어를 구현한다. 수백 개의 스펙 파일을 메뉴 계층(IA 트리) 또는 도메인 기준으로 드릴다운할 수 있어야 한다.

## Architecture

**방식 C (확정)**: Python 사이드카 + Docsify 커스텀 JS 플러그인

```
gen_docsify.py ──스캔──► spec_index.json  ──로드──► docsify-sl.js
                         ia_tree.json               (브라우저 런타임)
                                                     ↓
                                             index.html (Docsify SPA)
```

- `gen_docsify.py`: 스펙 파일 스캔 → 메타데이터 추출 → JSON 인덱스 생성
- `docsify-sl.js`: Docsify 커스텀 플러그인, 대시보드·사이드바·IA트리 렌더링
- `index.html`: Docsify SPA 진입점 (CDN 로드, 골드 다크 테마)
- 기존 `.md` 파일 **무수정** — Docsify가 마크다운 그대로 HTML 렌더링
- 서버: `python -m http.server 5173` (제로 의존성)

## Tech Stack

- Docsify 4.x (CDN, MIT)
- docsify-search plugin (내장)
- Python 3.x 표준 라이브러리만 사용 (PyYAML 제외, frontmatter 직접 파싱)
- 의존성 설치 없음

---

## 1. 레이아웃 — 하이브리드 C

```
┌─────────────────┬────────────────────────────────────────┐
│  ⚡ Speclinker  │  [탭: INF] [UIS] [SCH] [BAT]          │
│                 │                                        │
│  🏠 대시보드    │  INF-ORD-011  POST  /order/ivr/...    │
│  📋 FUNC_MAP    │  INF-ORD-012  GET   /order/list        │
│  ⚡ Sprint      │  ...                                   │
│                 │                                        │
│  [도메인│IA]    │                                        │
│  ─ ─ ─ ─ ─ ─   │                                        │
│  ● order        │                                        │
│  ○ product      │                                        │
│  ○ fulfillment  │                                        │
└─────────────────┴────────────────────────────────────────┘
```

- 왼쪽 사이드바: 고정 링크(대시보드/FUNC_MAP/Sprint) + 사이드바 모드 토글 + 도메인 또는 IA 트리
- 오른쪽 메인: 도메인 선택 시 INF/UIS/SCH/BAT 탭 전환
- INF 상세 클릭 → 풀 문서 + 우측 Quick Nav

---

## 2. 테마 — 골드 다크

| 토큰 | 값 | 용도 |
|------|----|------|
| `--bg-primary` | `#0d1117` | 전체 배경 |
| `--bg-secondary` | `#161b22` | 카드·패널 배경 |
| `--bg-tertiary` | `#21262d` | 테이블 행 호버 |
| `--border` | `#30363d` | 구분선 |
| `--accent` | `#d4a574` | 골드 액센트 (로고·활성탭·선택항목) |
| `--text-primary` | `#c9d1d9` | 본문 |
| `--text-muted` | `#8b949e` | 보조 텍스트·레이블 |
| `--method-get` | `#1f6feb` | GET 뱃지 |
| `--method-post` | `#238636` | POST 뱃지 |
| `--method-put` | `#9e6a03` | PUT 뱃지 |
| `--method-delete` | `#da3633` | DELETE 뱃지 |
| `--status-done` | `#3fb950` | Sprint done |
| `--status-review` | `#f0883e` | Sprint review |
| `--status-prog` | `#58a6ff` | Sprint in-progress |

---

## 3. 대시보드

홈(`#/`)에서 표시하는 두 개 구역:

### 3-A. 상단 요약 카드 (4개)
```
[ 187 INF ] [ 71 UIS ] [ 48 SCH ] [ 12 BAT ]
```
각 카드 클릭 → 전체 도메인 통합 목록 뷰

### 3-B. 도메인 매트릭스 테이블
| 도메인 | INF | UIS | SCH | BAT | 스펙완성도 | 개발완료율 |
|--------|-----|-----|-----|-----|---------|---------|
| order  | 42  | 18  | 12  | 3   | ████░ 78% | ████░ 65% |

- **스펙완성도**: `[TBD]` 없는 INF 비율 (`spec_index.json`의 `tbd_count` 필드)
- **개발완료율**: `sprint-status.yaml`의 도메인별 `done / total` 비율
- 도메인명 클릭 → 해당 도메인 INF 탭으로 이동

---

## 4. INF 렌더링

### 4-A. 목록 뷰 (도메인 선택 + INF 탭)
```
POST  INF-ORD-011  녹취 배송지 처리   /app/order/ivr/ord231ProcessSave
GET   INF-ORD-012  주문 목록 조회    /app/order/list
```
- 메서드별 색상 뱃지
- 클릭 → 상세 뷰 (Docsify 라우트: `#/docs/05_설계서/INF/INF-ORD-011`)

### 4-B. 상세 뷰
- Docsify가 `.md` 파일 그대로 렌더링
- 우측 Quick Nav 패널 (overlay):
  - `## ` 헤더 자동 감지 → 섹션 점프 링크 생성
  - `## 비즈니스 규칙`, `## 트랜잭션 순서` → 골드 색상 강조

---

## 5. UIS 렌더링

### 5-A. 목록 뷰
```
[썸네일]  UIS-F-031  주문 목록 화면   /order/list
[썸네일]  UIS-F-032  주문 상세 화면   /order/detail
```
- `preview.png` 존재 시 80×60 썸네일 표시, 없으면 아이콘 플레이스홀더

### 5-B. 상세 뷰
- Docsify가 `spec.md` 그대로 렌더링
- 우측 패널: 연결된 INF 목록 (`apis:` frontmatter에서 추출)
- `preview.png` 상단 표시 (존재 시)

---

## 6. 크로스링크

마크다운 본문에서 다음 패턴을 자동 클릭 링크로 변환 (docsify-sl.js 후처리):

| 패턴 | 링크 대상 |
|------|---------|
| `INF-XXX-NNN` | `#/docs/05_설계서/INF/domain/INF-XXX-NNN` |
| `UIS-F-NNN` | `#/docs/05_설계서/UIS/UIS-F-NNN/spec` |
| `SCH-XXX` | `#/docs/05_설계서/SCH/SCH-XXX` |
| `FUNC-domain-NNN` | FUNC_MAP.md 해당 행 앵커 |

---

## 7. 검색

- Docsify 내장 `docsify-search` 플러그인 (전문 검색)
- 추가: `spec_index.json` 메타데이터 검색 (method, path, domain, menu-path)
- 검색 결과에 문서 타입 뱃지 표시 (`INF` / `UIS` / `SCH` / `BAT`)

---

## 8. IA 내비게이션 (신규)

### 8-A. 사이드바 모드 토글

왼쪽 사이드바 상단에 토글 버튼:
```
[도메인 모드] [IA 트리 모드]
```

**도메인 모드** (기본): order / product / fulfillment ...  
**IA 트리 모드**: 메뉴 계층으로 화면 탐색 → 화면 클릭 시 연결 INF 목록 표시

```
▾ 주문관리
  ▾ 주문조회
      UIS-F-031  (INF-ORD-011, INF-ORD-012)
  ▸ 주문등록
▸ 상품관리
▸ 배송관리
```

### 8-B. `menu-path` frontmatter 필드 (UIS)

`ddd-ui-agent`가 UIS 생성 시 route 구조를 분석해서 자동 주입:

```yaml
menu-path:           # 신규 추가
  - 주문관리
  - 주문조회
```

추론 전략 (우선순위 순):
1. 메뉴 설정 파일이 있으면 직접 매핑 (예: `menu.js`, `routes.js`의 title/label 필드)
2. URL 계층 구조로 추론 (`/order/list` → `주문관리 > 주문 목록`)  
3. 추론 불가 시 `[TBD]` 기입 (수동 입력 유도)

### 8-C. `spec_index.json` IA 트리 구조

```json
{
  "ia_tree": {
    "주문관리": {
      "주문조회": {
        "screens": ["UIS-F-031"],
        "infs": ["INF-ORD-011", "INF-ORD-012"]
      }
    }
  },
  "domains": { ... },
  "infs": [ ... ],
  "uis": [ ... ]
}
```

---

## 9. `/sl-ia` 신규 스킬

**목적**: RECON 산출물 기반으로 전체 IA 문서 자동 생성

**입력**: `project.env` + 소스 route 파일 + 기존 UIS spec.md

**출력**:
- `docs/00_IA/IA_MAP.md`: 메뉴 트리 → 화면 → INF 링크 테이블
- 기존 UIS `spec.md`에 `menu-path:` 필드 일괄 보완 (기존 파일 업데이트)

**IA_MAP.md 구조**:
```markdown
# IA_MAP — {프로젝트명}

## 주문관리

| 메뉴 경로 | 화면ID | 화면명 | INF | 라우트 |
|---------|-------|------|-----|------|
| 주문관리 > 주문조회 | UIS-F-031 | 주문 목록 화면 | INF-ORD-011, INF-ORD-012 | /order/list |
```

**스텝**:
1. route 파일 스캔 (React Router/Next.js pages/Spring MVC/JSP)
2. UIS spec.md 전수 읽기 → `라우트:` 필드 매핑
3. 메뉴명 추론 (menu 설정 파일 우선, URL 계층 fallback)
4. `menu-path:` 필드 UIS 파일에 upsert
5. `IA_MAP.md` 생성

---

## 10. `gen_docsify.py` — 파일 구조 및 파싱 계약

### 스캔 대상

```
{project_root}/docs/05_설계서/
├── INF/{domain}/INF-*.md       → inf-id, method, path, domain, tbd_count
└── UIS/{screen}/spec.md        → uis-id, 화면명, 라우트, menu-path, apis
{project_root}/docs/04_DB설계서/SCH-*.md  → sch-id, domain, tables
{project_root}/docs/00_FUNC/FUNC_MAP.md   → 카운트만
{project_root}/.speclinker/sprint-status.yaml → done/total per domain
```

### 파싱 방식
- YAML frontmatter: `---\n...\n---` 블록 직접 파싱 (PyYAML 설치 없이 정규식)
- `[TBD]` 카운트: frontmatter 이후 본문에서 `\[TBD\]` 개수 집계
- 실패 허용: frontmatter 없는 파일 → `id`를 파일명에서 추출, 나머지 `-` 처리

### 출력
```
{project_root}/docs/viewer/
├── index.html
├── docsify-sl.js
├── sl-theme.css
└── spec_index.json   ← gen_docsify.py 산출물 (gitignore 대상)
```

---

## 11. 뷰어 실행 통합

**기존 `/sl-viewer`** (Obsidian 기반, `gen_obsidian_index.py`)는 **Docsify 방식으로 교체**한다.  
`SKILL.md`와 `gen_obsidian_index.py`는 하위 호환 유지를 위해 제거하지 않고 deprecated 표기.

터미널 직접:

```bash
python scripts/gen_docsify.py          # spec_index.json 갱신
python -m http.server 5173 --directory docs/viewer
# → http://localhost:5173
```

`gen_docsify.py`는 프로젝트 루트에서 실행, `project.env`에서 `SPEC_ROOT` 경로 읽음.

---

## 12. 파일 목록

| 파일 | 역할 | 신규/수정 |
|------|------|---------|
| `scripts/gen_docsify.py` | 스캔·파싱·JSON 생성 | 신규 |
| `docs/viewer/index.html` | Docsify SPA 진입점 | 신규 |
| `docs/viewer/docsify-sl.js` | 커스텀 플러그인 (대시보드·사이드바·크로스링크) | 신규 |
| `docs/viewer/sl-theme.css` | 골드 다크 CSS 변수 + 컴포넌트 스타일 | 신규 |
| `skills/sl-ia/SKILL.md` | `/sl-ia` 스킬 (IA 문서 생성) | 신규 |
| `agents/ddd-ui-agent.md` | `menu-path:` frontmatter 추가 + 추론 로직 | 수정 |
| `CLAUDE.md` | `/sl-ia` 라우팅, `/sl-viewer` 업데이트 | 수정 |
| `.claude-plugin/plugin.json` | `sl-ia` 스킬 등록, 버전 bump | 수정 |

---

## 13. 비기능 요구사항

- **빌드 없음**: CDN Docsify, 순수 HTML/CSS/JS
- **오프라인 동작**: CDN 로드 실패 시 경고만 (spec_index.json은 로컬)
- **점진적 개선**: `menu-path`가 없는 UIS도 도메인 모드로 정상 표시
- **gitignore**: `spec_index.json`은 빌드 산출물 → `.gitignore` 추가 권장
- **파일 한계**: INF 500개 기준 `spec_index.json` 예상 크기 ~200KB, 브라우저 로드 문제 없음
