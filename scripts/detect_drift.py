# STATUS: 완료
#!/usr/bin/env python3
"""
detect_drift.py — 스펙 변경 감지 (zero-LLM). SpecLens "🔄 변경 점검" 버튼이 트리거.

각 INF/SCH/UIS 스펙의 frontmatter `anchors:`(근거 소스 file[:line])를 읽어,
앵커 소스 파일의 mtime이 스펙 .md 파일 mtime보다 최신이면 = 소스가 바뀌었는데 스펙 미갱신 → STALE.
(speclinker freshness 게이트와 동일 원칙: 소스가 1차 진실.) 소스 파일이 사라졌으면 MISSING.

출력: docs/viewer/drift.json  (SpecLens가 fetch 또는 세션이 CDP로 주입)
  { scanned_at, total, items:[ {id,type,domain,file,reason,sources[],spec_mtime,src_mtime} ] }

Usage: python detect_drift.py [workspace] [--out docs/viewer/drift.json]
"""
import os, sys, re, json, datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gen_docsify as gd  # frontmatter/anchor 파서 재사용

ANCHOR_KEYS = ('anchors',)

def _anchor_paths(fm_block):
    """frontmatter anchors 리스트에서 소스 파일 경로만 추출.
    형식 예: 'src/../X.java:42', 'src/../Mapper.xml (query)', 'a/b.sql'."""
    out = []
    for raw in gd._extract_list_field(fm_block, 'anchors'):
        s = str(raw).strip().strip('"\'')
        s = re.sub(r'\s*\(.*\)\s*$', '', s)      # ' (role)' 제거
        s = re.sub(r':\d+(?:-\d+)?\s*$', '', s)  # ':line' 제거
        s = s.strip()
        if s:
            out.append(s.replace('\\', '/'))
    return out

def _resolve(root, rel):
    """앵커 경로를 워크스페이스 기준 절대경로로. 절대경로면 그대로."""
    if os.path.isabs(rel):
        return rel
    return os.path.join(root, rel)

def _spec_files(root):
    """INF-*.md, SCH-*.md, UIS spec.md 를 (type, path)로 순회."""
    design = os.path.join(root, 'docs', '05_설계서')
    if not os.path.isdir(design):
        return
    for dirpath, _, fnames in os.walk(design):
        for fn in fnames:
            fp = os.path.join(dirpath, fn)
            if fn.startswith('INF-') and fn.endswith('.md'):
                yield 'INF', fp
            elif fn.startswith('SCH-') and fn.endswith('.md'):
                yield 'SCH', fp
            elif fn == 'spec.md' and (os.sep + 'UIS' + os.sep) in fp:
                yield 'UIS', fp

def detect(root):
    items = []
    for typ, fp in _spec_files(root):
        try:
            content = open(fp, encoding='utf-8', errors='replace').read()
        except OSError:
            continue
        fm_block = gd._get_fm_block(content)
        fm = gd.parse_frontmatter(content)
        sid = fm.get('inf-id') or fm.get('sch-id') or fm.get('UIS-ID') or os.path.basename(fp).replace('.md', '')
        domain = fm.get('domain') or ''
        anchors = _anchor_paths(fm_block)
        if not anchors:
            continue  # 앵커 없으면 비교 불가(미상) — 변경감지 대상 제외
        try:
            spec_mtime = os.path.getmtime(fp)
        except OSError:
            continue
        changed, missing, newest = [], [], spec_mtime
        for a in anchors:
            ap = _resolve(root, a)
            if not os.path.exists(ap):
                missing.append(a)
                continue
            try:
                m = os.path.getmtime(ap)
            except OSError:
                continue
            if m > spec_mtime + 1:   # 1초 여유(파일시스템 해상도)
                changed.append(a)
                newest = max(newest, m)
        if changed or missing:
            reason = []
            if changed:
                reason.append(f'소스 {len(changed)}개가 스펙보다 최신')
            if missing:
                reason.append(f'소스 {len(missing)}개 사라짐')
            items.append({
                'id': sid, 'type': typ, 'domain': domain,
                'file': os.path.relpath(fp, root).replace('\\', '/'),
                'reason': ' · '.join(reason),
                'sources': (changed + ['(삭제됨) ' + x for x in missing])[:6],
                'spec_mtime': datetime.datetime.fromtimestamp(spec_mtime).isoformat(timespec='seconds'),
                'src_mtime': datetime.datetime.fromtimestamp(newest).isoformat(timespec='seconds'),
            })
    items.sort(key=lambda x: (x['domain'], x['type'], x['id']))
    return {'scanned_at': datetime.datetime.now().isoformat(timespec='seconds'),
            'total': len(items), 'items': items}

def main():
    argv = sys.argv[1:]
    out = 'docs/viewer/drift.json'
    if '--out' in argv:
        i = argv.index('--out'); out = argv[i + 1]; argv = argv[:i] + argv[i + 2:]
    root = argv[0] if argv else '.'
    result = detect(root)
    os.makedirs(os.path.dirname(os.path.join(root, out)) or '.', exist_ok=True)
    json.dump(result, open(os.path.join(root, out), 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(f'변경 감지: {result["total"]}건 STALE → {out}')
    return 0

if __name__ == '__main__':
    sys.exit(main())
