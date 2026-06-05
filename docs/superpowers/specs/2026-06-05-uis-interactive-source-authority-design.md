# 화면설계서(UIS) 생성 근본 재설계 — 인터랙티브 라이브 DOM 권위 + 소스폴백

> 2026-06-05. `/sl-recon-uis`의 화면설계서 생성 방식을 근본적으로 바꾼다.
> 합의 경로: **인터랙티브 우선 + 소스폴백** (기존 BFS/goto batch 폐기).

## 1. 문제 — 한 뿌리에서 나온 4가지 한계

현행 `sl-recon-uis`는 화면설계서(UIS)를 **라이브 DOM 캡처(BFS 전수탐색 / form URL goto)** 에서 생성한다. 실전(pr201Form 상품등록)에서 드러난 한계:

1. **권한·메뉴컨텍스트 의존 위젯 누락** — 등록/삭제 등은 JSP `<auth:button groupId="2"/>`가 **menuId 단위**로 서버에서 렌더한다. goto로 컨트롤러 URL을 직타하면 포털 셸이 주입하던 메뉴 컨텍스트가 없어 태그가 **빈 채로 렌더** → 버튼이 DOM에 아예 없음("순수 JSP").
2. **세션 의존·truncation** — 캡처는 *한 세션이 본 것*이지 *화면이 무엇인지*가 아니다. 위젯 상한(120) truncation, 저권한 계정 스냅샷 등.
3. **UIS↔INF 미연결** — api_hints가 빈약해 화면→API 매핑이 비어 OVERVIEW에 "연결 API 미확인"이 남는다.
4. **프레임워크 idiom의 무한 케이스** — `auth:button`/`JGrid colModel`/`$.ajax` 같은 idiom을 파서에 규칙으로 넣는 순간 jwork 전용이 된다. Next.js·Vue·FastAPI는 idiom이 전부 달라 케이스가 무한히 늘어나고 CLAUDE.md "스택중립" 원칙을 위반한다.

**근본 원인 2가지:** (a) 캡처 방식이 메뉴·권한 컨텍스트에 취약, (b) **의미추출을 파서(결정적 코드)에 넣으려는 유혹**.

## 2. 해결 원칙

1. **사람이 컨텍스트를 준다.** 자동 BFS/goto 대신 사용자가 **메뉴로 직접 진입**해 완전 렌더된 화면을 띄운다 → 메뉴 컨텍스트·권한·올바른 탭이 모두 살아있어 `auth:button`까지 전부 렌더된 진짜 화면을 캡처. menuId 위조·포털 자동네비 같은 취약한 reverse-engineering 불필요.
2. **DOM은 중립 뼈대, 소스는 의미.** 라이브 DOM은 어느 스택이든 동일(JSP·JSX·Vue 모두 DOM). DOM에서 위젯·버튼·레이아웃(보이는 것)을 얻고, 에이전트가 *필요할 때만* 소스를 **읽어** 동작·엔드포인트·검증 의미(보이지 않는 것)를 입힌다.
3. **에이전트가 해석한다(파서가 아니다).** INF가 이미 이 방식이다 — `ddd-api-agent`는 jwork용 컨트롤러 파서를 쓰지 않고 컨트롤러를 *읽어서* 일반화한다. `ddd-ui-agent`도 `<auth:button>`을 보고 "권한 버튼 슬롯"이라 *판단*한다. **프레임워크 분기 코드는 절대 넣지 않는다.**
4. **조인 키 = raw 엔드포인트 경로.** UIS↔INF 매핑을 생성 순서와 무관한 **결정적 경로조인**으로 만든다.

> **결정적 레이어 vs 에이전트의 경계 (불변 규율):** 결정적 스크립트는 *스택중립한 일*만 한다 — 라우트→진입파일 찾기, 로컬 참조 슬라이스 수집, 일반 텍스트 신호(따옴표 안 경로 리터럴 `'/...'`, `id=`/`name=` 토큰) 추출. **의미부여·idiom 해석은 전부 에이전트.** 프레임워크 if/else가 결정적 레이어에 들어오면 설계 위반.

## 3. 새 파이프라인 — `/sl-recon-uis`

### 모드 A — 인터랙티브 (주 경로, 구동 앱 + 사람)

| STEP | 동작 | 비고 |
|------|------|------|
| **U1** | Chrome CDP 기동 + 로그인 | 기존 STEP 6-1 재사용 |
| **U2** | 사용자가 **메뉴로 화면 진입** 후 "이거 캡처해" | 사람이 컨텍스트 제공 |
| **U3** | 활성탭의 **화면 프레임** 식별(URL 일치 프레임) → 스크린샷 + **DOM 스냅샷** 추출 | 위젯 상한 제거. 버튼/입력의 `id·name·label·onclick·type·bbox` 수집. iframe 안이면 그 프레임 |
| **U4** | 도메인 판정 = `activeRoute` URL 세그먼트(+소스경로 보강) | 스택중립 |
| **U5** | **소스 슬라이스 수집** — route→진입파일(screen_inventory) + 그 파일이 참조하는 로컬 자산(JSP include·동명 JS·import 컴포넌트) + 일반 텍스트 신호(경로 리터럴·id 토큰) | `collect_screen_slice.py`(신규), 스택중립 "참조 따라가기" |
| **U6** | **ddd-ui-agent 배치** — 입력=DOM 스냅샷 + 소스 슬라이스 → UIS 작성. 버튼→JS 핸들러→`ajax url` 추적해 **api_hints(raw 경로)** 기록 | 소스 권위, 스크린샷 보조 |
| ↺ | U2~U6 화면 단위 반복 | 사람 페이스 |
| **U7** | `link_uis_inf.py` — api_hints × INF(method,path) **경로조인** → UIS 위젯 "연결 API"=INF-ID, INF frontmatter `screens += UIS-ID` (양방향) | zero-LLM, 생성순서 무관 |
| **U8** | `_TOC.md` 생성 | 기존 재사용 |

### 모드 B — 소스폴백 (구동 앱 없음)

U1~U3 스킵. `screen_inventory_static.json`의 진입파일 → U5 소스 슬라이스만으로 U6 ddd-ui-agent가 UIS 생성(스크린샷 없음, 저품질이지만 동작). U4·U6·U7·U8 동일. **같은 에이전트, 입력만 다름**(라이브 DOM 있으면 최상 ▸ 소스 슬라이스 폴백).

### 폐기 대상

- BFS 전수탐색 전체(STEP 6-2-*, `ai_nav.js` 탐색 루프)
- form URL goto 플랜(STEP 6-0-GOTO, `build_uis_goto_plan.py`)
- 도메인 선택 batch 프롬프트(인터랙티브는 화면당 1개라 불필요)
- 위젯 캡처 truncation(상한)·`detect_capture_strategy.js` BFS 전략 분기

## 4. 파일 변경

| 파일 | 변경 |
|------|------|
| `skills/sl-recon-uis/SKILL.md` | **대폭 축소**(1417줄→~인터랙티브 U1~U8). BFS/goto/static-batch 머신 삭제 |
| `scripts/capture_screen_dom.js` (신규 또는 `capture_single_tab.js` 개조) | 활성탭 **화면 프레임** DOM+스크린샷. 위젯 상한 없음. `onclick·id·name·label` 포함. iframe 프레임 선택 |
| `scripts/collect_screen_slice.py` (신규) | route→진입파일 + 로컬 참조 자산 슬라이스(스택중립) + 일반 텍스트 신호(경로 리터럴·id 토큰) 힌트 |
| `agents/ddd-ui-agent.md` | **재정의** — 입력=DOM 스냅샷+소스 슬라이스, 출력=UIS(소스 권위·스크린샷 보조). 버튼→ajax→api_hints(raw). **프레임워크 분기 금지** 명시 |
| `scripts/generate_uis_spec.py` | 역할 축소 — 캡처위젯 표 자동생성기 → (선택) 결정적 스캐폴드(frontmatter/§틀)만, 본문은 에이전트. 또는 폐기 |
| `scripts/link_uis_inf.py` | 조인 키 **raw 경로**로 통일, **양방향**(INF.screens 역기록) |
| `scripts/spec_graph_build.py` | `screen_to_inf`를 raw 경로 조인으로 일원화 |
| `build_uis_goto_plan.py`, `ai_nav.js`, `detect_capture_strategy.js` | 폐기 또는 deprecated |
| 참조문서 | `docs/RECON_PIPELINE.md`, `CLAUDE.md`(버전노트), `scripts/README.md`, `README.md`, `templates/UIS*.md` 동기화(DoD) |

## 5. INF 매핑 프로세스 (생성순서 무관)

```
UIS 생성 시(U6)  : 에이전트가 DOM 버튼 → JS 핸들러 → ajax url 추적해 관측 경로를 그대로 기록
                  frontmatter  api_hints: ["/product/prdreg/productList", ...]
                  §4 위젯별     "연결 API(raw): POST /product/prdreg/productList"
                  → 이 시점 INF가 없어도 됨 (raw 경로만 박아둠)

매핑 단계(U7)    : link_uis_inf.py (zero-LLM, 경로 조인)
                  - 모든 UIS.api_hints × 모든 INF.(method,path) 인덱스
                  - UIS 위젯 "연결 API" → INF-ID 치환
                  - INF frontmatter  screens: [UIS-…]  역기록 (양방향)
```

조인 키가 **안정적 raw 경로**라서 UIS를 먼저 만들든 INF를 먼저 만들든 동일하게 연결된다.

## 6. 스택중립 검증 의무 (CLAUDE.md §범용성)

- **Java/JSP**(nkshop-bos-admin) + **Next.js**(KDI) **2스택**으로 검증한다:
  - 인터랙티브(라이브 DOM): 두 스택 각각 화면 1개씩 캡처→UIS.
  - 소스폴백: 구동 앱 없이 진입파일 슬라이스→UIS.
- 단일 스택 통과만으로 완료 처리 금지.

## 7. 비목표 (YAGNI)

- menuId 위조 / 포털 자동 네비게이션(프레임워크 jar 의존·취약) — **사람이 메뉴 진입으로 대체**.
- 프레임워크별 위젯 파서(auth:button/JGrid 규칙 하드코딩) — **에이전트가 읽어 일반화**.

## 8. 문서 수준 — SOP급(신규자 온보딩) + 기계 인덱스 이중 레이어

이 재설계의 **핵심 목적**: UIS를 [TBD] 위젯표가 아니라 **신규입사자가 읽고 시스템을 이해하는 SOP급 문서**로 만든다. 동시에 AIDD/JIT용 기계 인덱스도 유지한다(INF 재설계의 이중레이어 원칙과 동일).

> **왜 이제 가능한가:** 스크린샷+bbox 캡처엔 의미가 없어 SOP를 쓸 수 없었다. 에이전트가 **소스(DOM 동작 + JS 핸들러 + 슬라이스)를 읽으므로** 화면의 *목적·작업흐름·버튼의 동작→API→결과*를 글로 쓸 수 있다.

### SOP급 UIS 섹션 구조 (ddd-ui-agent 출력)

| 섹션 | 레이어 | 내용 |
|------|--------|------|
| §0 화면 미리보기 | 사람 | 스크린샷 + 위젯 마커 |
| §1 화면 목적 | 사람(SOP) | "이 화면으로 무엇을 하는가" 1~3줄 — 신규자가 첫 줄에서 파악 |
| **§2 주요 작업 시나리오** | **사람(SOP 핵심)** | "상품 등록하려면 ① 검색조건→조회 ② 목록선택/신규 ③ 기초정보 탭 입력 … ⑨ 저장" 스텝 내러티브. **온보딩 문서의 본체** |
| §3 화면 구성(블록) | 사람 | 검색영역/목록그리드/탭폼(8탭)/액션영역 — 각 블록의 역할 |
| §4 위젯·액션 | 사람+기계 | 버튼/필드 + **동작 → API(INF) → 결과**. api_hints(raw) 포함 |
| §5 접근권한·표시조건 | 사람+기계 | `auth:button groupId`, MD권한 등 — 버튼이 왜 보이고 안 보이는지 |
| §6 데이터 출처·연결 | 기계 | api_hints(raw)→INF-ID, 참조 테이블(SCH) |
| anchors | 기계(정본 진실) | 진입파일 + 핵심 핸들러 file:line — JIT 회귀 근거 |

§2 작업 시나리오가 **SOP급의 핵심**이다 — 이게 있어야 신규자가 "이 화면으로 뭘 어떻게 하는지" 이해한다. 기존 UIS엔 이 섹션이 없었다.

> 기계 인덱스(§4 api_hints·§6·anchors)와 사람 내러티브(§1·§2·§3)는 **명시 분리**한다(드리프트 시 사람 레이어가 기계 레이어를 오염시키지 않도록).

## 9. 열린 항목 (구현 계획에서 확정)

- `generate_uis_spec.py`를 **결정적 스캐폴드로 축소**할지 **완전 폐기**(에이전트 일임)할지 — 토큰/일관성 trade-off.
- DOM 스냅샷 직렬화 포맷(에이전트 입력용) — 위젯 트리 + 핸들러 힌트의 최소 표현.
- 화면 프레임 선택 휴리스틱(활성탭에 iframe 다수일 때 화면 프레임 식별 규칙).
