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
