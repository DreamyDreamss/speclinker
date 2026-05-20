# Speclinker

SI/ITO 개발 전주기 자동화 플러그인 — 요구사항 정의부터 코드 생성·테스트까지 Claude Code 안에서 완결.

---

## 설치되는 것들

```
~/.claude/plugins/speclinker/
│
├── skills/                  ← Claude Code 슬래시 커맨드 (9개)
│   ├── sl-init              /sl-init        프로젝트 초기화
│   ├── sl-genesis           /sl-genesis     인터뷰→설계서 순방향 생성
│   ├── sl-recon             /sl-recon       기존 코드→설계서 역분석
│   ├── sl-aidd              /sl-aidd        FUNC 단위 AI 개발 파이프라인
│   ├── sl-dev               /sl-dev         코드·단위테스트 자동 생성
│   ├── sl-test              /sl-test        TC 작성·실행·TR 생성
│   ├── sl-rtm               /sl-rtm         RTM 커버리지 재계산·게시
│   ├── sl-analyze           /sl-analyze     변경영향분석서(CIA) 작성
│   └── sl-change            /sl-change      SR 전주기 처리
│
├── ua/skills/               ← 코드 이해 슬래시 커맨드 (8개, UA 통합)
│   ├── understand           /understand     코드베이스 지식 그래프 생성
│   ├── understand-chat      /understand-chat  지식 그래프 기반 Q&A
│   ├── understand-dashboard /understand-dashboard  웹 대시보드 실행
│   ├── understand-diff      /understand-diff  PR/diff 영향 분석
│   ├── understand-domain    /understand-domain  도메인 흐름 그래프 추출
│   ├── understand-explain   /understand-explain  파일·함수 심층 설명
│   ├── understand-knowledge /understand-knowledge  LLM 위키 지식 그래프
│   └── understand-onboard   /understand-onboard  신규 팀원 온보딩 가이드
│
├── agents/                  ← 산출물 생성 서브에이전트 (10개)
│   ├── spec-agent.md        파이프라인 오케스트레이터
│   ├── rd-agent.md          요구사항 정의서(RD) 생성
│   ├── srs-agent.md         SRS 상세화
│   ├── sad-agent.md         아키텍처 설계서(SAD)
│   ├── ddd-api-agent.md     API 명세(INF-XXX)
│   ├── ddd-db-agent.md      DB 스키마(SCH-XXX)
│   ├── ddd-ui-agent.md      화면 설계(UIS-F-XXX)
│   ├── rtm-agent.md         RTM 체인 + 품질 게이트
│   ├── dev-agent.md         코드 생성
│   └── test-agent.md        테스트 케이스 생성·실행
│
├── ua/agents/               ← UA 분석 서브에이전트 (9개)
│
├── scripts/                 ← Python·Node.js 자동화 스크립트
│   ├── func_context_bundle.py   FUNC별 컨텍스트 자동 수집
│   ├── req_scan.py              REQ 커버리지 스캔
│   ├── ua_req_bridge.js         UA 지식 그래프 ↔ REQ-ID 브릿지
│   ├── run-dashboard.js         대시보드 서버 실행
│   ├── merge_index.py           RECON 색인 머징 (Phase-C 대체)
│   ├── build_funcs_index.py     rd/srs/rtm 공유 인덱스 빌더
│   ├── resolve_call_chain.py    Controller→Service→DAO→Query 사전 추출
│   ├── screen_inventory.py      화면 라우트 인벤토리
│   ├── ia_map_builder.py        IA 맵 빌더
│   ├── runtime_capture.js       Playwright 실제 화면 캡처
│   ├── build_capture_plan.py    화면 캡처 시나리오 자동 생성
│   ├── poc_cleanup.py           POC 반복용 산출물 정리기
│   └── screenshot.js            HTML 파일 캡처 (BO admin 폴백)
│
├── templates/               ← 산출물 문서 템플릿 (10개)
│   ├── RD_template.md           요구사항 정의서
│   ├── SRS_template.md          소프트웨어 요구사항 명세
│   ├── SAD_template.md          아키텍처 설계서
│   ├── API_Design_template.md   API 설계서
│   ├── DB_Schema_template.md    DB 스키마
│   ├── UI_Spec_v1.0_template.md 화면 설계서
│   ├── RTM_template.md          요구사항 추적 매트릭스
│   ├── TC_template.md           테스트 케이스
│   ├── TR_template.md           테스트 결과 보고서
│   └── SPEC_CONVENTIONS.md      산출물 작성 규약
│
├── mcp-servers/             ← DB MCP 서버 (DB 스키마 자동 조회용)
│   ├── mariadb_schema_server.py
│   ├── oracle_schema_server.py
│   └── db2_schema_server.py
│
└── CLAUDE.md                ← 커맨드 라우팅 규칙 (Claude가 자동 로드)
```

**요약:** 슬래시 커맨드 17개, 서브에이전트 19개, 자동화 스크립트 10개, 문서 템플릿 12개.

---

## 사전 요구사항

| 항목 | 최소 버전 | 확인 |
|------|-----------|------|
| Claude Code CLI | 최신 | `claude --version` |
| Node.js | 18+ | `node --version` |
| pnpm | 8+ | `pnpm --version` (`npm i -g pnpm`) |
| Python | 3.8+ | `python3 --version` |
| Git | 2.40+ | `git --version` |

---

## 설치 (다른 PC)

### 1단계 — 마켓플레이스 등록 (최초 1회)

Claude Code CLI에서:

```
/plugin marketplace add DreamyDreamss/speclinker
```

### 2단계 — 플러그인 설치

```
/plugin install speclinker@speclinker
```

설치 위치: `~/.claude/plugins/cache/speclinker/speclinker/<버전>/`

### 3단계 — UA 코어 빌드 (자동)

UA 코어 빌드는 **Claude Code 세션 시작 시 자동으로 실행**됩니다 (`SessionStart` 훅).  
최초 설치 후 Claude Code를 열면 빌드가 자동으로 진행됩니다.

> **수동 빌드가 필요한 경우** (훅이 실행 안 됐을 때):
> ```bash
> bash ~/.claude/plugins/cache/speclinker/speclinker/<버전>/scripts/build-ua.sh
> ```

빌드 완료 확인:
```
ua/packages/core/dist/index.js  ← 이 파일이 생성되면 성공
```

---

## 첫 실행 확인

Claude Code에서 아무 프로젝트 디렉토리를 열고:

```
/sl-init
```

`project.env` 파일이 생성되고 프로젝트 모드(GENESIS / RECON / DELTA)를 물어보면 정상 설치된 것입니다.

---

## 워크플로

### 신규 프로젝트 (설계서 없음)

```
/sl-init          → 프로젝트 초기화 (project.env 생성)
/sl-genesis [파일] → 인터뷰·회의록에서 RD/SRS/SAD/API/DB/UI 설계서 자동 생성
/sl-aidd          → FUNC 단위로 코드 + 테스트 자동 생성
/sl-test          → TC 작성·실행·TR 생성
```

### 기존 코드 (설계서 없음)

```
/sl-init   → 프로젝트 초기화
/sl-recon  → 소스 역분석 → 설계서 자동 생성 + UA 지식 그래프 구축
/sl-aidd   → 누락 기능 추가 개발
```

### 유지보수·변경 (SR 접수)

```
/sl-analyze <SR>  → 변경영향분석서(CIA) 작성
/sl-change <SR>   → AS-IS 조회 → TO-BE 설계 → 코드 생성 → RTM 갱신
```

### 코드 이해

```
/understand            → 지식 그래프 생성
/understand-dashboard  → 웹 대시보드로 아키텍처 시각화
/understand-domain     → 도메인 흐름도 추출
/understand-diff       → PR 영향 분석
```

---

## MCP 연동 (선택)

Jira, GitHub, Confluence, DB에 네트워크 접근이 가능한 환경이면 `.mcp.json`을 설정해 자동 연동합니다.

```bash
# 프로젝트 루트에서
cp ~/.claude/plugins/speclinker/templates/mcp/.mcp.json.example .mcp.json
# .mcp.json 열어서 토큰·DB 접속 정보 입력
```

`NETWORK=closed` 환경에서는 MCP 없이 로컬 파일만으로 전 기능 동작합니다.

---

## 업데이트

```
/plugin update speclinker@speclinker
```

업데이트 후 UA 코어를 다시 빌드합니다 (ua/packages/core 변경 시):

```bash
cd ~/.claude/plugins/speclinker/ua && pnpm install && pnpm --filter @understand-anything/core build
```

---

## 문제 해결

| 증상 | 원인 | 해결 |
|------|------|------|
| `/sl-init` 인식 안 됨 | 플러그인 미설치 | `/plugin install speclinker@speclinker` 재실행 |
| `/understand-dashboard` 실행 안 됨 | UA 코어 미빌드 | 3단계 빌드 재실행 |
| `python not found` | Python 미설치·PATH 누락 | Python 3 설치 후 터미널 재시작 |
| `.sh` 실행 안 됨 (Windows) | Git Bash 미설치 | [git-scm.com](https://git-scm.com/downloads) 설치 |
| MCP 연결 실패 | 네트워크·토큰 문제 | `NETWORK=closed` 설정 후 로컬 모드로 동작 |
