# Speclinker 설치 및 세팅 가이드

> 버전: v2.48.0 기준

---

## 전제 조건 (설치 전 확인)

| 항목 | 최소 버전 | 확인 명령 |
|------|---------|----------|
| Claude Code CLI | 최신 | `claude --version` |
| Node.js | 18+ | `node --version` |
| pnpm | 8+ | `pnpm --version` |
| Python | 3.10+ | `python --version` |

> pnpm 없으면: `npm install -g pnpm`

---

## STEP 1 — 플러그인 설치

### 1-1. 마켓플레이스 등록 (최초 1회)

```
/plugin marketplace add DreamyDreamss/speclinker
```

### 1-2. 설치

```
/plugin install speclinker@speclinker
```

설치 완료 시 Claude Code가 자동으로 `SessionStart` 훅을 실행합니다.  
훅은 `ua/packages/core`를 빌드하고 아래 경로에 fingerprint를 저장합니다:

```
~/.claude/plugins/data/speclinker/ua-package.json
```

**빌드 성공 로그 확인:**
```
[speclinker] UA 코어 빌드 완료
```

빌드가 실패하면 아래 명령을 터미널에서 직접 실행합니다:

```bash
# Windows PowerShell
cd "$env:USERPROFILE\.claude\plugins\speclinker\ua"
pnpm install
pnpm --filter @understand-anything/core build
```

---

## STEP 2 — MCP 런타임 패키지 설치 (NETWORK=open 인 경우만)

> **자동(v3.20.1+):** `project.env`에 `MCP_DB_oracle/db2/mariadb=true`가 있으면(=/sl-init이 기록),
> 다음 세션 시작 시 SessionStart 훅이 **선언된 DB의 드라이버 + 코어(mcp·sqlalchemy·pandas·python-dotenv)를 자동 설치**합니다.
> (DB 미사용 프로젝트엔 안 깔립니다. DB2 `ibm_db`는 IBM CLI Driver가 필요할 수 있어 실패 시 경고만.)
> **MCP 등록(.mcp.json)과 접속 creds는 보안상 수동**입니다(아래 STEP 4).

수동/일괄 설치가 필요하면 **Claude Code 밖 일반 터미널**에서:

```bash
# Windows PowerShell / cmd  (대화형)
python "%USERPROFILE%\.claude\plugins\speclinker\mcp-servers\install.py"
# 비대화형 한 방 설치 (필수 전부, DB2는 스킵)
python "%USERPROFILE%\.claude\plugins\speclinker\mcp-servers\install.py" --yes
```

```bash
# Mac / Linux
python3 ~/.claude/plugins/speclinker/mcp-servers/install.py        # 대화형
python3 ~/.claude/plugins/speclinker/mcp-servers/install.py --yes  # 비대화형
```

스크립트가 아래 패키지 설치 여부를 안내합니다:

| 패키지 | 용도 |
|--------|------|
| `mcp[cli]` + `fastmcp` | MCP 서버 프레임워크 |
| `sqlalchemy` | DB 엔진 |
| `pandas` | 쿼리 결과 변환 |
| `python-dotenv` | .env 로드 |
| `PyMySQL` | MariaDB/MySQL 드라이버 |
| `python-oracledb` | Oracle Thin 드라이버 |
| `ibm_db` | DB2 (IBM CLI Driver 별도 필요) |
| `uv` / `uvx` | mcp-atlassian (Jira/Wiki) 실행 |

> Playwright는 별도 설치 (STEP 5 참조)

---

## STEP 3 — 프로젝트 초기화 (`/sl-init`)

새 프로젝트를 분석할 **워크스페이스 디렉토리**로 이동 후 실행합니다.

```
cd C:\Projects\my-project-workspace
/sl-init
```

> 워크스페이스 = `project.env`, `docs/`, `_tmp/` 등 산출물이 생성될 곳.  
> 소스코드 디렉토리와 같아도 되고 달라도 됩니다.

### sl-init 진행 순서

```
Step 0    소스 경로 수집
           - 소스가 몇 곳인지 (예: web 1곳 / api 1곳 / batch 1곳)
           - 각 소스의 레이블(예: api)과 절대 경로 입력
           - 경로 유효성 즉시 확인 (없으면 재입력)

Step 1    네트워크 환경 선택
           1) open   — 사내망/인터넷 (DB·Jira·Wiki MCP 활성화)
           2) closed — 폐쇄망 (로컬 파일만)

Step 2    project.env 자동 생성
           MODE / NETWORK / PLUGIN_PATH / SOURCE_* 기록

Step 2-B  화면 캡처 설정 (RECON 모드)
           1) 예 → PREVIEW_BASE_URL 입력 (나중에 로그인 1회 필요)
           2) 아니오 → 나중에 직접 수정

Step 3    docs/ 디렉토리 구조 생성

Step 3-A  UA 코어 빌드 상태 확인 (빌드 시도 안 함 — SessionStart가 처리)

Step 3-B  run-dashboard.ps1 / run-dashboard.sh 생성

Step 4    MCP 연동 설정 (NETWORK=open 시만)
           - 4-0: 패키지 설치 상태 스캔 (미설치 시 직접 실행 명령 안내)
           - 4-1: DB 연결 수 및 종류/별칭 수집
           - 4-2: Jira / Wiki 연결 여부 수집
           - 4-3: .mcp.json 생성 (플레이스홀더 — 사용자가 직접 자격증명 채움)
           - 4-4: project.env에 MCP_* 플래그 추가
           - 4-5: .gitignore에 .mcp.json 추가

Step 5    RTM_v1.0.md 초기화

Step 6    다음 단계 안내 출력
```

---

## STEP 4 — MCP 자격증명 입력

`/sl-init` 완료 후 워크스페이스 루트에 `.mcp.json`이 생성되어 있습니다.  
플레이스홀더를 실제 값으로 교체합니다.

```json
{
  "mcpServers": {
    "db-main": {
      "env": {
        "DB2_HOST": "여기에_main_DB_호스트_IP_입력",   ← 실제 IP로 교체
        "DB2_USER": "여기에_아이디_입력",
        "DB2_PASSWORD": "여기에_비밀번호_입력"
      }
    },
    "atlassian": {
      "env": {
        "JIRA_URL": "https://여기에_온프레미스_지라_주소_입력",
        "JIRA_API_TOKEN": "여기에_지라_PAT_입력"
      }
    }
  }
}
```

> ⚠️ `.mcp.json`은 `.gitignore`에 자동 추가됨 — 절대 커밋 금지

**수정 후 Claude Code 재시작** → MCP 자동 활성화

---

## STEP 5 — Playwright 설치 (화면 캡처 사용 시만)

화면 자동 캡처(`PREVIEW_BASE_URL` 설정)를 쓸 경우에만 필요합니다.

```bash
# 워크스페이스에서 실행
npm install --save-dev playwright
npx playwright install chromium
```

설치 후 storageState(로그인 세션) 저장 — 최초 1회:

```bash
# Windows
node "%USERPROFILE%\.claude\plugins\speclinker\scripts\runtime_capture.js" --bootstrap "."

# Mac / Linux
node ~/.claude/plugins/speclinker/scripts/runtime_capture.js --bootstrap .
```

Chrome 창이 열리면:
1. 로그인 (2FA·SSO 포함)
2. 메인 화면 확인
3. 터미널에서 Enter

→ `.preview-storage.json` 저장 완료. 이후 캡처는 자동화됩니다.

---

## STEP 6 — 실행

### RECON 모드 (기존 코드 역분석)

```
/sl-recon
```

3개 Phase로 순서대로 실행:

```
/sl-recon       (소스 스캔, 도메인 확정)
/sl-recon-inf   (INF·BAT 명세 생성)
/sl-recon-sch   (DB 스키마 SCH 생성)
/sl-recon-uis   (화면 캡처, UIS 설계서)
/sl-recon-doc   (FUNC/SRS/RTM/IA 생성)
```

---

## STEP 7 — 대시보드 실행 (선택)

```powershell
# Windows PowerShell
.\run-dashboard.ps1

# Mac / Linux / Git Bash
bash run-dashboard.sh
```

브라우저에서 `http://localhost:5173` 접속 → 코드 구조·도메인·IA 맵 시각화

---

## 생성 파일 요약

### 플러그인 설치 시 (`~/.claude/plugins/data/speclinker/`)

| 파일 | 생성 시점 | 역할 |
|------|---------|------|
| `ua-package.json` | SessionStart 훅 | UA core 빌드 fingerprint |

### `/sl-init` 실행 시 (워크스페이스 루트)

| 파일 | 역할 |
|------|------|
| `project.env` | 모드·경로·MCP 플래그 환경 설정 |
| `.mcp.json` | MCP 서버 연결 설정 (자격증명 플레이스홀더) |
| `.gitignore` | .mcp.json 항목 자동 추가 |
| `run-dashboard.ps1` | Windows 대시보드 실행 스크립트 |
| `run-dashboard.sh` | Mac/Linux 대시보드 실행 스크립트 |
| `README_DIRS.md` | 폴더 구조 설명 |
| `docs/02_추적표/RTM_v1.0.md` | 빈 추적 매트릭스 |
| `docs/` 하위 전체 디렉토리 | 산출물 디렉토리 구조 |

---

## 자주 발생하는 문제

### UA 코어 빌드 실패
```
[speclinker] UA 코어 빌드 실패: ...
```
→ Claude Code 재시작. 그래도 실패하면:
```bash
cd ~/.claude/plugins/speclinker/ua
pnpm install
pnpm --filter @understand-anything/core build
```

### MCP 연결 실패 (`/sl-recon` STEP 0에서 확인)
```
✘ MCP_DB_MAIN — 연결 실패
```
1. `.mcp.json` 플레이스홀더 채웠는지 확인
2. Claude Code 재시작
3. DB 호스트/포트 방화벽 확인
4. DB2: IBM CLI Driver 경로(`DB2_CLIDRIVER_PATH`) 확인

### Oracle 동시접속 간헐 종료 (DPY-4011 등)
`/sl-recon` SCH enrichment가 서브프로세스 병렬(기본 3)로 각자 Oracle MCP에 접속할 때 간헐적 연결종료가 날 수 있다.
- MCP `_query`에 **재접속 재시도(2회)가 내장**되어 일시적 종료는 자동 복구된다.
- 그래도 잦으면 병렬도를 낮춘다: 실행 전 `SL_DISPATCH_PARALLEL=2`(또는 1) 설정.
  ```bash
  # Windows PowerShell
  $env:SL_DISPATCH_PARALLEL = "2"
  ```
- Oracle 세션 한도(`sessions`/`processes`)도 함께 확인.

### PLUGIN_PATH가 잘못 감지됨
`project.env`의 `PLUGIN_PATH`를 직접 수정합니다:
```
PLUGIN_PATH=C:/Users/{사용자}/.claude/plugins/speclinker
```
(백슬래시 대신 슬래시 사용)

### `installed_plugins.json` 없음
플러그인이 설치되지 않은 경우. `STEP 1`부터 다시 진행합니다.

### Playwright 캡처 실패 (로그인 만료)
```
만료 감지 — bootstrap 재실행 안내
```
→ storageState 재저장:
```bash
node "%USERPROFILE%\.claude\plugins\speclinker\scripts\runtime_capture.js" --bootstrap "."
```

---

## POC 모드 (빠른 반복 개발용)

전체 소스를 매번 다시 분석하지 않고 특정 화면만 빠르게 처리할 때 사용합니다.  
`project.env`에 아래를 설정합니다:

```ini
POC_MODE=true
POC_SCREENS=ProductRegForm,OrderList     # 처리할 화면명 (쉼표 구분)
POC_SKIP_UA=true                         # 기존 knowledge-graph 재사용
```

| 옵션 | 역할 |
|------|------|
| `POC_SCREENS` | 지정 화면이 호출하는 INF/UIS/SCH만 슬라이스 |
| `POC_DOMAINS` | 도메인 단위 필터 (예: `order,product`) |
| `POC_FILE_LIMIT` | 도메인당 컨트롤러 파일 수 제한 |
| `POC_SKIP_UA` | UA 분석 스킵 (기존 그래프 재사용) |

전체 실행으로 복원:
```ini
POC_MODE=false
```
