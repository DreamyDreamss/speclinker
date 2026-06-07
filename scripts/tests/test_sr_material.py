#!/usr/bin/env python3
"""scan_sr_material 자료 충분도 판정 검증 (thin / drm / ok / inputs 보강)."""
import os, sys, tempfile, shutil
SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, SCRIPTS)
import scan_sr_material as m


def _dossier(root, sr):
    d = os.path.join(root, 'docs', '변경관리', sr)
    os.makedirs(d, exist_ok=True)
    return d


def test_states():
    tmp = tempfile.mkdtemp()
    try:
        d = _dossier(tmp, 'SR-THIN')
        open(os.path.join(d, '00_요구사항.md'), 'w', encoding='utf-8').write('짧음')
        assert m.judge(tmp, 'SR-THIN')['state'] == 'thin'

        d = _dossier(tmp, 'SR-DRM')
        open(os.path.join(d, '00_요구사항.md'), 'w', encoding='utf-8').write('짧음')
        os.makedirs(os.path.join(d, 'attachments'), exist_ok=True)
        open(os.path.join(d, 'attachments', '요건.hwp'), 'w').write('x')
        r = m.judge(tmp, 'SR-DRM')
        assert r['state'] == 'drm' and r['attachments'][0]['parseable'] is False, r

        # 사용자 inputs 보강 → ok
        os.makedirs(os.path.join(d, 'inputs'), exist_ok=True)
        open(os.path.join(d, 'inputs', 'capture.png'), 'w').write('x')
        assert m.judge(tmp, 'SR-DRM')['state'] == 'ok'

        d = _dossier(tmp, 'SR-OK')
        open(os.path.join(d, '00_요구사항.md'), 'w', encoding='utf-8').write('가' * 300)
        assert m.judge(tmp, 'SR-OK')['state'] == 'ok'
        print('PASS: test_states (thin/drm/ok/inputs)')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    test_states()
