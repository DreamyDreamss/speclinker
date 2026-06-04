# B2 — AIDD story 루프 (BMAD 차용) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/sl-aidd`를 BMAD story-driven + QA gate 루프로 재구성하고, `sl-dev`·`sl-check`·`sl-review` 스킬을 흡수, 전용 `qa-agent`와 FUNC별 story 파일을 도입한다.

**Architecture:** FUNC = story. `build_story.py`(func_context_bundle 재사용)가 `docs/00_FUNC/stories/STORY-{FUNC-ID}.md`를 생성. `/sl-aidd`는 선택된 각 FUNC에 대해 [story 생성 → ✋사람 승인 → dev-agent → qa-agent(독립 컨텍스트 게이트) → test-agent → ✋사람 확인 → 상태갱신]을 순차 실행. dev/test 에이전트는 재사용, qa-agent만 신규.

**Tech Stack:** Python 3 (stdlib only), Claude Code 스킬(SKILL.md)·서브에이전트(agents/*.md), Docsify 뷰어(JS), plugin.json.

**상위 설계서:** `docs/superpowers/specs/2026-06-04-b2-aidd-story-loop-design.md`

**불변식 (절대 보존):**
- RECON 파이프라인(sl-init/recon/recon-uis/recon-doc)·공유 에이전트(spec/rd/srs/sad/ddd-*/rtm) 무영향.
- 추적 축 = FUNC-ID. story-id는 FUNC-id에 1:1 종속.
- 플러그인 런타임 스크립트 호출은 기존 컨벤션대로 `!python3 -c` 유지(개발 머신 검증 명령만 `python` 사용 — 이 머신의 python3는 깨진 MS Store 스텁).

**제거 대상 (B2 범위):** `skills/sl-dev/`, `skills/sl-check/`, `skills/sl-review/`.
**비범위:** B1(sl-change 통합)·B3(sl-status). 따라서 sl-plan/analyze/quick/rtm/sprint 스킬 자체는 이번에 **삭제하지 않는다** — 단 이들이 가진 `다음: /sl-dev` 포인터만 `/sl-aidd`로 교정한다.

---

## 파일 구조 (생성/수정 맵)

| 파일 | 책임 | 액션 |
|------|------|------|
| `scripts/func_context_bundle.py` | FUNC→스펙 번들(데이터 레이어) | 수정(mode 버그 제거) |
| `scripts/build_story.py` | FUNC→story 마크다운 생성 | **생성** |
| `scripts/tests/test_build_story.py` | build_story 단위 검증 | **생성** |
| `agents/qa-agent.md` | 독립 컨텍스트 QA 게이트 페르소나 | **생성** |
| `agents/dev-agent.md` | 코드 생성(재사용) | 수정(호출처/mode 참조 교정) |
| `agents/test-agent.md` | 테스트(재사용) | 수정(호출처 문구만) |
| `skills/sl-aidd/SKILL.md` | story 루프 오케스트레이터 | 전면 재작성 |
| `skills/sl-dev/`,`skills/sl-check/`,`skills/sl-review/` | (흡수됨) | **삭제** |
| `.claude-plugin/plugin.json` | 스킬/에이전트 등록·버전 | 수정 |
| `CLAUDE.md` | 라우팅·서브에이전트표·파이프라인·버전노트 | 수정 |
| `README.md` | 스킬 트리·파이프라인 | 수정 |
| `scripts/README.md` | 스크립트 목록 | 수정 |
| `docs/viewer/docsify-sl.js` | SpecLens 가이드(파이프라인·카테고리) | 수정 |
| 다음-포인터 보유 스킬(sl-recon-doc/change/context/quick/sprint) | `다음:/sl-dev`→`/sl-aidd` | 수정 |

---

## Task 1: func_context_bundle.py 잠복 버그 수정 (mode 미정의 참조)

`make_bundle()`가 A 리팩토링에서 제거된 `mode` 변수를 line 217에서 아직 참조 → `NameError`. build_story가 이 함수를 재사용하므로 선결.

**Files:**
- Modify: `scripts/func_context_bundle.py:217`
- Test: `scripts/tests/test_build_story.py` (Task 2에서 작성하며 이 수정도 함께 커버)

- [ ] **Step 1: mode 참조 제거**

`make_bundle`의 반환 dict에서 `'mode': mode,` 줄을 삭제한다.

`scripts/func_context_bundle.py` 의 다음 블록:

```python
    return {
        'func_id'     : func_id,
        'description' : entry['description'],
        'mode'        : mode,
        'status'      : entry['status'],
```

을 다음으로 바꾼다:

```python
    return {
        'func_id'     : func_id,
        'description' : entry['description'],
        'status'      : entry['status'],
```

- [ ] **Step 2: 수동 스모크 — 임시 픽스처로 NameError 미발생 확인**

Task 2의 테스트가 정식 검증이지만, 즉시 회귀 확인을 위해 임시로 실행:

Run (PowerShell):
```
$env:PYTHONUTF8=1; python scripts\func_context_bundle.py --list .
```
Expected: `FUNC_MAP.md 없음` JSON 또는 FUNC 목록(현재 디렉토리에 FUNC_MAP 없으면 error JSON) — 어느 쪽이든 **NameError 트레이스백이 없어야** 통과. (mode 버그는 단일 FUNC 번들 경로에서만 터지므로 Task 2 픽스처 테스트가 본 검증.)

- [ ] **Step 3: 커밋**

```
git add scripts/func_context_bundle.py
git commit -m "fix: remove undefined mode reference in func_context_bundle make_bundle"
```

---

## Task 2: build_story.py 생성 (FUNC → STORY 마크다운)

func_context_bundle을 재사용해 story 파일을 만든다. 데이터 수집은 번들에 위임, build_story는 마크다운 렌더 + 파일 쓰기만 담당.

**Files:**
- Create: `scripts/build_story.py`
- Create: `scripts/tests/test_build_story.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`scripts/tests/test_build_story.py` 생성 (stdlib only, pytest 불필요 — `python`으로 직접 실행):

```python
#!/usr/bin/env python3
"""build_story.py 단위 검증 — 합성 픽스처로 story 생성 확인."""
import os, sys, json, subprocess, tempfile, shutil

SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def make_fixture(root):
    os.makedirs(os.path.join(root, 'docs/00_FUNC'), exist_ok=True)
    os.makedirs(os.path.join(root, 'docs/05_설계서/order/INF'), exist_ok=True)
    with open(os.path.join(root, 'project.env'), 'w', encoding='utf-8') as f:
        f.write('PLUGIN_PATH=' + SCRIPTS.replace('\\', '/').rsplit('/scripts', 1)[0] + '\n')
    with open(os.path.join(root, 'docs/00_FUNC/FUNC_MAP.md'), 'w', encoding='utf-8') as f:
        f.write(
            '# FUNC_MAP\n\n'
            '## FUNC-order-001 — 주문 목록 조회\n'
            '- **INF**: INF-ORD-001\n'
            '- **SCH**: SCH-ORD-001\n'
            '- **UIS**: UIS-ORD-001\n'
            '구현상태: ⬜ 미구현\n'
        )
    with open(os.path.join(root, 'docs/05_설계서/order/INF/INF-ORD-001.md'), 'w', encoding='utf-8') as f:
        f.write('# INF-ORD-001 — 주문 목록 조회\n\nPOST /api/order/list\n\n## 비즈니스 규칙\n- 페이징 필수\n')

def run():
    tmp = tempfile.mkdtemp()
    try:
        make_fixture(tmp)
        env = dict(os.environ, PYTHONUTF8='1')
        r = subprocess.run(
            [sys.executable, os.path.join(SCRIPTS, 'build_story.py'), 'FUNC-order-001', tmp],
            capture_output=True, text=True, env=env)
        assert r.returncode == 0, f'exit {r.returncode}: {r.stderr}'
        out = json.loads(r.stdout)
        story_path = os.path.join(tmp, out['story_file'])
        assert os.path.exists(story_path), f'story 파일 없음: {story_path}'
        content = open(story_path, encoding='utf-8').read()
        assert 'story-id: STORY-FUNC-order-001' in content, 'story-id frontmatter 누락'
        assert 'func-id: FUNC-order-001' in content, 'func-id frontmatter 누락'
        assert 'status: Draft' in content, 'status Draft 누락'
        assert 'domain: order' in content, 'domain 누락'
        assert '## Story' in content
        assert '## 수용 기준' in content
        assert '## 컨텍스트' in content
        assert '## 구현 Task' in content
        assert '## Dev 기록' in content
        assert '## QA 결과' in content
        assert 'INF-ORD-001' in content, 'INF 컨텍스트 누락'
        print('PASS: test_build_story')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

if __name__ == '__main__':
    run()
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run (PowerShell):
```
$env:PYTHONUTF8=1; python scripts\tests\test_build_story.py
```
Expected: FAIL — `build_story.py` 가 아직 없어 `subprocess`가 비정상 종료(`exit ...: can't open file ... build_story.py`) → AssertionError.

- [ ] **Step 3: build_story.py 구현**

`scripts/build_story.py` 생성:

```python
# STATUS: 완료
#!/usr/bin/env python3
"""
build_story.py — FUNC-ID → BMAD story 마크다운 생성기

func_context_bundle.py를 재사용해 docs/00_FUNC/stories/STORY-{FUNC-ID}.md 를 만든다.
story 파일은 Dev가 다른 문서를 안 읽어도 구현 가능한 자기완결 컨텍스트를 담는다.

Usage:
  python3 build_story.py FUNC-order-001 [PROJECT_ROOT]
  python3 build_story.py --ready [PROJECT_ROOT]    # Ready FUNC 전체 story 생성

Output: stdout JSON
  단일: {"func_id":..., "story_file":"docs/00_FUNC/stories/STORY-FUNC-...md", "status":"Draft"}
  --ready: [{...}, ...]
"""
import sys, os, json, re, datetime

# 같은 scripts/ 디렉토리의 번들러 재사용
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import func_context_bundle as fcb

STORY_DIR = os.path.join('docs', '00_FUNC', 'stories')


def domain_of(func_id):
    m = re.match(r'FUNC-(.+)-\d+$', func_id)
    return m.group(1) if m else 'unknown'


def find_spec_paths(root, ids):
    """ID → 프로젝트 상대 파일경로 매핑 (있으면 링크용)."""
    paths = {}
    design_root = os.path.join(root, 'docs', '05_설계서')
    if not os.path.isdir(design_root):
        return paths
    want = set(ids)
    for dirpath, _, filenames in os.walk(design_root):
        for fname in filenames:
            if not fname.endswith('.md'):
                continue
            for _id in want:
                if _id in paths:
                    continue
                if _id in fname:
                    rel = os.path.relpath(os.path.join(dirpath, fname), root)
                    paths[_id] = rel.replace('\\', '/')
    return paths


def summarize(content, max_lines=4):
    """스펙 본문에서 제목 + 핵심 줄 몇 개를 요약 추출."""
    if not content:
        return ''
    lines = [l.strip() for l in content.splitlines()]
    # frontmatter 제거
    if lines and lines[0] == '---':
        try:
            end = lines.index('---', 1)
            lines = lines[end + 1:]
        except ValueError:
            pass
    picked = []
    for l in lines:
        if not l:
            continue
        # 제목/불릿/짧은 설명 위주
        if l.startswith('#') or l.startswith('-') or l.startswith('*') or len(l) < 120:
            picked.append(l.lstrip('# ').strip())
        if len(picked) >= max_lines:
            break
    return ' / '.join(p for p in picked if p)[:300]


def ctx_block(label, ids, content_map, path_map):
    """컨텍스트 섹션 한 종류(INF/SCH/UIS) 마크다운 라인 생성."""
    if not ids:
        return [f'- **{label}**: (연결 없음)']
    out = []
    for _id in ids:
        summary = summarize(content_map.get(_id, ''))
        path = path_map.get(_id)
        link = f' — [{path}]({os.path.relpath(path, STORY_DIR).replace(os.sep, "/")})' if path else ''
        head = f'- **{label}** {_id}'
        out.append(head + (f': {summary}' if summary else '') + link)
    return out


def build_story_md(bundle, func_id, root, today):
    entry_desc = bundle['description']
    domain = domain_of(func_id)
    ids = bundle['ids']
    sc = bundle['spec_content']
    path_map = find_spec_paths(root, ids['inf'] + ids['sch'] + ids['uis'])

    # 수용 기준: 연결 INF 명세 충족을 사실 기반 AC로
    acs = []
    for inf_id in ids['inf']:
        acs.append(f'- [ ] {inf_id} 명세대로 동작(요청/응답/비즈니스규칙 일치)')
    if not acs:
        acs.append('- [ ] 기능이 설명대로 동작')

    ctx_lines = []
    ctx_lines += ctx_block('INF', ids['inf'], sc.get('inf', {}), path_map)
    ctx_lines += ctx_block('SCH', ids['sch'], sc.get('sch', {}), path_map)
    ctx_lines += ctx_block('UIS', ids['uis'], sc.get('uis', {}), path_map)
    if os.path.exists(os.path.join(root, 'project-context.md')):
        ctx_lines.append('- **프로젝트 패턴**: project-context.md 참조(레이어·네이밍·프레임워크 관례)')
    impl = bundle.get('implemented_files', [])
    if impl:
        ctx_lines.append('- **기존 구현 파일**: ' + ', '.join(impl))

    md = f"""---
story-id: STORY-{func_id}
func-id: {func_id}
status: Draft
domain: {domain}
created: {today}
---

# STORY-{func_id} — {entry_desc}

## Story
{entry_desc}

## 수용 기준 (Acceptance Criteria)
{chr(10).join(acs)}

## 컨텍스트 (Dev Notes — 자기완결)
> Dev가 다른 문서를 안 읽어도 구현 가능하도록 전 컨텍스트를 담는다.
{chr(10).join(ctx_lines)}

## 구현 Task
- [ ] 컨트롤러/핸들러
- [ ] 서비스/비즈니스 로직
- [ ] 데이터 접근 레이어
- [ ] 단위 테스트

## Dev 기록
(dev-agent가 생성 파일·주요 결정 기록)

## QA 결과
(qa-agent가 gate 판정 기록 — PASS/CONCERNS/FAIL)
"""
    return md


def write_story(func_id, root, env, func_map, today):
    bundle = fcb.make_bundle(func_id, root, env, func_map)
    md = build_story_md(bundle, func_id, root, today)
    out_dir = os.path.join(root, STORY_DIR)
    os.makedirs(out_dir, exist_ok=True)
    rel = os.path.join(STORY_DIR, f'STORY-{func_id}.md').replace('\\', '/')
    with open(os.path.join(root, rel), 'w', encoding='utf-8') as f:
        f.write(md)
    return {'func_id': func_id, 'story_file': rel, 'status': 'Draft'}


def main():
    args = sys.argv[1:]
    if not args:
        print('Usage: build_story.py <FUNC-ID | --ready> [PROJECT_ROOT]', file=sys.stderr)
        sys.exit(1)

    cmd = args[0]
    root = args[1] if len(args) > 1 else '.'
    env = fcb.parse_project_env(root)
    func_map = fcb.parse_func_map(root)
    today = datetime.date.today().isoformat()

    if not func_map:
        print(json.dumps({'error': 'FUNC_MAP.md 없음 — /sl-recon 먼저 실행'}, ensure_ascii=False))
        sys.exit(1)

    if cmd == '--ready':
        cache = fcb.load_linked_func_cache(root)
        implemented = {i for ids in cache.values() for i in ids}
        ready = [e['id'] for e in func_map.values() if e['inf'] and e['id'] not in implemented]
        results = [write_story(fid, root, env, func_map, today) for fid in ready]
        print(json.dumps(results, ensure_ascii=False, indent=2))
        return

    func_id = cmd
    if func_id not in func_map:
        print(json.dumps({'error': f'{func_id} not found in FUNC_MAP'}, ensure_ascii=False))
        sys.exit(1)

    print(json.dumps(write_story(func_id, root, env, func_map, today),
                     ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run (PowerShell):
```
$env:PYTHONUTF8=1; python scripts\tests\test_build_story.py
```
Expected: `PASS: test_build_story`

- [ ] **Step 5: 커밋**

```
git add scripts/build_story.py scripts/tests/test_build_story.py
git commit -m "feat: add build_story.py — FUNC-ID to BMAD story markdown generator"
```

---

## Task 3: agents/qa-agent.md 생성 (독립 컨텍스트 QA 게이트)

dev-agent와 분리된 서브에이전트로, story+구현을 입력받아 3-Layer 검증 후 PASS/CONCERNS/FAIL gate를 story `## QA 결과`에 기록.

**Files:**
- Create: `agents/qa-agent.md`

- [ ] **Step 1: qa-agent.md 작성**

`agents/qa-agent.md` 생성:

```markdown
---
name: qa-agent
description: story 파일 + 구현 코드를 입력받아 3-Layer(스펙·보안·회귀) 검증 후 PASS/CONCERNS/FAIL 게이트를 판정하는 독립 컨텍스트 QA 서브에이전트. /sl-aidd 루프에서 dev-agent와 분리 호출됨.
model: claude-sonnet-4-6
---

# qa-agent — AIDD QA 게이트 (BMAD QA 페르소나)

## 역할

`/sl-aidd` 루프에서 dev-agent가 구현을 마친 직후, **dev와 분리된 독립 컨텍스트**로 호출되어
story의 수용 기준과 연결 INF 스펙을 기준으로 구현을 객관 검증하고 **gate 판정**을 내린다.
구현을 직접 수정하지 않는다 — 판정과 필수 수정 목록만 산출한다.

## 입력 (오케스트레이터가 전달)

- story 파일: `docs/00_FUNC/stories/STORY-{FUNC-ID}.md` (수용 기준 + 컨텍스트)
- 구현 산출물: dev-agent가 생성/수정한 파일 목록 + 내용(diff)
- 연결 INF 스펙 본문(요청/응답/비즈니스 규칙)

## 검증 — 3-Layer (구 sl-review 계승)

| Layer | 점검 | 판정 근거 |
|-------|------|----------|
| 1. 스펙 일치 | 구현이 INF 요청/응답/비즈니스 규칙과 일치하는가, story 수용 기준을 충족하는가 | 불일치/누락 AC = 차단 |
| 2. 보안 | 인증·인가 확인, 입력 검증, 주입(SQL/명령) 취약, 민감정보 노출 | 명백한 취약 = 차단 |
| 3. 회귀 | 기존 동작/시그니처 변경, 공유 자원 부작용, 다른 FUNC 영향 위험 | 회귀 위험 = 경고 이상 |

## 출력 — gate 판정

story `## QA 결과` 섹션에 아래 형식으로 **append**(기존 내용 보존, 회차 누적):

```markdown
### QA Gate — {YYYY-MM-DD} — {PASS | CONCERNS | FAIL}
- Layer1 스펙: {요약}
- Layer2 보안: {요약}
- Layer3 회귀: {요약}
- 필수 수정(FAIL시): 
  1. ...
- 권고(CONCERNS시): 
  1. ...
```

판정 기준:
- **PASS** — 3 Layer 모두 차단 이슈 없음. 다음 단계 진행.
- **CONCERNS** — 경미 이슈만 존재. 진행 가능하되 권고사항을 기록.
- **FAIL** — 차단 이슈 존재. 필수 수정 목록을 제시하고 story status를 InProgress로 회귀시키도록 오케스트레이터에 반환.

## 완료 보고 형식

```
## qa-agent 게이트 판정: {PASS | CONCERNS | FAIL}
- FUNC: {FUNC-ID}
- Layer1/2/3 요약: ...
- (FAIL) 필수 수정 N건 / (CONCERNS) 권고 M건
- story ## QA 결과 갱신 완료
```
```

- [ ] **Step 2: 검증 — 필수 요소 존재 확인**

Run (PowerShell):
```
Select-String -Path agents\qa-agent.md -Pattern 'model: claude-sonnet-4-6','PASS','CONCERNS','FAIL','3-Layer','독립' | Measure-Object | Select-Object Count
```
Expected: Count ≥ 5 (각 패턴 최소 1회 매칭).

- [ ] **Step 3: 커밋**

```
git add agents/qa-agent.md
git commit -m "feat: add qa-agent — context-separated 3-Layer QA gate for AIDD loop"
```

---

## Task 4: dev-agent.md / test-agent.md 호출처·mode 참조 교정

sl-dev 제거에 맞춰 두 에이전트의 "호출처" 문구와 제거된 `mode` 참조를 정리(동작은 보존, 재사용).

**Files:**
- Modify: `agents/dev-agent.md`
- Modify: `agents/test-agent.md`

- [ ] **Step 1: dev-agent.md frontmatter 호출처 교정**

`agents/dev-agent.md` frontmatter description 의 `/sl-dev 커맨드에서 호출됨.` 을
`/sl-aidd story 루프에서 서브에이전트로 호출됨.` 으로 바꾼다.

- [ ] **Step 2: test-agent.md frontmatter 호출처 교정**

`agents/test-agent.md` 를 읽고 frontmatter description에 `/sl-dev` 또는 `/sl-check`/`/sl-review` 참조가 있으면 `/sl-aidd 루프 / /sl-test` 로 교정한다. (없으면 변경 없음 — Step 4 grep으로 확인.)

- [ ] **Step 3: dev-agent.md 본문의 sl-dev 잔존 문구 교정**

`agents/dev-agent.md` 본문에서 "다음 단계: /sl-test" 등은 유지하되, 만약 `/sl-dev`를 진입점으로 안내하는 문구가 있으면 제거/교정한다. (grep로 확인 후 처리.)

- [ ] **Step 4: 검증 — 두 에이전트에 제거 스킬 참조 0**

Run (PowerShell):
```
Select-String -Path agents\dev-agent.md,agents\test-agent.md -Pattern 'sl-dev','sl-check','sl-review'
```
Expected: 출력 없음(매칭 0).

- [ ] **Step 5: 커밋**

```
git add agents/dev-agent.md agents/test-agent.md
git commit -m "refactor: retarget dev/test agent call-site refs from sl-dev to sl-aidd loop"
```

---

## Task 5: /sl-aidd SKILL.md 전면 재작성 (story 루프)

기존 sl-aidd를 BMAD story-driven + QA gate + 사람 승인 루프로 교체.

**Files:**
- Modify: `skills/sl-aidd/SKILL.md` (전면 교체)

- [ ] **Step 1: sl-aidd SKILL.md 작성**

`skills/sl-aidd/SKILL.md` 전체를 다음으로 교체:

````markdown
---
name: sl-aidd
description: FUNC = story 단위 BMAD AIDD 루프 — story 생성→사람 승인→dev-agent 구현→qa-agent 게이트→test-agent→사람 확인→상태갱신을 FUNC-ID 단위로 반복.
triggers:
  - /sl-aidd
---

# /sl-aidd — BMAD story 루프

FUNC를 story로 다루어, 각 FUNC에 대해 [story 생성 → ✋승인 → 구현 → QA 게이트 → 테스트 → ✋확인 → 상태갱신]을
순차 실행한다. 구 `sl-dev`(구현)·`sl-check`(착수 게이트)·`sl-review`(리뷰) 로직을 이 루프가 흡수했다.

## 호출 형식

| 형식 | 용도 |
|------|------|
| `/sl-aidd` | Ready 상태 FUNC 전체(INF 있고 코드 없음) |
| `/sl-aidd FUNC-order-001` | 특정 FUNC 하나 |
| `/sl-aidd --list` | FUNC 목록 + 상태 |
| `/sl-aidd --status` | 전체 커버리지 현황 |

## 사람 승인 지점 (BMAD 정석 — 자동 폭주 금지)

1. **story 승인** (STEP 2): story 요약을 사람에게 제시 → 승인해야 구현 착수.
2. **QA FAIL 처리** (STEP 4): 게이트 FAIL시 필수 수정 목록 제시 → 사람이 재작업/중단 결정.
3. **최종 확인** (STEP 6): QA/테스트 결과 사람 확인 → Done 전이.

---

## STEP 0 — 사전 확인

```python
!python3 -c "
import os, re
func_map = 'docs/00_FUNC/FUNC_MAP.md'
if os.path.exists(func_map):
    content = open(func_map, encoding='utf-8').read()
    func_ids = re.findall(r'## (FUNC-[\w-]+)', content)
    done = content.count('✅')
    print(f'FUNC_MAP: {len(func_ids)}개 FUNC, {done}개 완료')
else:
    print('FUNC_MAP 없음 → /sl-recon 먼저 실행하세요')
"
```

FUNC_MAP이 없으면 중단하고 `/sl-recon` 안내.

---

## STEP 1 — 대상 FUNC 결정

`/sl-aidd` (Ready 전체):

```python
!python3 -c "
import os, sys, subprocess, json
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8') if '=' in l and not l.startswith('#'))
plugin = env.get('PLUGIN_PATH','')
script = os.path.join(plugin, 'scripts', 'func_context_bundle.py')
r = subprocess.run([sys.executable, script, '--ready', '.'], capture_output=True, text=True)
ready = json.loads(r.stdout)
print(f'구현 예정 FUNC: {len(ready)}개')
for f in ready:
    print(f'  {f[\"id\"]}: {f[\"description\"]}')
"
```

대상이 10개를 초과하면 사용자에게 우선순위/배치를 확인 후 진행.
`/sl-aidd --list`는 STEP 1 대신 목록만 출력(맨 아래 참조).

---

## STEP 2~6 — FUNC(=story)별 순차 루프

선택된 각 FUNC에 대해 **순서대로** 아래를 반복한다.

### STEP 2 — SM: story 생성 + ✋승인

```python
!python3 -c "
import os, sys, subprocess, json
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8') if '=' in l and not l.startswith('#'))
plugin = env.get('PLUGIN_PATH','')
script = os.path.join(plugin, 'scripts', 'build_story.py')
func_id = '{FUNC_ID}'  # ← 현재 FUNC-ID
r = subprocess.run([sys.executable, script, func_id, '.'], capture_output=True, text=True)
print(r.stdout or r.stderr)
"
```

생성된 `docs/00_FUNC/stories/STORY-{FUNC_ID}.md`를 읽어 **Story·수용 기준·컨텍스트 요약**을 사용자에게 제시하고 승인을 받는다.

> 🟢 사용자 승인 게이트
> - 위 story로 구현을 진행할까요? (승인 / 수정요청 / 건너뛰기)
> - 승인 → story frontmatter `status: Draft` → `Approved` 로 갱신 후 STEP 3.
> - 수정요청 → 컨텍스트/수용기준 보완 후 재제시.
> - 건너뛰기/중단 → 이 FUNC 스킵.

### STEP 3 — Dev: dev-agent(서브) 구현

story를 컨텍스트로 dev-agent에 위임 (TDD). story status `Approved` → `InProgress` → (구현 완료) `Review`.

> dev-agent에게:
> - FUNC-ID: `{FUNC_ID}`
> - story 파일: `docs/00_FUNC/stories/STORY-{FUNC_ID}.md` (수용 기준 + 자기완결 컨텍스트 — INF/SCH/UIS 요약·링크 포함)
> - linked_func 주석(`linked_func: {FUNC_ID}`)을 모든 생성 파일에 삽입.
> - 이 FUNC에 해당하는 코드만 생성한다. 다른 FUNC는 건드리지 않는다.
> - 완료 후 story `## Dev 기록`에 생성/수정 파일과 주요 결정을 기록.

### STEP 4 — QA: qa-agent(서브) 게이트

dev와 **분리된 컨텍스트**로 qa-agent를 호출한다.

> qa-agent에게:
> - story 파일 + dev-agent 산출 파일 목록/내용 + 연결 INF 스펙 본문.
> - 3-Layer(스펙·보안·회귀) 검증 후 PASS/CONCERNS/FAIL 판정을 story `## QA 결과`에 append.

판정 처리:
- **PASS / CONCERNS** → STEP 5로.
- **FAIL** → 필수 수정 목록을 사용자에게 제시.
  > 🟠 QA FAIL 게이트 — 재작업할까요? (재작업 / 중단)
  > - 재작업 → story status `Review` → `InProgress`, 수정 목록을 dev-agent에 피드백하여 STEP 3 재실행.
  > - 중단 → 이 FUNC 보류(status 유지), 다음 FUNC로.

### STEP 5 — Test: test-agent(서브) TC 실행

> test-agent에게: 이 FUNC의 단위/통합 TC 작성·실행. 결과(통과/실패 수, 커버리지)를 story에 기록.

테스트 실패 시 STEP 4 FAIL과 동일하게 사용자 확인 후 재작업 또는 보류.

### STEP 6 — ✋최종 확인 + 상태갱신

> 🟢 최종 확인 게이트 — QA={판정}, 테스트={통과/실패}. 이 FUNC를 완료 처리할까요? (완료 / 보류)

완료 시:

```python
!python3 -c "
import os, sys, subprocess
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8') if '=' in l and not l.startswith('#'))
plugin = env.get('PLUGIN_PATH','')
script = os.path.join(plugin, 'scripts', 'req_scan.py')
if os.path.exists(script):
    r = subprocess.run([sys.executable, script, '.'], capture_output=True, text=True)
    print(r.stdout)
"
```

그리고:
- story frontmatter `status` → `Done`
- `docs/00_FUNC/FUNC_MAP.md` 해당 FUNC `구현상태: ✅ 완료`
- `→ 다음 FUNC로 반복`

---

## STEP 7 — 최종 커버리지 리포트

```python
!python3 -c "
import os, json, re
func_map = 'docs/00_FUNC/FUNC_MAP.md'
cache_path = '.understand-anything/linked-func-cache.json'
if not os.path.exists(func_map):
    print('FUNC_MAP 없음')
else:
    content = open(func_map, encoding='utf-8').read()
    func_ids = set(re.findall(r'## (FUNC-[\w-]+)', content))
    linked = set()
    if os.path.exists(cache_path):
        cache = json.load(open(cache_path, encoding='utf-8'))
        for ids in cache.values():
            linked.update(ids)
    covered = func_ids & linked
    pct = int(len(covered)/len(func_ids)*100) if func_ids else 0
    print(f'FUNC 커버리지: {len(covered)}/{len(func_ids)} ({pct}%)')
    uncovered = sorted(func_ids - linked)
    if uncovered:
        print(f'미구현 FUNC ({len(uncovered)}개): ' + ', '.join(uncovered))
    else:
        print('모든 FUNC 구현 완료 ✅')
"
```

---

## `/sl-aidd --list` — FUNC 목록

```python
!python3 -c "
import os, sys, subprocess, json
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8') if '=' in l and not l.startswith('#'))
plugin = env.get('PLUGIN_PATH','')
script = os.path.join(plugin, 'scripts', 'func_context_bundle.py')
r = subprocess.run([sys.executable, script, '--list', '.'], capture_output=True, text=True)
funcs = json.loads(r.stdout)
print(f'총 {len(funcs)}개 FUNC:')
for f in funcs:
    flag = '✅' if '완료' in f['status'] else '🔄' if '구현중' in f['status'] else '⬜'
    inf_mark = '📋' if f['has_inf'] else '  '
    print(f'  {flag} {inf_mark} {f[\"id\"]}: {f[\"description\"]}')
"
```

---

## 완료 안내

```
/sl-aidd 완료

구현된 FUNC: {N}개 (story Done)
QA 게이트: PASS {p} / CONCERNS {c} / FAIL {f}
테스트 통과: {M}개
FUNC 커버리지: {%}%

story: docs/00_FUNC/stories/
대시보드: SpecLens(/sl-viewer)에서 커버리지 확인
다음 단계: /sl-test --perf (성능) 또는 납품
```
````

- [ ] **Step 2: 검증 — 루프 구조·승인 게이트·제거 스킬 잔존 0**

Run (PowerShell):
```
Select-String -Path skills\sl-aidd\SKILL.md -Pattern 'build_story.py','qa-agent','승인 게이트','status: Draft','sl-dev','sl-check','sl-review'
```
Expected: `build_story.py`/`qa-agent`/`승인 게이트`/`status: Draft` 는 매칭, `sl-dev`/`sl-check`/`sl-review` 는 매칭 없음(흡수 매핑 설명에서 구 명칭을 본문에 남기지 않음 — 위 작성본은 "구 sl-dev/check/review 로직을 흡수했다" 한 줄만 포함하므로 그 줄만 매칭됨. 그 한 줄은 의도된 설명이므로 허용).

> 주: 위 한 줄(`구 sl-dev(구현)·sl-check(착수 게이트)·sl-review(리뷰) 로직을 이 루프가 흡수했다`)은 역사적 설명으로 허용. 라우팅·진입점으로서의 참조가 아니므로 grep 게이트(Task 9)에서 예외 처리.

- [ ] **Step 3: 커밋**

```
git add skills/sl-aidd/SKILL.md
git commit -m "feat: rebuild /sl-aidd as BMAD story loop (absorbs dev/check/review)"
```

---

## Task 6: sl-dev / sl-check / sl-review 스킬 삭제 + plugin.json 갱신

**Files:**
- Delete: `skills/sl-dev/`, `skills/sl-check/`, `skills/sl-review/`
- Modify: `.claude-plugin/plugin.json`

- [ ] **Step 1: 세 스킬 디렉토리 삭제**

```
git rm -r skills/sl-dev skills/sl-check skills/sl-review
```
(로컬 수정으로 거부되면 `git rm -rf`.)

- [ ] **Step 2: plugin.json — skills 3개 제거, agents에 qa-agent 추가, 버전 bump**

`.claude-plugin/plugin.json` 에서:
- `"version": "3.0.0"` → `"version": "3.1.0"`
- skills 배열에서 `"./skills/sl-dev"`, `"./skills/sl-check"`, `"./skills/sl-review"` 세 줄 삭제.
- agents 배열에 `"./agents/qa-agent.md"` 추가 (dev-agent.md 다음 줄 권장).

- [ ] **Step 3: 검증 — JSON 유효 + skills 16개 + qa-agent 등록**

Run (PowerShell):
```
$j = Get-Content .claude-plugin\plugin.json -Raw | ConvertFrom-Json
"version=$($j.version) skills=$($j.skills.Count) agents=$($j.agents.Count)"
"$($j.skills -join ',')" -match 'sl-dev|sl-check|sl-review'
"$($j.agents -join ',')" -match 'qa-agent'
```
Expected: `version=3.1.0 skills=16 agents=15`; 첫 -match `False`(제거 확인); 둘째 -match `True`(추가 확인).

- [ ] **Step 4: 커밋**

```
git add -A skills .claude-plugin/plugin.json
git commit -m "feat: remove sl-dev/check/review skills, register qa-agent, bump v3.1.0"
```

---

## Task 7: CLAUDE.md doc-sync

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: 라우팅표 — 제거 3행 삭제 + sl-aidd 행 갱신**

`CLAUDE.md` 커맨드 라우팅 규칙 표에서 다음 3행을 **삭제**:
```
| `/sl-dev` | `skills/sl-dev/SKILL.md` | docs/05_설계서/ 존재 | 전체 |
| `/sl-check <SR-ID\|FUNC-ID\|--all>` | `skills/sl-check/SKILL.md` | docs/05_설계서/ INF, .speclinker/ | SDD |
| `/sl-review <SR-ID\|FUNC-ID>` | `skills/sl-review/SKILL.md` | TO-BE INF, 소스코드, project-context.md | SDD |
```
그리고 `/sl-aidd [FUNC-ID]` 행 분류/설명을 story 루프로 명확화 — 표의 해당 행을 다음으로 교체:
```
| `/sl-aidd [FUNC-ID]` | `skills/sl-aidd/SKILL.md` | docs/00_FUNC/FUNC_MAP.md 존재 | AIDD (story 루프: 구현·QA·테스트 통합) |
```

- [ ] **Step 2: 서브에이전트 — 코드·테스트 에이전트 표에 qa-agent 추가**

`### 코드·테스트 에이전트` 표를 다음으로 교체:
```
| 태스크 | 서브에이전트 | 모델 | 이유 |
|--------|-----------|------|------|
| 코드 생성 | `agents/dev-agent.md` | Sonnet | 반복 실행 태스크 |
| QA 게이트 | `agents/qa-agent.md` | Sonnet | dev와 분리된 독립 컨텍스트 3-Layer 검증 |
| 테스트 | `agents/test-agent.md` | Sonnet | 반복 실행 태스크 |
```

- [ ] **Step 3: AIDD 핵심 루프 블록 갱신**

`### AIDD 핵심 루프 (sl-aidd 내부)` 코드블록을 다음으로 교체:
```
FUNC 선택 → build_story.py (STORY-{FUNC-ID}.md 생성, status=Draft)
         → ✋ 사람 승인 (Draft→Approved)
         → dev-agent (코드 생성, linked_func 주석, Approved→InProgress→Review)
         → qa-agent (독립 컨텍스트 3-Layer 게이트: PASS/CONCERNS/FAIL)
                    FAIL → 사람 확인 후 재작업(Review→InProgress)
         → test-agent (TC 실행)
         → ✋ 사람 최종 확인 → req_scan.py(커버리지) + FUNC_MAP ✅ + story=Done
         → 다음 FUNC 반복
```

- [ ] **Step 4: 상황별 파이프라인 표 — SDD 행 갱신, sl-dev 참조 제거**

`## 상황별 파이프라인` 표에서 `**SDD 전체 파이프라인**` 행을 다음으로 교체:
```
| **SDD 전체 파이프라인** | sl-recon → **sl-ia** → **sl-context** → sl-sprint → sl-plan → sl-analyze → sl-change → **sl-aidd** (story 승인→구현→QA→테스트) |
```
표 내 다른 `sl-dev` 등장(있으면)도 `sl-aidd`로 교정.

- [ ] **Step 5: 에러 처리 표 — sl-dev 안내 교정**

`## 에러 처리` 표의 `| 06_소스코드/ 없음 | \`/sl-dev\` 실행 안내 |` 행을
`| 06_소스코드/ 없음 | \`/sl-aidd\` 실행 안내 |` 로 교체.

- [ ] **Step 6: 버전 노트 추가**

서브에이전트 섹션 직후 버전 노트 블록 최상단에 한 줄 추가:
```
> **v3.1.0** (B2): `/sl-aidd`를 BMAD story 루프로 재구성 — sl-dev/sl-check/sl-review 스킬 흡수·삭제, `agents/qa-agent.md`(독립 컨텍스트 3-Layer 게이트) 신설, `scripts/build_story.py`(FUNC→STORY 마크다운) 신설, FUNC별 story 파일(docs/00_FUNC/stories/) + 상태머신(Draft→Approved→InProgress→Review→Done) + 사람 승인 3지점. dev/test 에이전트는 재사용(루프가 서브 호출). func_context_bundle mode 잔존버그 제거. 추적 축 FUNC-ID 불변.
```

- [ ] **Step 7: 검증 — CLAUDE.md 잔존·추가 확인**

Run (PowerShell):
```
Select-String -Path CLAUDE.md -Pattern 'skills/sl-dev/SKILL','skills/sl-check/SKILL','skills/sl-review/SKILL','qa-agent','build_story','v3.1.0'
```
Expected: `skills/sl-*/SKILL` 3종 매칭 없음; `qa-agent`/`build_story`/`v3.1.0` 매칭 있음.

- [ ] **Step 8: 커밋**

```
git add CLAUDE.md
git commit -m "docs: sync CLAUDE.md for B2 story loop (routing/subagents/pipeline/v3.1.0)"
```

---

## Task 8: README / scripts/README / docsify-sl.js + 다음-포인터 교정

**Files:**
- Modify: `README.md`
- Modify: `scripts/README.md`
- Modify: `docs/viewer/docsify-sl.js`
- Modify: `skills/sl-recon-doc/SKILL.md`, `skills/sl-change/SKILL.md`, `skills/sl-context/SKILL.md`, `skills/sl-quick/SKILL.md`, `skills/sl-sprint/SKILL.md` (다음-포인터만)

- [ ] **Step 1: README.md 스킬 트리·파이프라인 교정**

`README.md`에서:
- 스킬 트리의 `sl-dev … 코드·단위테스트 자동 생성` 행 삭제. sl-check/sl-review 행이 있으면 삭제.
- `sl-aidd` 트리 설명을 `FUNC=story 단위 AIDD 루프 (story→승인→구현→QA→테스트)` 로 갱신.
- 파이프라인 예시 블록에 `sl-dev`/`sl-check`/`sl-review`가 등장하면 `sl-aidd` 로 교정.

(정확한 행은 `Select-String -Path README.md -Pattern 'sl-dev|sl-check|sl-review'` 로 찾아 처리.)

- [ ] **Step 2: scripts/README.md 갱신**

`scripts/README.md`에서:
- `build_story.py` 항목 추가: `build_story.py — FUNC-ID → docs/00_FUNC/stories/STORY-{FUNC-ID}.md (func_context_bundle 재사용). /sl-aidd STEP 2에서 호출.`
- `sl-dev`/`sl-check`/`sl-review` 스킬을 가리키는 "사용 STEP" 문구가 있으면 `/sl-aidd` 로 교정.

- [ ] **Step 3: docsify-sl.js — GUIDE_PIPELINES SDD 체인 교정**

`docs/viewer/docsify-sl.js` 의 GUIDE_PIPELINES `SDD 전체 파이프라인` steps 를:
```
steps: ['sl-recon', 'sl-ia', 'sl-context', 'sl-plan', 'sl-check', 'sl-dev', 'sl-review'],
```
다음으로 교체:
```
steps: ['sl-recon', 'sl-ia', 'sl-context', 'sl-plan', 'sl-aidd'],
```

- [ ] **Step 4: docsify-sl.js — GUIDE_CATEGORIES 교정**

- `AIDD 자동개발` 카테고리의 sl-aidd 설명을 story 루프로 갱신:
```
['/sl-aidd [FUNC-ID]', 'FUNC=story 단위 AIDD 루프 (story→승인→구현→QA게이트→테스트→커버리지)', 'FUNC_MAP.md'],
```
- `SDD 파이프라인` 카테고리에서 `['/sl-check <ID>', ...]` 와 `['/sl-review <ID>', ...]` 두 줄 삭제.
- `개발 · 테스트 · 추적` 카테고리에서 `['/sl-dev', ...]` 줄 삭제.
- `GUIDE_VERSION = '2.53.0'` → `'3.1.0'`.

- [ ] **Step 5: 다음-포인터 교정 (5개 스킬)**

각 스킬에서 "다음 단계/다음 커맨드"로 `/sl-dev`(또는 sl-check/sl-review)를 안내하는 문구를 `/sl-aidd` 로 교정한다. 대상·발생 위치는 다음으로 확인:
```
Select-String -Path skills\sl-recon-doc\SKILL.md,skills\sl-change\SKILL.md,skills\sl-context\SKILL.md,skills\sl-quick\SKILL.md,skills\sl-sprint\SKILL.md -Pattern 'sl-dev|sl-check|sl-review'
```
각 매칭을 의미에 맞게 `/sl-aidd` 로 치환(진입점/다음-커맨드 안내인 경우). sl-quick/sl-sprint는 B3/B1에서 추후 제거 예정이나, 지금은 dangling 참조 제거를 위해 포인터만 교정.

- [ ] **Step 6: 검증 — 뷰어·README JSON/문법 무결**

Run (PowerShell):
```
node -e "require('fs').readFileSync('docs/viewer/docsify-sl.js','utf8'); console.log('js read ok')"
Select-String -Path docs\viewer\docsify-sl.js -Pattern 'sl-check','sl-review' -SimpleMatch
```
Expected: `js read ok`; docsify-sl.js 에 `sl-check`/`sl-review` 매칭 없음(sl-dev는 GUIDE_PIPELINES에서 제거됐는지 별도 확인).

- [ ] **Step 7: 커밋**

```
git add README.md scripts/README.md docs/viewer/docsify-sl.js skills/sl-recon-doc/SKILL.md skills/sl-change/SKILL.md skills/sl-context/SKILL.md skills/sl-quick/SKILL.md skills/sl-sprint/SKILL.md
git commit -m "docs: sync README/scripts-README/SpecLens guide + retarget next-pointers to sl-aidd"
```

---

## Task 9: 최종 무결성 게이트

전 범위에서 제거 스킬의 진입점/라우팅 잔존 0과 신규 산출물 등록을 확인.

**Files:** (검증 전용 — 코드 변경 없음, 발견 시 해당 Task로 복귀)

- [ ] **Step 1: 제거 스킬 잔존 참조 grep (허용 예외 제외)**

Run (PowerShell):
```
Select-String -Path skills\*\*.md,agents\*.md,scripts\*.py,scripts\*.md,docs\viewer\*.js,README.md,CLAUDE.md,templates\*.md -Pattern 'sl-dev|sl-check|sl-review'
```
Expected: 매칭은 **오직** 아래 허용 예외만 남아야 한다:
- `skills/sl-aidd/SKILL.md` 의 흡수 설명 1줄(`구 sl-dev(구현)·sl-check…흡수`).
- `CLAUDE.md` 버전 노트 내 역사적 서술(`sl-dev/sl-check/sl-review 스킬 흡수·삭제`)·과거 버전노트(v2.51 등).

그 외(라우팅표·진입점·`skills/sl-dev/SKILL.md` 파일경로·다음-커맨드 포인터·plugin.json) 잔존이 있으면 해당 Task로 돌아가 제거.

> 참고: `docs/superpowers/**`(설계서/플랜)와 `docs/plans/2026-06-03-sdd-extension.md`, `THIRD_PARTY_NOTICES.md` 는 역사 기록이므로 검사 대상에서 제외(위 경로 목록에 미포함).

- [ ] **Step 2: 삭제 디렉토리·신규 산출물 존재 확인**

Run (PowerShell):
```
"sl-dev exists: " + (Test-Path skills\sl-dev)
"sl-check exists: " + (Test-Path skills\sl-check)
"sl-review exists: " + (Test-Path skills\sl-review)
"qa-agent exists: " + (Test-Path agents\qa-agent.md)
"build_story exists: " + (Test-Path scripts\build_story.py)
```
Expected: 앞 3개 `False`, 뒤 2개 `True`.

- [ ] **Step 3: build_story 단위테스트 재실행 (회귀)**

Run (PowerShell):
```
$env:PYTHONUTF8=1; python scripts\tests\test_build_story.py
```
Expected: `PASS: test_build_story`

- [ ] **Step 4: plugin.json 정합 재확인**

Run (PowerShell):
```
$j = Get-Content .claude-plugin\plugin.json -Raw | ConvertFrom-Json
"version=$($j.version) skills=$($j.skills.Count) agents=$($j.agents.Count) qa=$(@($j.agents) -contains './agents/qa-agent.md')"
```
Expected: `version=3.1.0 skills=16 agents=15 qa=True`

- [ ] **Step 5: 완료 커밋 (잔존 정리분 있으면)**

```
git add -A
git commit -m "chore: B2 integrity gate — verify removals and new artifacts"
```

---

## 완료 정의 (DoD)

- [ ] sl-dev/sl-check/sl-review 스킬 디렉토리 삭제 + plugin.json skills 16개.
- [ ] agents/qa-agent.md 등록(agents 15개) — sonnet, 3-Layer, PASS/CONCERNS/FAIL.
- [ ] scripts/build_story.py + 단위테스트 PASS.
- [ ] /sl-aidd가 story 생성→✋승인→dev→qa→test→✋확인→상태갱신 루프.
- [ ] func_context_bundle mode 버그 제거.
- [ ] CLAUDE.md(라우팅·서브에이전트·AIDD루프·파이프라인·에러표·v3.1.0 노트), README, scripts/README, docsify-sl.js(파이프라인·카테고리·GUIDE_VERSION) 동기화.
- [ ] 다음-포인터 5개 스킬 교정.
- [ ] 무결성 grep 게이트: 허용 예외 외 잔존 0.
- [ ] RECON 파이프라인·공유 에이전트 무영향(이번 변경이 그 파일들을 건드리지 않음으로 보장).
