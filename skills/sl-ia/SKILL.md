---
name: sl-ia
description: RECON 산출물 기반 IA(Information Architecture) 문서 자동 생성 + UIS menu-path 일괄 보완
argument-hint: [도메인명 | --update-only]
---

# /sl-ia — IA 문서 생성

route 파일 분석 + 기존 UIS spec.md를 기반으로 메뉴 계층 문서(`IA_MAP.md`)를 생성하고,
UIS `spec.md`의 `menu-path:` 필드를 일괄 보완한다.

**생성 결과:**
- `docs/00_IA/IA_MAP.md` — 메뉴 트리 → 화면 → INF 링크 테이블
- 기존 UIS `spec.md`의 `menu-path:` 업데이트

---

## 전제 조건 확인

```bash
!python -c "
import os, sys
try: sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except: pass
uis_root = 'docs/05_설계서/UIS'
if not os.path.isdir(uis_root):
    print('[FAIL] docs/05_설계서/UIS/ 없음 → /sl-recon-uis 먼저 실행')
    sys.exit(1)
count = sum(1 for e in os.listdir(uis_root) if os.path.isfile(os.path.join(uis_root, e, 'spec.md')))
print(f'[OK] UIS spec.md {count}개 발견')
"
```

---

## STEP 1 — route 파일 스캔

다음 파일 패턴을 순서대로 탐색:
1. `src/**/router*.{js,ts}`, `src/**/routes*.{js,ts}` — SPA 라우터
2. `src/**/menu*.{js,ts,json}`, `src/**/navigation*.{js,ts}` — 메뉴 설정
3. `src/**/pages/**/*.{vue,tsx,jsx}` + Next.js `app/**/page.tsx` — 파일 기반 라우팅
4. `**/*.xml` with `<url-mapping>` or `@RequestMapping` in `**/*Controller.java` — Spring MVC

발견한 파일에서 **경로 → 메뉴명 매핑**을 추출한다:
- `{ path: '/order/list', name: '주문 목록', meta: { title: '주문 목록' } }` → `['주문관리', '주문 목록']`
- `<url-pattern>/order/list</url-pattern>` + JSP title 태그 → `['주문관리', '주문 목록']`

추출 결과를 임시 dict로 보관: `{ '/order/list': ['주문관리', '주문 목록'] }`

> 메뉴명을 찾지 못한 경로: URL 세그먼트를 한국어로 번역해 추론 (order→주문관리 등).
> 완전히 불명확한 경우 `[TBD]`.

---

## STEP 2 — UIS spec.md menu-path 업데이트

`docs/05_설계서/UIS/` 하위 모든 `spec.md`를 순서대로 처리:

1. `라우트:` frontmatter 값 읽기
2. STEP 1 dict에서 해당 경로의 menu-path 조회
3. 기존 `menu-path:` 필드가 `[TBD]`이거나 없으면 → 추론값으로 교체
4. 이미 값이 있으면 → 변경하지 않음 (수동 입력 보호)

각 파일 업데이트 후 "UIS-F-031: [주문관리, 주문조회] 업데이트" 형식으로 로그 출력.

---

## STEP 3 — IA_MAP.md 생성

```bash
!python -c "
import os, sys, re
try: sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except: pass

def get_fm(content):
    content = content.replace('\r\n', '\n').replace('\r', '\n')
    m = re.match(r'^---\n(.*?)\n---', content, re.DOTALL)
    return m.group(1) if m else ''

def extract_list(block, key):
    result, in_list = [], False
    for line in block.splitlines():
        if re.match(rf'^{re.escape(key)}:\s*$', line.rstrip()):
            in_list = True
            continue
        if in_list:
            s = line.strip()
            if s.startswith('- '):
                val = s[2:].split('#')[0].strip()
                if val: result.append(val)
            elif s and not line.startswith(' '): break
    return result

def simple_parse(block, key):
    for line in block.splitlines():
        if ':' in line and not line.startswith(' '):
            k, _, v = line.partition(':')
            if k.strip() == key: return v.strip()
    return ''

uis_root = 'docs/05_설계서/UIS'
if not os.path.isdir(uis_root):
    print('[FAIL] docs/05_설계서/UIS/ 없음')
    sys.exit(1)

rows = []
for entry in sorted(os.listdir(uis_root)):
    spec = os.path.join(uis_root, entry, 'spec.md')
    if not os.path.isfile(spec): continue
    with open(spec, encoding='utf-8', errors='replace') as f:
        c = f.read()
    fb = get_fm(c)
    uis_id = simple_parse(fb, 'UIS-ID') or entry
    name = simple_parse(fb, '화면명') or '-'
    route = simple_parse(fb, '라우트') or '-'
    mp = extract_list(fb, 'menu-path')
    apis = extract_list(fb, 'apis')
    menu_str = ' > '.join(mp) if mp and mp[0] != '[TBD]' else '[미분류]'
    api_str = ', '.join(apis[:3]) + ('...' if len(apis) > 3 else '') if apis else '-'
    rows.append(f'| {menu_str} | {uis_id} | {name} | {api_str} | {route} |')

os.makedirs('docs/00_IA', exist_ok=True)
out = ['# IA_MAP\n',
       '| 메뉴 경로 | 화면ID | 화면명 | INF | 라우트 |',
       '|---------|-------|------|-----|------|'] + rows
with open('docs/00_IA/IA_MAP.md', 'w', encoding='utf-8') as f:
    f.write('\n'.join(out) + '\n')
print(f'[OK] IA_MAP.md 생성 — {len(rows)}개 화면')
print('     → docs/00_IA/IA_MAP.md')
"
```

---

## STEP 4 — spec_index.json 갱신

```bash
!python {PLUGIN_PATH}/scripts/gen_docsify.py .
```

뷰어를 이미 열어 두었다면 브라우저 새로고침으로 IA 트리 반영 확인.

---

## 완료 보고

- `docs/00_IA/IA_MAP.md` 생성 완료
- 업데이트된 UIS `spec.md` 목록 출력
- `spec_index.json` 갱신 완료
- `/sl-viewer`로 IA 트리 모드에서 결과 확인 안내
