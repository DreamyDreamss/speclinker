# STATUS: 완료
#!/usr/bin/env python3
"""
scan_sr_material.py — SR 티켓 도시에(dossier) 자료 충분도 판정 (zero-LLM).

SR 본문이 부실하거나 첨부가 DRM/HWP라 자동 분석이 안 되는 경우를 감지해,
SpecLens 보드에 "⚠ 보강 필요"를 띄우고 사용자가 inputs/에 캡처·메모를 채우도록 유도한다.

도시에: docs/변경관리/{SR}/
  00_요구사항.md   본문(지라 or 템플릿)
  attachments/     지라 첨부 (HWP/암호화 등 파싱불가 존재 가능)
  _extracted.md    파싱된 첨부 본문([추출 불가] 마커 포함 가능)
  inputs/          ★사용자 보강자료(캡처·메모) — 있으면 충분으로 본다
  _notes.md        화면 입력 메모(선택)

판정: ok(충분) / thin(본문 부실+첨부 없음) / drm(첨부 있으나 파싱 가능분 없음/추출불가)
출력(stdout JSON): {sr,state,note,dossier_path,req_len,attachments[],inputs[],extracted_len}

Usage:
  python scan_sr_material.py [workspace] --sr SR-1234
  python scan_sr_material.py [workspace] --all          # docs/변경관리/* 전체
"""
import os, sys, json

PARSEABLE = {'.pptx', '.docx', '.xlsx', '.pdf', '.txt', '.md', '.csv',
             '.png', '.jpg', '.jpeg', '.gif', '.webp'}
MIN_REQ = 200          # 본문 충분 기준(글자)
MIN_EXTRACT = 200      # 첨부 추출 충분 기준


def _read(p):
    try:
        return open(p, encoding='utf-8', errors='replace').read()
    except OSError:
        return ''


def judge(root, sr):
    dossier = os.path.join(root, 'docs', '변경관리', sr)
    req_len = len(_read(os.path.join(dossier, '00_요구사항.md')).strip())

    att_dir = os.path.join(dossier, 'attachments')
    atts = []
    if os.path.isdir(att_dir):
        for f in sorted(os.listdir(att_dir)):
            if os.path.isfile(os.path.join(att_dir, f)):
                ext = os.path.splitext(f)[1].lower()
                atts.append({'name': f, 'parseable': ext in PARSEABLE})

    inputs_dir = os.path.join(dossier, 'inputs')
    inputs = sorted(f for f in os.listdir(inputs_dir)) if os.path.isdir(inputs_dir) else []
    notes_len = len(_read(os.path.join(dossier, '_notes.md')).strip())

    extracted = _read(os.path.join(dossier, '_extracted.md'))
    ext_len = len(extracted.strip())
    ext_fail = extracted.count('추출 불가') + extracted.count('추출불가')

    has_att = bool(atts)
    att_ok = any(a['parseable'] for a in atts)
    user_added = bool(inputs) or notes_len > 0

    if user_added or ext_len > MIN_EXTRACT or req_len >= MIN_REQ:
        state = 'ok'
    elif has_att and not att_ok:
        state = 'drm'        # 첨부는 있는데 파싱 가능한 게 없음(HWP/암호화 등)
    elif ext_fail > 0:
        state = 'drm'        # 추출 불가 마커
    elif req_len < MIN_REQ and not has_att:
        state = 'thin'       # 본문 짧고 첨부도 없음
    else:
        state = 'ok'

    note = {'ok': '자료 충분', 'drm': '첨부 추출 불가(DRM/HWP) — 보강 필요',
            'thin': '본문 부실 — 보강 필요'}[state]
    return {'sr': sr, 'state': state, 'note': note,
            'dossier_path': os.path.relpath(dossier, root).replace('\\', '/'),
            'req_len': req_len, 'attachments': atts, 'inputs': inputs,
            'extracted_len': ext_len}


def main():
    argv = sys.argv[1:]
    sr = None
    do_all = '--all' in argv
    if '--sr' in argv:
        sr = argv[argv.index('--sr') + 1]
    paths = [a for a in argv if not a.startswith('--') and a != sr]
    root = paths[0] if paths else '.'

    if do_all:
        base = os.path.join(root, 'docs', '변경관리')
        srs = sorted(d for d in os.listdir(base)) if os.path.isdir(base) else []
        out = [judge(root, s) for s in srs if os.path.isdir(os.path.join(base, s))]
        print(json.dumps(out, ensure_ascii=False, indent=2))
    elif sr:
        print(json.dumps(judge(root, sr), ensure_ascii=False, indent=2))
    else:
        print('Usage: scan_sr_material.py [workspace] --sr SR-1234 | --all', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
