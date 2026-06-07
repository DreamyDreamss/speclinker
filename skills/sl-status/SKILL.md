---
name: sl-status
description: 추적·현황 단일 명령 — FUNC 커버리지·갭(구 sl-rtm) + 진행상태·추천(구 sl-sprint) 통합. sprint-status.yaml 생성/갱신 내장.
triggers:
  - /sl-status
---

# /sl-status — 추적·진행 현황 통합

FUNC_MAP + sprint-status.yaml을 한 뷰로. 구 `sl-rtm`(커버리지·갭·게시) + `sl-sprint`(진행·추천)를 흡수했다.

## 호출 형식

| 형식 | 용도 |
|------|------|
| `/sl-status` | 통합 대시보드 — 커버리지 + 진행상태 + 갭 요약 |
| `/sl-status --coverage` | FUNC 커버리지 재계산 + 미연결 갭 리포트 (구 sl-rtm --func/--gap) |
| `/sl-status --next` | 다음 구현 FUNC 추천 (구 sl-sprint --next) |
| `/sl-status --publish` | Confluence 게시 (구 sl-rtm --publish, NETWORK=open) |

## STEP 0 — 전제 확인

```python
!python -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
import os
print('FUNC_MAP:', '존재' if os.path.exists('docs/00_FUNC/FUNC_MAP.md') else '없음 → /sl-recon-doc 먼저 실행')
"
```
FUNC_MAP 없으면 중단하고 `/sl-recon-doc` 안내.

## STEP 1 — sprint-status.yaml 생성/갱신 (선행)

FUNC_MAP을 파싱해 `.speclinker/sprint-status.yaml`을 생성/갱신한다.
- FUNC-ID/도메인/UIS/INF 추출.
- 기존 파일이 있으면 상태 보존(done/review/in-progress는 backlog으로 되돌리지 않음), 신규 FUNC만 `backlog` 추가, 제거된 FUNC는 삭제.
- `skills/sl-status/sprint-status-template.yaml` 기반으로 Write.

```bash
!grep -E "^\| FUNC-" docs/00_FUNC/FUNC_MAP.md 2>/dev/null
!cat .speclinker/sprint-status.yaml 2>/dev/null
!mkdir -p .speclinker
!cat docs/project-context.md 2>/dev/null | grep "프레임워크" | head -1
```

## STEP 2 — 분기

### (무플래그) 통합 대시보드

커버리지 + 상태별 카운트 + 갭 요약을 한 번에 출력.

```python
!python -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
import os, json, re
func_map = 'docs/00_FUNC/FUNC_MAP.md'
content = open(func_map, encoding='utf-8').read()
func_ids = set(re.findall(r'FUNC-[\w]+-\d+', content))
cache_path = '.understand-anything/linked-func-cache.json'
linked = set()
if os.path.exists(cache_path):
    for ids in json.load(open(cache_path, encoding='utf-8')).values():
        linked.update(ids)
covered = func_ids & linked
pct = int(len(covered)/len(func_ids)*100) if func_ids else 0
print(f'FUNC 커버리지: {len(covered)}/{len(func_ids)} ({pct}%)')
print(f'미연결 갭: {len(func_ids - linked)}건')
"
!cat .speclinker/sprint-status.yaml 2>/dev/null
```
`.speclinker/sprint-status.yaml`의 상태별(backlog/ready-for-dev/in-progress/review/done) 건수와 도메인별 진척을 집계해 대시보드로 출력:
```
══════════════════════════════════
개발 진행 현황 — {PROJECT_NAME}
FUNC 커버리지: {covered}/{total} ({%})   미연결 갭: {N}건
──────────────────────────────────
✅ done {n} | 🔍 review {n} | 🔨 in-progress {n} | 📋 ready-for-dev {n} | 📦 backlog {n}
도메인별: {domain}: done {N}/{전체} ({%})
══════════════════════════════════
```

### --coverage (구 sl-rtm --func + --gap)

```python
!python -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
import os, json, re
cache_path = '.understand-anything/linked-func-cache.json'
func_map_path = 'docs/00_FUNC/FUNC_MAP.md'
content = open(func_map_path, encoding='utf-8').read()
func_ids = set(re.findall(r'FUNC-[\w]+-\d+', content))
linked = set()
if os.path.exists(cache_path):
    for ids in json.load(open(cache_path, encoding='utf-8')).values():
        linked.update(ids)
covered   = func_ids & linked
uncovered = sorted(func_ids - linked)
print(f'전체 FUNC-ID: {len(func_ids)}개')
print(f'구현 완료:    {len(covered)}개 ({int(len(covered)/len(func_ids)*100) if func_ids else 0}%)')
print(f'미구현/미연결: {len(uncovered)}개')
for fid in uncovered:
    print(f'  - {fid}')
"
```
또한 linked_func 스캔으로 커버리지를 재계산하려면 `req_scan.py`(PLUGIN_PATH/scripts)를 실행한다.

### --next (구 sl-sprint --next)

`.speclinker/sprint-status.yaml`의 `ready-for-dev` 중 추천:
1. 가장 많은 INF 연결(핵심 우선) 2. in-progress→backlog 재개건 3. 없으면 backlog 상단.
```
다음 구현 추천: {FUNC-ID} — {기능명}
  연결 INF: {INF-ID 목록} / 연결 UIS: {UIS-ID} / 이유: {추천 이유}
시작하려면: /sl-aidd {FUNC-ID}
```

### --publish (구 sl-rtm --publish)

```python
!python -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8') if '=' in l and not l.startswith('#'))
print('NETWORK=' + env.get('NETWORK','closed'))
"
```
`NETWORK=open`이면 Confluence MCP로 RTM/FUNC_MAP 게시. `closed`면 파일 경로 + 수동 업로드 안내.
