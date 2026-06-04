# Speclinker

SI/ITO 개발 전주기 자동화 플러그인 — 요구사항 정의부터 코드 생성·테스트까지 Claude Code 안에서 완결.

---

## 설치되는 것들

```
~/.claude/plugins/speclinker/
│
├── skills/                  ← Claude Code 슬래시 커맨드 (13개)
│   ├── sl-init              /sl-init            프로젝트 초기화
│   ├── sl-recon             /sl-recon            기존 코드 역분석 (소스 스캔 + INF/SCH 생성)
│   ├── sl-recon-uis         /sl-recon-uis        RECON Phase-2: 화면 캡처·UIS 설계서
│   ├── sl-recon-doc         /sl-recon-doc        RECON Phase-3: 문서·RTM 생성
│   ├── sl-aidd              /sl-aidd             FUNC=story 단위 AIDD 루프 (story→승인→구현→QA→테스트)
│   ├── sl-test              /sl-test             TC 작성·실행·TR 생성
│   ├── sl-rtm               /sl-rtm              RTM 커버리지 재계산·게시
│   ├── sl-analyze           /sl-analyze          변경영향분석서(CIA) 작성
│   ├── sl-change            /sl-change           SR 전주기 처리 (로컬 파일·Jira)
│   └── sl-viewer            /sl-viewer           SpecLens 산출물 웹 뷰어
│
├── agents/                  ← 산출물 생성 서브에이전트 (14개)
│   ├── spec-agent.md           파이프라인 오케스트레이터
│   ├── rd-agent.md             요구사항 정의서(RD) 생성
│   ├── srs-agent.md            SRS 상세화
│   ├── sad-agent.md            아키텍처 설계서(SAD)
│   ├── ddd-api-agent.md        API 명세(INF-XXX)
│   ├── ddd-db-agent.md         DB 스키마(SCH-XXX)
│   ├── ddd-ui-agent.md         화면 설계(UIS-F-XXX)
│   ├── ddd-batch-agent.md      배치 명세(BAT-XXX)
│   ├── rtm-agent.md            RTM 체인 + 품질 게이트
│   ├── dev-agent.md            코드 생성
│   ├── test-agent.md           테스트 케이스 생성·실행
│   ├── profile-agent.md        프로젝트 스택 Profile 자동 생성
│   ├── convention-learner.md   팀 컨벤션 자동 학습
│   └── meta-extractor.md       미지원 스택 Strategy yaml 초안 생성
│
├── scripts/                 ← Python·Node.js 자동화 스크립트
│   ├── scan_source.js           제로-LLM 정적 소스 스캔 (form/api kind 분류)
│   ├── dispatch_inf_gen.py      INF 생성 dispatcher (배치 병렬 실행)
│   ├── resolve_call_chain.py    Controller→Service→DAO→Query 사전 추출 + sch_draft 생성
│   ├── ai_nav.js                Chrome CDP BFS 탐색 (snapshot/click/capture)
│   ├── capture.js               CDP attach 기반 화면 캡처 + 위젯 마킹
│   ├── detect_capture_strategy.js 캡처 전략 탐지
│   ├── generate_uis_spec.py     캡처 결과 → UIS spec.md 자동 생성
│   ├── annotate_preview.py      preview.png + widgets.json → 번호 마커 오버레이 생성
│   ├── link_uis_inf.py          UIS URL → INF 링크 패치
│   ├── build_funcs_index.py     rd/srs/rtm 공유 인덱스 빌더
│   ├── build_si_graph.py        SI 트레이싱 그래프 (스펙↔코드 매핑) 빌더
│   ├── func_context_bundle.py   FUNC별 컨텍스트 자동 수집
│   ├── req_scan.py              FUNC 커버리지 스캔
│   ├── merge_index.py           RECON 색인 머징
│   ├── screen_inventory.py      BFS 캡처 소스 경로 역매핑 보강
│   └── link_inf_sch.py          INF→SCH 연결 패치
│
├── templates/               ← 산출물 문서 템플릿 (10개)
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

**요약:** 슬래시 커맨드 13개, 서브에이전트 14개, 자동화 스크립트 16개+, 문서 템플릿 12개.

---

## 사전 요구사항

| 항목 | 최소 버전 | 확인 |
|------|-----------|------|
| Claude Code CLI | 최신 | `claude --version` |
| Node.js | 18+ | `node --version` |
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


## 첫 실행 확인

Claude Code에서 아무 프로젝트 디렉토리를 열고:

```
/sl-init
```

`project.env` 파일이 생성되고 소스 스캔·도메인 카탈로그가 만들어지면 정상 설치된 것입니다.

---

## 워크플로

### 운영 중 시스템 (현행 소스 → 스펙 → AIDD)

```
/sl-init          → 프로젝트 초기화 (project.env 생성 + 소스 스캔)
/sl-recon         → 현행 소스 역분석 → INF/SCH/UIS/FUNC 스펙 생성
/sl-aidd          → FUNC 단위로 코드 + 테스트 자동 생성
/sl-test          → TC 작성·실행·TR 생성
```

### 기존 코드 (설계서 없음)

```
/sl-init   → 프로젝트 초기화
/sl-recon      → 소스 스캔 + 도메인 확정 + INF/SCH 생성
/sl-recon-uis  → 화면 캡처 + UIS 설계서
/sl-recon-doc  → FUNC/SRS/RTM/IA 생성
/sl-aidd   → 누락 기능 추가 개발
```

### 유지보수·변경 (SR 접수)

```
/sl-analyze <SR>  → 변경영향분석서(CIA) 작성
/sl-change <SR>   → AS-IS 조회 → TO-BE 설계 → 코드 생성 → RTM 갱신
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

---

## 문제 해결

| 증상 | 원인 | 해결 |
|------|------|------|
| `/sl-init` 인식 안 됨 | 플러그인 미설치 | `/plugin install speclinker@speclinker` 재실행 |
| `python not found` | Python 미설치·PATH 누락 | Python 3 설치 후 터미널 재시작 |
| `.sh` 실행 안 됨 (Windows) | Git Bash 미설치 | [git-scm.com](https://git-scm.com/downloads) 설치 |
| MCP 연결 실패 | 네트워크·토큰 문제 | `NETWORK=closed` 설정 후 로컬 모드로 동작 |
