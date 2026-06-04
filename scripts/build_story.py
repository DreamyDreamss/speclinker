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
