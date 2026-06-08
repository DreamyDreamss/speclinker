# Speclinker

운영 중 시스템(SM)의 **현행 소스를 스펙(INF/SCH/UIS/FUNC)으로 역생성**하고, 그 스펙을 근거로
**AIDD(AI 변경개발)** 와 **변경관리(SR)** 를 Claude Code 안에서 수행하는 플러그인.
(신규구축/SI 순방향 모드는 없음 — SM 전용.)

---

## 사전 요구사항

| 항목 | 최소 | 확인 명령 |
|------|------|-----------|
| Claude Code | 최신 | `claude --version` |
| Node.js | 18+ | `node --version` |
| Python | 3.10+ | `python --version` |
| Git | 2.40+ | `git --version` |

> ⚠️ **Windows 주의**: 공식 Python 설치는 `python.exe`만 만듭니다. `python3`는 Microsoft Store
> 스텁(가짜)일 수 있으니 **`python --version`** 으로 확인하세요. 플러그인 스크립트는 모두 `python`을 씁니다.
> Mac/Ubuntu에서 `python`이 없고 `python3`만 있으면 `python-is-python3`(Ubuntu) 또는 alias로 `python`을 맞춰주세요.

---

## 설치

### 1단계 — 마켓플레이스 등록 (최초 1회)
```
/plugin marketplace add DreamyDreamss/speclinker
```

### 2단계 — 플러그인 설치
```
/plugin install speclinker@speclinker
```
설치 위치: `~/.claude/plugins/cache/speclinker/speclinker/<버전>/`

### 3단계 — 첫 세션: 의존성 자동 설치 (자동, 확인만)
설치 후 **Claude Code를 한 번 재시작**하면 `SessionStart` 훅(`scripts/setup-deps.js`)이 자동으로 설치합니다:
- `playwright-core`, `tree-sitter`(java/python/typescript) — npm (소스 스캔·화면 캡처)
- `Pillow` — pip (UIS 마커 이미지)
- `project.env`에 `MCP_DB_*=true`가 있으면 그 DB 드라이버 + MCP 코어도 자동 설치

> 인터넷이 없거나 tree-sitter 네이티브 빌드 도구가 없어도 **regex 폴백**으로 핵심 기능은 동작합니다(정밀도만 하락).
> 콘솔에 `[speclinker] ... OK` 로그가 보이면 정상입니다.

### 4단계 — 첫 실행 확인
아무 프로젝트 디렉토리에서:
```
/sl-init
```
`project.env`가 생성되고 소스 경로·네트워크·(선택)MCP 설정이 잡히면 정상입니다.

---

## 무엇이 설치되나

| 구성 | 수 | 내용 |
|------|----|------|
| 슬래시 커맨드(skills) | 12 | sl-init · sl-recon · sl-recon-uis · sl-recon-doc · sl-aidd · sl-change · sl-test · sl-status · sl-drift · sl-context · sl-ia · sl-viewer |
| 서브에이전트(agents) | 15 | rd/srs/sad/ddd-api/ddd-db/ddd-ui/ddd-batch/rtm(산출물) · dev/qa/test(코드) · spec/profile/convention-learner/meta-extractor |
| 자동화 스크립트 | 38 | scan_source · resolve_call_chain · dispatch_* · build_sch_static · scan_query_patterns · gen_docsify · sl_board_cdp 등 (zero-LLM 우선) |
| 문서 템플릿 | 9 | SRS/SAD/API_Design/DB_Schema/UI_Spec/RTM/TC/TR/SPEC_CONVENTIONS |
| DB MCP 서버 | 3 | oracle / db2 / mariadb (`mcp-servers/`, SELECT 전용 + readonly_guard) |

---

## DB MCP 연동 (선택 — NETWORK=open)

DB MCP는 SCH(스키마) 생성 시 **실DB에서 타입·FK·인덱스를 권위 조회**하는 데 쓰입니다. 두 가지 방식:

### 방식 A — 프로젝트별 (`/sl-init`이 자동)
`NETWORK=open`으로 `/sl-init` 실행 시, 프로젝트 루트에 `.mcp.json`을 생성하고 DB 접속정보를 입력받습니다.
그 프로젝트에서만 동작합니다.

### 방식 B — 전역 (모든 프로젝트, 한 번만) ★권장(회사 DB 고정 시)
**Claude Code 밖 일반 터미널**에서 (대화형 — 접속정보 1회 입력):
```bash
# Windows
python "%USERPROFILE%\.claude\plugins\cache\speclinker\speclinker\<버전>\mcp-servers\install.py" --global
# Mac/Linux
python ~/.claude/plugins/cache/speclinker/speclinker/<버전>/mcp-servers/install.py --global
```
→ 라이브러리 설치 + `claude mcp add --scope user`로 **사용자 스코프 등록** → 모든 프로젝트에서 사용.
확인: `claude mcp list` (scope: user). 이후 project.env엔 `MCP_DB_{별칭}=true`만 두면 됩니다.

> **DB 접속정보(creds)는 보안상 자동 설치 불가** — A/B 모두 1회 직접 입력합니다.
> `NETWORK=closed`(폐쇄망)면 MCP 없이 로컬 파일·소스만으로 전 기능 동작합니다(SCH 타입은 추론값).

> 비대화형 라이브러리만 설치: `install.py --yes` (등록은 안 함).

---

## 워크플로

### 운영 시스템 역생성 + AIDD
```
/sl-init        프로젝트 초기화 (소스 경로·네트워크·MCP)
/sl-recon       현행 소스 → INF(API)/SCH(DB) 스펙 역생성 (도메인 선택 가능)
/sl-recon-uis   화면 캡처 → UIS(화면설계서)  [Chrome CDP 9222]
/sl-recon-doc   FUNC/SRS/FUNC_MAP 생성
/sl-aidd        FUNC 단위 AIDD (story→승인→구현→QA→테스트)
/sl-test        테스트 케이스 작성·실행·결과보고서
```

### 변경관리 (SR 접수)
```
/sl-change <SR>         영향분석(CIA) → AS-IS → TO-BE → 구현 → 스펙동기화 → RTM
/sl-change --quick "…"  SR 없이 소규모 경량 변경
```

### SpecLens 웹 뷰어 + SR 업무 콘솔
```
/sl-viewer   대시보드·INF/SCH/UIS·연결그래프 + 📋SR 작업보드(지라 SR→AIDD) + 🔄개별 스펙 재생성
```
(SR 보드/재생성은 `--remote-debugging-port=9222` Chrome로 /sl-viewer 세션 연결 필요. SR 보드는 추가로 지라 MCP)

---

## 업데이트
```
/plugin update speclinker@speclinker
```

---

## 문제 해결

| 증상 | 원인 | 해결 |
|------|------|------|
| `/sl-init` 인식 안 됨 | 플러그인 미설치/재시작 안 함 | 설치 후 Claude Code 재시작 |
| `python3 not found` (Windows) | python3는 Store 스텁 | 정상 — 스킬은 `python` 사용. `python --version` 확인 |
| 소스 스캔 정밀도 낮음 | tree-sitter 빌드 도구 없음 | 정상(regex 폴백). 정밀화하려면 빌드툴 설치 후 재시작 |
| MCP 연결 실패 | creds 미입력/방화벽 | `.mcp.json` 또는 `install.py --global`로 접속정보 입력. 폐쇄망은 `NETWORK=closed` |
| Oracle 동시접속 끊김(DPY-4011) | 병렬 과다 | `SL_DISPATCH_PARALLEL=2` 설정 후 재실행(재접속 재시도 내장) |
| 토큰 과다 | 대량 INF/SCH 생성 | `SL_DISPATCH_MODEL=claude-haiku-4-5-20251001` (디스패처 전역) |
