# STATUS: 완료
"""
poc_cleanup.py — RECON 산출물 정리기 (POC 반복 개발용)

기본 동작 (안전 모드):
  지움:
    - docs/05_설계서/{도메인폴더}/        (INF/SCH/UIS 재생성 대상)
    - docs/05_설계서/{API_Design,DB_Schema,UI_Spec_v1.0}.md
    - docs/00_FUNC/
    - docs/03_기능명세서/
    - docs/04_아키텍처설계서/
    - _tmp/

  보존:
    - project.env
    - docs/05_설계서/_domain_plan.json (도메인 결정 재사용)
    - .understand-anything/             (UA 분석 결과)
    - .preview-storage.json             (인증 정보)

옵션:
  --reset-plan    : _domain_plan.json도 삭제 (도메인 분류 다시)
  --reset-ua      : .understand-anything 도 삭제 (UA 다시 분석)
  --reset-auth    : .preview-storage.json 삭제 (재로그인 강제)
  --reset-all     : 위 3개 모두 (project.env만 남김)
  --dry-run       : 삭제 대상만 출력, 실제 삭제 안 함
  --yes           : 확인 프롬프트 없이 진행

사용:
  python3 poc_cleanup.py [workspace] [옵션]
"""
import os
import shutil
import sys
import argparse


def main():
    parser = argparse.ArgumentParser(description='RECON 산출물 정리 (POC 반복용)')
    parser.add_argument('workspace', nargs='?', default='.', help='워크스페이스 디렉토리')
    parser.add_argument('--reset-plan', action='store_true', help='_domain_plan.json 도 삭제')
    parser.add_argument('--reset-ua', action='store_true', help='.understand-anything 도 삭제')
    parser.add_argument('--reset-auth', action='store_true', help='.preview-storage.json 삭제')
    parser.add_argument('--reset-all', action='store_true', help='reset-plan + reset-ua + reset-auth')
    parser.add_argument('--dry-run', action='store_true', help='삭제 대상만 출력')
    parser.add_argument('--yes', action='store_true', help='확인 프롬프트 스킵')
    args = parser.parse_args()

    if args.reset_all:
        args.reset_plan = True
        args.reset_ua = True
        args.reset_auth = True

    ws = os.path.abspath(args.workspace)
    if not os.path.isdir(ws):
        print(f'[ERROR] 워크스페이스 없음: {ws}', file=sys.stderr)
        sys.exit(1)

    docs = os.path.join(ws, 'docs', '05_설계서')

    # 삭제 대상 수집
    targets = []  # (path, type, label)

    # 1) 도메인 폴더들
    if os.path.isdir(docs):
        plan_path = os.path.join(docs, '_domain_plan.json')
        for entry in os.listdir(docs):
            full = os.path.join(docs, entry)
            if entry.startswith('_') or entry.startswith('.'):
                continue
            if os.path.isdir(full):
                targets.append((full, 'dir', f'docs/05_설계서/{entry}/'))

    # 2) 색인 파일들
    for name in ('API_Design.md', 'DB_Schema.md', 'UI_Spec_v1.0.md'):
        p = os.path.join(docs, name)
        if os.path.isfile(p):
            targets.append((p, 'file', f'docs/05_설계서/{name}'))

    # 3) FUNC / SRS / SAD 디렉토리
    for sub in ('docs/00_FUNC', 'docs/03_기능명세서', 'docs/04_아키텍처설계서'):
        p = os.path.join(ws, sub)
        if os.path.isdir(p):
            targets.append((p, 'dir', sub + '/'))

    # 4) _tmp
    tmp = os.path.join(ws, '_tmp')
    if os.path.isdir(tmp):
        targets.append((tmp, 'dir', '_tmp/'))

    # 5) 옵션별 추가
    if args.reset_plan:
        p = os.path.join(docs, '_domain_plan.json')
        if os.path.isfile(p):
            targets.append((p, 'file', 'docs/05_설계서/_domain_plan.json'))
        pf = p + '.full.json'
        if os.path.isfile(pf):
            targets.append((pf, 'file', 'docs/05_설계서/_domain_plan.json.full.json'))

    if args.reset_ua:
        p = os.path.join(ws, '.understand-anything')
        if os.path.isdir(p):
            targets.append((p, 'dir', '.understand-anything/'))

    if args.reset_auth:
        p = os.path.join(ws, '.preview-storage.json')
        if os.path.isfile(p):
            targets.append((p, 'file', '.preview-storage.json'))

    if not targets:
        print('정리 대상 없음 (이미 깨끗한 상태)')
        return

    # 출력
    print('=' * 60)
    print(f'정리 대상 ({len(targets)}건) — 워크스페이스: {ws}')
    print('=' * 60)
    for _, t, label in targets:
        kind = '📁' if t == 'dir' else '📄'
        print(f'  {kind} {label}')

    print('')
    print('보존:')
    print('  ✓ project.env')
    if not args.reset_plan:
        print('  ✓ docs/05_설계서/_domain_plan.json (도메인 결정 재사용)')
    if not args.reset_ua:
        print('  ✓ .understand-anything/ (UA 분석 결과)')
    if not args.reset_auth:
        print('  ✓ .preview-storage.json (인증)')
    print('')

    if args.dry_run:
        print('--dry-run: 실제 삭제 안 함')
        return

    if not args.yes:
        ans = input('진행하시겠습니까? (y/N): ').strip().lower()
        if ans != 'y':
            print('취소됨')
            return

    # 실제 삭제
    deleted = 0
    for path, t, label in targets:
        try:
            if t == 'dir':
                shutil.rmtree(path)
            else:
                os.remove(path)
            deleted += 1
            print(f'  삭제: {label}')
        except Exception as e:
            print(f'  실패: {label} — {e}')

    print('')
    print(f'완료: {deleted}/{len(targets)}건 삭제')
    print('이제 /sl-recon 으로 POC 재실행하면 됩니다.')


if __name__ == '__main__':
    main()
