"""
STATUS: ✅완료
check_docs_sync.py — README/CLAUDE.md 동기화 자동 검사

README.md와 CLAUDE.md가 실제 파일 시스템과 일치하는지 확인한다.
검사 항목:
  1. skills/ 디렉토리 실제 개수 vs README 명시 개수
  2. agents/ 디렉토리 실제 개수 vs README 명시 개수
  3. CLAUDE.md 라우팅 표에 없는 스킬 파일 탐지
  4. strategies/ yaml 개수
  5. scripts/ STATUS 주석 누락 파일 탐지

사용: python3 scripts/check_docs_sync.py [플러그인_루트]
"""

import os
import re
import sys

def find_plugin_root(start: str) -> str:
    d = os.path.abspath(start)
    for _ in range(6):
        if os.path.exists(os.path.join(d, "CLAUDE.md")) and os.path.exists(os.path.join(d, "skills")):
            return d
        d = os.path.dirname(d)
    return os.path.abspath(start)

ROOT = find_plugin_root(sys.argv[1] if len(sys.argv) > 1 else ".")

issues: list[str] = []
ok: list[str] = []


# ─── 1. skills/ 실제 개수 ────────────────────────────────────────────────────

skills_dir = os.path.join(ROOT, "skills")
actual_skills = sorted(
    d for d in os.listdir(skills_dir)
    if os.path.isdir(os.path.join(skills_dir, d))
    and os.path.exists(os.path.join(skills_dir, d, "SKILL.md"))
) if os.path.isdir(skills_dir) else []

readme_path = os.path.join(ROOT, "README.md")
readme_text = open(readme_path, encoding="utf-8").read() if os.path.exists(readme_path) else ""

m = re.search(r"skills/.*?슬래시 커맨드.*?\((\d+)개\)", readme_text)
readme_skills_count = int(m.group(1)) if m else None

if readme_skills_count is None:
    issues.append("README: skills 개수 표기를 찾을 수 없음")
elif readme_skills_count != len(actual_skills):
    issues.append(
        f"README: skills 개수 불일치 — 명시 {readme_skills_count}개, 실제 {len(actual_skills)}개"
        f" ({', '.join(actual_skills)})"
    )
else:
    ok.append(f"skills 개수 일치: {len(actual_skills)}개")


# ─── 2. agents/ 실제 개수 ────────────────────────────────────────────────────

agents_dir = os.path.join(ROOT, "agents")
actual_agents = sorted(
    f[:-3] for f in os.listdir(agents_dir)
    if f.endswith(".md") and not f.startswith("_")
) if os.path.isdir(agents_dir) else []

m2 = re.search(r"agents/.*?서브에이전트.*?\((\d+)개\)", readme_text)
readme_agents_count = int(m2.group(1)) if m2 else None

if readme_agents_count is None:
    issues.append("README: agents 개수 표기를 찾을 수 없음")
elif readme_agents_count != len(actual_agents):
    issues.append(
        f"README: agents 개수 불일치 — 명시 {readme_agents_count}개, 실제 {len(actual_agents)}개"
    )
    readme_listed = set(re.findall(r"([\w-]+-agent|spec-agent|profile-agent|convention-learner|meta-extractor)\.md", readme_text))
    missing_in_readme = [a for a in actual_agents if a + ".md" not in readme_listed and a not in readme_listed]
    if missing_in_readme:
        issues.append(f"  README에 없는 에이전트: {missing_in_readme}")
else:
    ok.append(f"agents 개수 일치: {len(actual_agents)}개")


# ─── 3. CLAUDE.md 라우팅 표 vs 실제 스킬 ────────────────────────────────────

claude_path = os.path.join(ROOT, "CLAUDE.md")
claude_text = open(claude_path, encoding="utf-8").read() if os.path.exists(claude_path) else ""

routed_skills = set(re.findall(r"`/sl-([\w-]+)`", claude_text))
actual_skill_names = set(actual_skills)

not_in_routing = actual_skill_names - {f"sl-{s}" for s in routed_skills}
if not_in_routing:
    issues.append(f"CLAUDE.md 라우팅 표에 없는 스킬: {sorted(not_in_routing)}")
else:
    ok.append("CLAUDE.md 라우팅 표 완전 커버")


# ─── 4. strategies/ yaml 개수 ────────────────────────────────────────────────

strategies_dir = os.path.join(ROOT, "strategies")
yaml_count = 0
if os.path.isdir(strategies_dir):
    for dirpath, _, filenames in os.walk(strategies_dir):
        if "community" in dirpath:
            continue
        yaml_count += sum(1 for f in filenames if f.endswith(".yaml") and not f.startswith("_"))

ok.append(f"strategies/ yaml: {yaml_count}개 (community 제외)")


# ─── 5. scripts/ STATUS 주석 누락 ────────────────────────────────────────────

scripts_dir = os.path.join(ROOT, "scripts")
missing_status: list[str] = []
if os.path.isdir(scripts_dir):
    for fname in sorted(os.listdir(scripts_dir)):
        if not (fname.endswith(".py") or fname.endswith(".js") or fname.endswith(".sh")):
            continue
        fpath = os.path.join(scripts_dir, fname)
        try:
            head = open(fpath, encoding="utf-8", errors="ignore").read(500)
        except OSError:
            continue
        if "STATUS:" not in head:
            missing_status.append(fname)

if missing_status:
    issues.append(f"scripts/ STATUS 주석 누락 ({len(missing_status)}개): {missing_status}")
else:
    ok.append("scripts/ 전체 STATUS 주석 있음")


# ─── 출력 ─────────────────────────────────────────────────────────────────────

print("\n=== Speclinker docs sync check ===\n")
if ok:
    for msg in ok:
        print(f"  ✅ {msg}")
if issues:
    print()
    for msg in issues:
        print(f"  ❌ {msg}")
    print(f"\n총 {len(issues)}개 불일치. 수정이 필요합니다.")
    sys.exit(1)
else:
    print("\n모든 검사 통과 ✅")
