# Speclinker 설치 가이드

## 전제 조건

| 항목 | 최소 버전 | 확인 명령 |
|------|-----------|-----------|
| Node.js | 18+ | `node --version` |
| Python | 3.10+ | `python3 --version` (또는 `python --version`) |
| Claude Code CLI | 최신 | `claude --version` |
| Git Bash (Windows) | 2.40+ | `bash --version` — `.sh` 스크립트 실행 시 필요 |

---

## 설치 방법

### A. 마켓플레이스 설치 (권장)

Claude Code CLI에서:

```
/plugin marketplace add DreamyDreamss/speclinker
/plugin install speclinker@speclinker
```

설치 위치: `~/.claude/plugins/cache/speclinker/speclinker/<버전>/`

SessionStart 훅이 자동으로 npm 의존성(playwright-core, tree-sitter)을 확인합니다.

---

### B. 로컬 개발 설치 (gen-harness 레포 클론 후)

```powershell
git clone https://github.com/your-org/gen-harness.git
cd gen-harness
.\install.ps1
```

`install.ps1`이 하는 일:
1. `plugins\speclinker\` → `%USERPROFILE%\.claude\plugins\speclinker\` 복사 (node_modules 제외)
2. npm install (playwright-core, tree-sitter 등 런타임 의존성)
3. `installed_plugins.json`에 `speclinker@local` 등록
4. 설치 파일 무결성 검증

```
Install complete! 가 나오면 완료.
```

재설치 (덮어쓰기):
```powershell
.\install.ps1 -Force
```

---

## 첫 실행 체크리스트

- [ ] `node --version` → 18 이상 확인
- [ ] `python3 --version` 또는 `python --version` → 3.10 이상 확인
- [ ] Claude Code에서 `/sl-init` 실행 시 스킬 목록에 표시되는지 확인
- [ ] 프로젝트 루트에서 `/sl-init` → `project.env` 생성 확인

---

## MCP 연동 (NETWORK=open)

1. `templates/.mcp.json.example`을 프로젝트 루트에 `.mcp.json`으로 복사
2. `<PLUGIN_PATH>`, DB 자격증명, Jira/GitHub 토큰 값 채우기
3. Python 의존성 설치:

```powershell
pip install -r <PLUGIN_PATH>/mcp-servers/requirements.txt
```

---

## 문제 해결

| 증상 | 원인 | 해결 |
|------|------|------|
| `/sl-init` 스킬을 찾을 수 없음 | installed_plugins.json 미등록 | `.\install.ps1` 재실행 또는 마켓플레이스 재설치 |
| `GRAPH_DIR not set` 경고 | 환경 설정 미완료 | `project.env` 의 `PLUGIN_PATH` 확인 |
| `python not found` | Python 미설치 또는 PATH 누락 | Python 3.10+ 설치 후 PATH 추가 |
| `.sh` 스크립트 실행 안 됨 (Windows) | Git Bash 미설치 | [Git for Windows](https://git-scm.com/downloads) 설치 |
| `PLUGIN_PATH` 감지 실패 | installed_plugins.json 형식 비표준 | project.env에 `PLUGIN_PATH=<절대경로>` 수동 입력 |
