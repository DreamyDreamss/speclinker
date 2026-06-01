---
name: sl-viewer
description: SDD 스펙 문서 Obsidian 뷰어 생성 + AIDD 참조 인덱스 빌드
argument-hint: [workspace]
---

# /sl-viewer — 스펙 뷰어 생성

`docs/05_설계서/` 의 SDD 산출물을 Obsidian vault로 변환하고 AIDD 참조 인덱스를 빌드한다.

**생성 결과:**
- `docs/05_설계서/_INDEX.md` — 도메인 매트릭스 (한눈에 커버리지 확인)
- 각 `spec.md` — YAML frontmatter + `[[links]]` 삽입
- `docs/05_설계서/.obsidian/` — Obsidian vault 마커
- `_tmp/spec_graph.json` — AIDD `func_context_bundle.py` 참조 인덱스

---

## 실행 전 확인

```bash
!python -c "
import os, sys
try: sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except: pass

design_root = 'docs/05_설계서'
if not os.path.isdir(design_root):
    print('[FAIL] docs/05_설계서/ 없음 → /sl-recon-uis 먼저 실행')
    sys.exit(1)

domains = [d for d in os.listdir(design_root)
           if os.path.isdir(os.path.join(design_root, d))
           and not d.startswith('.') and not d.startswith('_')]
print(f'[OK] 도메인 {len(domains)}개: {\" / \".join(domains[:5])}')

uis_count = sum(
    1 for d in domains
    for sub in ('UI', 'UIS', '')
    for entry in os.listdir(os.path.join(design_root, d, sub) if sub else os.path.join(design_root, d))
    if entry.startswith('UIS-')
    if os.path.exists(os.path.join(design_root, d, sub if sub else '', entry, 'spec.md') if sub else os.path.join(design_root, d, entry, 'spec.md'))
)
print(f'[OK] UIS 스펙 {uis_count}개 발견')
" 2>/dev/null || python3 -c "
import os, sys
try: sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except: pass
design_root = 'docs/05_설계서'
if not os.path.isdir(design_root):
    print('[FAIL] docs/05_설계서/ 없음')
    sys.exit(1)
domains = [d for d in os.listdir(design_root) if os.path.isdir(os.path.join(design_root, d)) and not d.startswith('.')]
print(f'[OK] 도메인 {len(domains)}개')
"
```

---

## STEP 1 — 스펙 인덱스 빌드

```bash
!python -c "
import os, sys, subprocess
try: sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except: pass

env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
plugin = env.get('PLUGIN_PATH', '')
script = os.path.join(plugin, 'scripts', 'gen_obsidian_index.py') if plugin else ''

if not (script and os.path.exists(script)):
    print('[ERROR] gen_obsidian_index.py 없음')
    sys.exit(1)

r = subprocess.run([sys.executable, script, '.'],
    capture_output=True, text=True, encoding='utf-8', errors='replace')
print(r.stdout)
if r.returncode != 0:
    print('[ERROR]', r.stderr[:500])
    sys.exit(1)
"
```

---

## STEP 2 — 결과 요약 출력

```bash
!python -c "
import json, os, sys
try: sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except: pass

graph_path = '_tmp/spec_graph.json'
if not os.path.exists(graph_path):
    print('[WARN] spec_graph.json 없음')
    sys.exit(0)

graph = json.load(open(graph_path, encoding='utf-8'))
by_type = {}
for node in graph.values():
    t = node.get('type', '?')
    by_type[t] = by_type.get(t, 0) + 1

linked = sum(1 for n in graph.values() if any(n.get('linked', {}).values()))

print('=== 스펙 인덱스 빌드 완료 ===')
for t, cnt in sorted(by_type.items()):
    print(f'  {t}: {cnt}개')
print(f'  연결된 스펙: {linked}개')
print()
print('Obsidian에서 열기:')
print('  폴더: docs/05_설계서/')
print('  홈:   docs/05_설계서/_INDEX.md')
print()
print('AIDD 연동:')
print('  func_context_bundle.py가 spec_graph.json을 자동 참조합니다.')
print('  UIS에 연결된 INF가 FUNC 번들에 자동 포함됩니다.')
"
```

---

## 사용 방법

### Obsidian으로 보기
1. Obsidian 앱 실행
2. "Open folder as vault" → `docs/05_설계서/` 선택
3. `_INDEX.md` 열기 → 도메인 매트릭스
4. 그래프 뷰 (Ctrl+G) → 스펙 간 연결 시각화

### AIDD에서 스펙 참조
```bash
# FUNC 번들 조회 시 spec_graph 자동 적용
!python {PLUGIN_PATH}/scripts/func_context_bundle.py FUNC-product-001 .
```

### 스펙 추가 후 재실행
새 UIS/INF가 생성될 때마다 `/sl-viewer` 재실행하면 인덱스가 갱신됩니다.
