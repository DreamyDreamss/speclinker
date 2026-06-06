#!/usr/bin/env python3
"""build_funcs_index.py 가 현행 UIS 디렉토리 구조({domain}/UIS/UIS-...)를 스캔하는지 검증.

회귀 방지: v3.9 UIS 재설계가 {domain}/UI/{screenId}/ → {domain}/UIS/UIS-{CODE}-{NNN}_{화면명}/
로 바뀌었는데 build_funcs_index가 구버전 'UI/'만 스캔해 화면 0개가 되던 결함."""
import os, sys, json, subprocess, tempfile, shutil

SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)


def _build_project(uis_dirname):
    """uis_dirname='UIS'(현행) 또는 'UI'(구버전)로 화면 디렉토리를 만든 임시 프로젝트 반환."""
    tmp = tempfile.mkdtemp()
    design = os.path.join(tmp, 'docs', '05_설계서')
    _write(os.path.join(design, '_domain_plan.json'),
           json.dumps({'domains': [{'name': 'product'}]}, ensure_ascii=False))
    _write(os.path.join(design, 'product', 'INF', 'INF-PRD-001.md'),
           "---\ninf-id: INF-PRD-001\nmethod: POST\npath: /app/product/save\n"
           "domain: product\nscreens:\n  - UIS-PRD-001\n---\n\n# INF-PRD-001: POST /app/product/save — 상품저장\n")
    _write(os.path.join(design, 'product', uis_dirname, 'UIS-PRD-001_상품등록', 'spec.md'),
           "---\n화면명: 상품등록\n라우트: /app/product/pr201Form\ndomain: product\n"
           "UIS-ID: UIS-PRD-001\napi_hints:\n  - POST [INF-PRD-001](../../INF/INF-PRD-001.md)\n---\n\n# 상품등록\n")
    return tmp


def _run(tmp):
    subprocess.run([sys.executable, os.path.join(SCRIPTS, 'build_funcs_index.py'), tmp],
                   check=False, capture_output=True)
    return json.load(open(os.path.join(tmp, '_tmp', 'funcs_index.json'), encoding='utf-8'))


def test_scans_current_uis_directory():
    tmp = _build_project('UIS')
    try:
        idx = _run(tmp)
        assert 'UIS-PRD-001' in idx.get('screens', {}), f"screens={idx.get('screens')}"
        assert len(idx.get('funcs', [])) >= 1, idx.get('funcs')
        # 화면이 INF를 참조 연결했는지 (api_hints 박힌 INF-ID)
        func = idx['funcs'][0]
        assert func['uisId'] == 'UIS-PRD-001', func
        assert any(i['id'] == 'INF-PRD-001' for i in func.get('inf', [])), func.get('inf')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_legacy_ui_directory_still_supported():
    """구버전 'UI/' 구조도 하위호환으로 계속 스캔돼야 한다."""
    tmp = _build_project('UI')
    try:
        idx = _run(tmp)
        assert 'UIS-PRD-001' in idx.get('screens', {}), f"screens={idx.get('screens')}"
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    for name, fn in sorted(globals().items()):
        if name.startswith('test_') and callable(fn):
            fn(); print('PASS', name)
