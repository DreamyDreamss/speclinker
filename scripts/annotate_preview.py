# STATUS: 완료
"""
annotate_preview.py — preview.png + 블록 맵 → preview_annotated.png

두 가지 입력 소스를 지원한다 (우선순위 순):

1. preview_block_map.json  ← ddd-ui-agent가 이미지+소스 분석으로 생성 (권장)
   형식: [{"number": 1, "label": "검색조건", "bbox_pct": [0.0, 0.10, 1.0, 0.28]}, ...]
   bbox_pct = [left, top, right, bottom] 비율 (0.0~1.0, 이미지 크기 대비)

2. preview_widgets.json    ← capture.js가 DOM 스캔으로 생성 (fallback)
   형식: [{"number": 1, "bbox": {"x":10,"y":20,"w":100,"h":30}, ...}, ...]
   또는: [{"number": 1, "bbox": [x1,y1,x2,y2], ...}, ...]

block_map을 쓰면 비즈니스 기능 블록 단위 마커,
widgets를 쓰면 DOM 요소 단위 마커.

사용법:
  python3 annotate_preview.py <화면디렉토리>
  python3 annotate_preview.py --batch <도메인UI디렉토리>
  python3 annotate_preview.py --block-map <block_map.json> <preview.png> --out <out.png>
"""

import sys
import os
import json
import argparse

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except AttributeError:
    pass

# ── 렌더링 상수 ─────────────────────────────────────────────
_COLOR_BLOCK  = (30, 136, 229, 255)   # 파란색 — block_map 블록 마커
_COLOR_WIDGET = (220, 53, 69, 255)    # 빨간색 — widget DOM 마커
_COLOR_WHITE  = (255, 255, 255, 255)
_MARKER_R     = 11                    # 원형 마커 반경 (px)
_BOX_WIDTH_BLOCK  = 2
_BOX_WIDTH_WIDGET = 1


def _check_pillow() -> bool:
    try:
        from PIL import Image, ImageDraw, ImageFont  # noqa: F401
        return True
    except ImportError:
        print('[ERROR] Pillow 미설치 — pip install Pillow 후 재실행', file=sys.stderr)
        return False


def _load_font(size: int = 12):
    from PIL import ImageFont
    for candidate in ('arial.ttf', 'Arial.ttf', 'DejaVuSans-Bold.ttf', 'NanumGothicBold.ttf'):
        try:
            return ImageFont.truetype(candidate, size)
        except Exception:
            pass
    return ImageFont.load_default()


def _draw_marker(draw, cx: int, cy: int, number: str, color, font):
    """원형 번호 마커를 (cx, cy) 위치에 그린다."""
    r = _MARKER_R
    draw.ellipse([cx - r, cy - r, cx + r, cy + r],
                 fill=color, outline=_COLOR_WHITE, width=1)
    try:
        from PIL import ImageDraw as _ID
        tb = draw.textbbox((0, 0), number, font=font)
        tw, th = tb[2] - tb[0], tb[3] - tb[1]
    except Exception:
        tw, th = len(number) * 6, 10
    draw.text((cx - tw // 2, cy - th // 2 - 1), number,
              fill=_COLOR_WHITE, font=font)


def annotate_from_block_map(img, draw, overlay_draw, blocks: list, font) -> int:
    """
    preview_block_map.json 기반 어노테이션.
    blocks: [{"number": N, "label": "...", "bbox_pct": [l, t, r, b]}]
    bbox_pct 값은 0.0~1.0 (이미지 너비/높이 대비 비율).
    """
    W, H = img.size
    rendered = 0
    for b in blocks:
        bbox_pct = b.get('bbox_pct') or b.get('bboxPct')
        number = str(b.get('number', '?'))
        label = b.get('label', '')

        if not bbox_pct or len(bbox_pct) != 4:
            continue

        l_pct, t_pct, r_pct, bot_pct = bbox_pct
        # 비율 → 픽셀
        x1 = max(0, int(l_pct * W))
        y1 = max(0, int(t_pct * H))
        x2 = min(W - 1, int(r_pct * W))
        y2 = min(H - 1, int(bot_pct * H))

        if x2 <= x1 or y2 <= y1:
            continue

        # 박스 (파란색, 굵게)
        overlay_draw.rectangle([x1, y1, x2, y2],
                                outline=_COLOR_BLOCK, width=_BOX_WIDTH_BLOCK)

        # 번호 마커 — 박스 좌상단 바깥쪽
        cx = x1
        cy = y1
        _draw_marker(overlay_draw, cx, cy, number, _COLOR_BLOCK, font)

        # 레이블 텍스트 (마커 오른쪽)
        if label:
            try:
                tb = overlay_draw.textbbox((0, 0), label, font=font)
                lw = tb[2] - tb[0]
                lh = tb[3] - tb[1]
            except Exception:
                lw, lh = len(label) * 7, 12
            lx = cx + _MARKER_R + 3
            ly = cy - lh // 2 - 1
            # 배경 rect (가독성)
            pad = 2
            overlay_draw.rectangle(
                [lx - pad, ly - pad, lx + lw + pad, ly + lh + pad],
                fill=(30, 136, 229, 180)
            )
            overlay_draw.text((lx, ly), label, fill=_COLOR_WHITE, font=font)

        rendered += 1
    return rendered


def annotate_from_widgets(img, overlay_draw, widgets: list, font) -> int:
    """
    preview_widgets.json 기반 어노테이션 (DOM 요소 단위, fallback).
    """
    W, H = img.size
    rendered = 0
    for w in widgets:
        bbox = w.get('bbox')
        number = str(w.get('number') or w.get('id') or '?').strip('[]')
        if not bbox:
            continue

        if isinstance(bbox, dict):
            bx = bbox.get('x', 0)
            by = bbox.get('y', 0)
            bw = bbox.get('w', 0)
            bh = bbox.get('h', 0)
            x1, y1, x2, y2 = bx, by, bx + bw, by + bh
        elif len(bbox) == 4:
            x1, y1, x2, y2 = bbox
        else:
            continue

        x1 = max(0, int(x1))
        y1 = max(0, int(y1))
        x2 = min(W - 1, int(x2))
        y2 = min(H - 1, int(y2))

        if x2 <= x1 or y2 <= y1:
            continue

        overlay_draw.rectangle([x1, y1, x2, y2],
                                outline=_COLOR_WIDGET, width=_BOX_WIDTH_WIDGET)
        _draw_marker(overlay_draw, x1, y1, number, _COLOR_WIDGET, font)
        rendered += 1
    return rendered


def annotate(screen_dir: str = None,
             png_path: str = None,
             block_map_path: str = None,
             widgets_path: str = None,
             out_path: str = None,
             keep_originals: bool = False,
             dry_run: bool = False) -> dict:
    """
    화면 디렉토리(또는 명시적 경로)로부터 preview_annotated.png를 생성한다.

    우선순위:
      1. block_map_path (또는 <screen_dir>/preview_block_map.json)
      2. widgets_path   (또는 <screen_dir>/preview_widgets.json)

    Returns: {ok, annotated_path, marker_count, source, message}
    """
    # 경로 해결
    if screen_dir:
        if png_path is None:
            png_path = os.path.join(screen_dir, 'preview.png')
        if out_path is None:
            out_path = os.path.join(screen_dir, 'preview_annotated.png')
        if block_map_path is None:
            block_map_path = os.path.join(screen_dir, 'preview_block_map.json')
        if widgets_path is None:
            widgets_path = os.path.join(screen_dir, 'preview_widgets.json')
            if not os.path.exists(widgets_path):
                fallback = os.path.join(screen_dir, 'widgets.json')
                if os.path.exists(fallback):
                    widgets_path = fallback

    if not png_path or not os.path.exists(png_path):
        return {'ok': False, 'message': f'preview.png 없음: {png_path}'}

    # 입력 소스 결정
    source = None
    markers = []

    if block_map_path and os.path.exists(block_map_path):
        try:
            data = json.load(open(block_map_path, encoding='utf-8'))
            if isinstance(data, list) and data:
                markers = data
                source = 'block_map'
        except Exception as e:
            pass  # 파싱 실패 → widgets fallback

    if source is None:
        if widgets_path and os.path.exists(widgets_path):
            try:
                data = json.load(open(widgets_path, encoding='utf-8'))
                if isinstance(data, list) and data:
                    markers = data
                    source = 'widgets'
            except Exception:
                pass

    if not markers:
        return {'ok': False, 'message': '마커 데이터 없음 (block_map + widgets 모두 빈 배열 또는 없음)'}

    if dry_run:
        return {'ok': True, 'annotated_path': out_path,
                'marker_count': len(markers), 'source': source,
                'message': 'dry-run'}

    if not _check_pillow():
        return {'ok': False, 'message': 'Pillow 미설치'}

    from PIL import Image, ImageDraw

    img = Image.open(png_path).convert('RGBA')
    overlay = Image.new('RGBA', img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    font = _load_font(12)

    if source == 'block_map':
        rendered = annotate_from_block_map(img, draw, draw, markers, font)
    else:
        rendered = annotate_from_widgets(img, draw, markers, font)

    out = Image.alpha_composite(img, overlay).convert('RGB')
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    out.save(out_path, 'PNG', optimize=True)

    if not keep_originals and png_path and os.path.abspath(png_path) != os.path.abspath(out_path):
        try:
            os.remove(png_path)
        except OSError:
            pass

    return {'ok': True, 'annotated_path': out_path,
            'marker_count': rendered, 'source': source, 'message': ''}


def batch(domain_ui_dir: str, dry_run: bool = False, keep_originals: bool = False) -> dict:
    """도메인 UI 디렉토리 하위 모든 화면에 annotate 적용"""
    if not os.path.isdir(domain_ui_dir):
        return {'ok': False, 'message': f'디렉토리 없음: {domain_ui_dir}'}
    results = []
    for d in sorted(os.listdir(domain_ui_dir)):
        sd = os.path.join(domain_ui_dir, d)
        if not os.path.isdir(sd):
            continue
        r = annotate(screen_dir=sd, dry_run=dry_run, keep_originals=keep_originals)
        r['screen'] = d
        results.append(r)
    return {'ok': True, 'results': results}


def main():
    p = argparse.ArgumentParser(description='preview.png에 블록/위젯 번호 마커 오버레이')
    p.add_argument('path', nargs='?', default=None,
                   help='화면 디렉토리 (--batch 시 도메인 UI 디렉토리, --block-map 시 생략 가능)')
    p.add_argument('--batch', action='store_true', help='도메인 단위 일괄 처리')
    p.add_argument('--dry-run', action='store_true', help='실제 생성 없이 점검만')
    p.add_argument('--block-map', default=None,
                   help='preview_block_map.json 경로 (명시적 지정)')
    p.add_argument('--png', default=None, help='PNG 파일 경로 (기본: <path>/preview.png)')
    p.add_argument('--widgets', default=None, help='widgets JSON 경로 (기본: <path>/preview_widgets.json)')
    p.add_argument('--out', default=None, help='출력 PNG 경로 (기본: <path>/preview_annotated.png)')
    p.add_argument('--keep-originals', action='store_true',
                   help='어노테이션 완료 후 원본 PNG를 삭제하지 않음 (기본: 삭제)')
    args = p.parse_args()

    if args.batch:
        if not args.path:
            print('[ERROR] --batch 사용 시 도메인 UI 디렉토리 경로 필요', file=sys.stderr)
            sys.exit(1)
        r = batch(args.path, dry_run=args.dry_run, keep_originals=args.keep_originals)
        if not r.get('ok'):
            print(f'[ERROR] {r["message"]}')
            sys.exit(1)
        ok = sum(1 for x in r['results'] if x.get('ok'))
        for x in r['results']:
            status = 'OK' if x.get('ok') else 'SKIP'
            src = x.get('source', '-')
            print(f'  [{status}] {x["screen"]:30s} markers={x.get("marker_count", 0):3d}  '
                  f'src={src:10s}  {x.get("message", "")}')
        print(f'\n총 {len(r["results"])}개 화면 중 {ok}개 어노테이션 생성')
    else:
        r = annotate(
            screen_dir=args.path,
            png_path=args.png,
            block_map_path=args.block_map,
            widgets_path=args.widgets,
            out_path=args.out,
            keep_originals=args.keep_originals,
            dry_run=args.dry_run,
        )
        if r.get('ok'):
            print(f'OK [{r.get("source","?")}] — {r["annotated_path"]}  '
                  f'(markers: {r["marker_count"]})')
        else:
            print(f'[SKIP] {r["message"]}')
            sys.exit(1)


if __name__ == '__main__':
    main()
