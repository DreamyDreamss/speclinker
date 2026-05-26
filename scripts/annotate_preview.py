"""
annotate_preview.py — preview.png + preview_widgets.json → preview_annotated.png

화면 캡처 위에 [1] [2] [3] 형식의 디스크립션 번호 마커를 오버레이한다.
한국 SI 화면설계서의 PowerPoint 스타일 디스크립션을 자동 생성.

사용법:
  python3 annotate_preview.py <화면디렉토리>
    예: python3 annotate_preview.py docs/05_설계서/order/UI/OrdersList

  python3 annotate_preview.py --batch <도메인디렉토리>
    예: python3 annotate_preview.py --batch docs/05_설계서/order/UI

입력:
  <화면디렉토리>/preview.png         — 실제 화면 캡처 (runtime_capture가 생성)
  <화면디렉토리>/preview_widgets.json — widget bbox 정보
    [
      {"id": "WG-01", "number": "[1]", "bbox": [x1, y1, x2, y2], "label": "검색바"},
      {"id": "WG-02", "number": "[2]", "bbox": [x1, y1, x2, y2], "label": "검색버튼"},
      ...
    ]

출력:
  <화면디렉토리>/preview_annotated.png — 마커 오버레이된 이미지
"""

import sys
import os
import json
import argparse


def _check_pillow():
    """Pillow 의존성 확인 — 없으면 친절한 안내"""
    try:
        from PIL import Image, ImageDraw, ImageFont  # noqa: F401
        return True
    except ImportError:
        print('[ERROR] Pillow 미설치 — pip install Pillow 후 재실행', file=sys.stderr)
        return False


def annotate(screen_dir: str, dry_run: bool = False) -> dict:
    """
    화면 디렉토리에서 preview.png + preview_widgets.json 을 읽어
    preview_annotated.png 를 생성한다.

    Returns: {ok, annotated_path, marker_count, message}
    """
    png_path     = os.path.join(screen_dir, 'preview.png')
    widgets_path = os.path.join(screen_dir, 'preview_widgets.json')
    out_path     = os.path.join(screen_dir, 'preview_annotated.png')

    if not os.path.exists(png_path):
        return {'ok': False, 'message': f'preview.png 없음: {screen_dir}'}
    if not os.path.exists(widgets_path):
        return {'ok': False, 'message': f'preview_widgets.json 없음: {screen_dir}'}

    try:
        widgets = json.load(open(widgets_path, encoding='utf-8'))
    except Exception as e:
        return {'ok': False, 'message': f'preview_widgets.json 파싱 실패: {e}'}

    if not isinstance(widgets, list) or not widgets:
        return {'ok': False, 'message': 'preview_widgets.json 내용 없음 (빈 배열)'}

    if dry_run:
        return {'ok': True, 'annotated_path': out_path, 'marker_count': len(widgets),
                'message': 'dry-run — 실제 생성 안 함'}

    if not _check_pillow():
        return {'ok': False, 'message': 'Pillow 미설치'}

    from PIL import Image, ImageDraw, ImageFont

    img = Image.open(png_path).convert('RGBA')
    overlay = Image.new('RGBA', img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    # 폰트 — 시스템 기본 폰트로 fallback
    font = None
    for candidate in ('arial.ttf', 'Arial.ttf', 'DejaVuSans-Bold.ttf', 'NanumGothicBold.ttf'):
        try:
            font = ImageFont.truetype(candidate, 12)
            break
        except Exception:
            pass
    if font is None:
        font = ImageFont.load_default()

    rendered = 0
    for w in widgets:
        bbox = w.get('bbox')
        number = str(w.get('number') or w.get('id') or '?').strip('[]')  # 대괄호 제거
        if not bbox or len(bbox) != 4:
            continue
        x1, y1, x2, y2 = bbox
        # 외곽 박스 (얇게)
        draw.rectangle([x1, y1, x2, y2], outline=(220, 53, 69, 255), width=1)
        # 좌상단 원형 번호 마커 (작게)
        marker_r = 10
        cx, cy = x1, y1
        draw.ellipse([cx - marker_r, cy - marker_r, cx + marker_r, cy + marker_r],
                     fill=(220, 53, 69, 230), outline=(255, 255, 255, 255), width=1)
        # 번호 텍스트 — 가운데 정렬
        try:
            tb = draw.textbbox((0, 0), number, font=font)
            tw, th = tb[2] - tb[0], tb[3] - tb[1]
        except Exception:
            tw, th = len(number) * 6, 10
        draw.text((cx - tw // 2, cy - th // 2 - 1), number, fill=(255, 255, 255, 255), font=font)
        rendered += 1

    out = Image.alpha_composite(img, overlay).convert('RGB')
    out.save(out_path, 'PNG', optimize=True)

    return {'ok': True, 'annotated_path': out_path, 'marker_count': rendered, 'message': ''}


def batch(domain_ui_dir: str, dry_run: bool = False) -> dict:
    """도메인 UI 디렉토리 하위 모든 화면에 annotate 적용"""
    if not os.path.isdir(domain_ui_dir):
        return {'ok': False, 'message': f'디렉토리 없음: {domain_ui_dir}'}
    results = []
    for d in sorted(os.listdir(domain_ui_dir)):
        sd = os.path.join(domain_ui_dir, d)
        if not os.path.isdir(sd):
            continue
        r = annotate(sd, dry_run=dry_run)
        r['screen'] = d
        results.append(r)
    return {'ok': True, 'results': results}


def main():
    p = argparse.ArgumentParser(description='preview.png에 디스크립션 번호 마커 오버레이')
    p.add_argument('path', help='화면 디렉토리 또는 (--batch 시) 도메인 UI 디렉토리')
    p.add_argument('--batch', action='store_true', help='도메인 단위 일괄 처리')
    p.add_argument('--dry-run', action='store_true', help='실제 생성 없이 점검만')
    args = p.parse_args()

    if args.batch:
        r = batch(args.path, dry_run=args.dry_run)
        if not r.get('ok'):
            print(f'[ERROR] {r["message"]}')
            sys.exit(1)
        ok = sum(1 for x in r['results'] if x.get('ok'))
        for x in r['results']:
            status = 'OK' if x.get('ok') else 'SKIP'
            print(f'  [{status}] {x["screen"]:30s} markers={x.get("marker_count", 0)}  {x.get("message", "")}')
        print(f'\n총 {len(r["results"])}개 화면 중 {ok}개 어노테이션 생성')
    else:
        r = annotate(args.path, dry_run=args.dry_run)
        if r.get('ok'):
            print(f'OK — {r["annotated_path"]}  (markers: {r["marker_count"]})')
        else:
            print(f'[SKIP] {r["message"]}')
            sys.exit(1)


if __name__ == '__main__':
    main()
