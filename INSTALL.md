# Speclinker 설치 가이드

## 전제 조건

| 항목 | 최소 버전 | 확인 명령 |
|------|-----------|-----------|
| Node.js | 18+ | `node --version` |
| pnpm | 8+ | `pnpm --version` |
| Python | 3.8+ | `python3 --version` (또는 `python --version`) |
| Claude Code CLI | 최신 | `claude --version` |
| Git Bash (Windows) | 2.40+ | `bash --version` — `.sh` 스크립트 실행 시 필요 |

---

## 설치 방법

### 1. 플러그인 클론

```powershell
git clone https://github.com/your-org/gen-harness.git
cd gen-harness/plugins/speclinker
```

### 2. UA 코어 빌드

```powershell
cd ua
pnpm install
pnpm --filter @understand-anything/core build
cd ..
```

### 3. Claude Code에 플러그인 등록

```powershell
# installed_plugins.json에 수동 등록 (아직 마켓플레이스 미지원 시)
$PLUGIN_DIR = "$env:USERPROFILE\.claude\plugins\speclinker"
New-Item -ItemType Directory -Force $PLUGIN_DIR
Copy-Item -Recurse -Force . $PLUGIN_DIR
```

또는 심볼릭 링크 방식 (개발 중 권장):

```powershell
$PLUGIN_DIR = "$env:USERPROFILE\.claude\plugins\speclinker"
New-Item -ItemType SymbolicLink -Path $PLUGIN_DIR -Target (Get-Location).Path
```

### 4. installed_plugins.json 업데이트

`$env:USERPROFILE\.claude\plugins\installed_plugins.json`의 `plugins` 객체에 추가:

```json
"speclinker@local": [
  {
    "scope": "user",
    "installPath": "C:\\Users\\<유저명>\\.claude\\plugins\\speclinker",
    "version": "2.28.0",
    "installedAt": "<오늘날짜>T00:00:00.000Z"
  }
]
```

---

## 첫 실행 체크리스트

- [ ] `node --version` → 18 이상 확인
- [ ] `pnpm --version` → 설치됨 확인
- [ ] `python3 --version` 또는 `python --version` → 3.8 이상 확인
- [ ] `ua/packages/core/dist/index.js` 파일 존재 확인 (UA 코어 빌드 완료)
- [ ] Claude Code에서 `/sl-init` 실행 시 스킬 목록에 표시되는지 확인
- [ ] 프로젝트 루트에서 `/sl-init` → `project.env` 생성 확인
- [ ] `.\run-dashboard.ps1` 실행 → 브라우저에서 대시보드 열림 확인

---

## MCP 연동 (NETWORK=open)

1. `templates/.mcp.json.example`을 프로젝트 루트에 `.mcp.json`으로 복사
2. `<PLUGIN_PATH>`, DB 자격증명, Jira/GitHub 토큰 값 채우기
3. Python 의존성 설치:

```powershell
pip install -r <PLUGIN_PATH>/mcp-servers/requirements.txt
```

또는:

```powershell
& (Get-Command python3 -ErrorAction SilentlyContinue).Source ?? "python" -m pip install -r mcp-servers/requirements.txt
```

---

## 문제 해결

| 증상 | 원인 | 해결 |
|------|------|------|
| `/sl-init` 스킬을 찾을 수 없음 | installed_plugins.json 미등록 | Step 3~4 재실행 |
| `UA core 빌드 실패` | pnpm install 미실행 | `cd ua && pnpm install && pnpm --filter @understand-anything/core build` |
| `GRAPH_DIR not set` 경고 | run-dashboard.ps1 대신 직접 `pnpm dev` 실행 | `.\run-dashboard.ps1` 사용 |
| `python not found` | Python 미설치 또는 PATH 누락 | Python 3 설치 후 PATH 추가 |
| `.sh` 스크립트 실행 안 됨 (Windows) | Git Bash 미설치 | [Git for Windows](https://git-scm.com/downloads) 설치 |
| `PLUGIN_PATH` 감지 실패 | 레지스트리 키 형식 비표준 | project.env에 `PLUGIN_PATH=<절대경로>` 수동 입력 |
