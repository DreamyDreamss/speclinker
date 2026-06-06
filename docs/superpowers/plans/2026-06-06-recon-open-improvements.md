# RECON 실전 개선안 — 잔여(열린) 항목 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development 또는 superpowers:executing-plans. 체크박스 추적.

**Goal:** nkshop 실전 세션 개선안(`_tmp/speclinker_plugin_improvements.md`) 중 v3.13.0에서 **아직 열린 항목**을 닫는다. 핵심: scan_source의 api/method 정확도(C-4·H-3)로 INF 누락·method 오류를 근절, 모델 한도 자동 폴백(H-1)으로 디스패치 중단 방지.

**Architecture:** 대부분 `scripts/scan_source.js`(정적 스캐너)와 `scripts/dispatch_inf_gen.py`(디스패처)의 국소 수정. 범용성(스택 중립) 유지 — 신호는 패턴 추가로 보강, 하드코딩 금지.

**Tech Stack:** Node.js(scan_source.js), Python(dispatch_inf_gen.py, scan_source 산출 검증).

**검증 베드:** nkshop `D:\nkshop-bos\nkshop-bos-admin`(Java Spring MVC + jwork + Jackson JSON view). 단위검증은 합성 Java 스니펫 픽스처.

**개선안 출처:** `D:\nkshop-bos\nkshop-bos-admin\_tmp\speclinker_plugin_improvements.md` (C-4/H-3/H-1/M-3/M-5/L-1/L-2 = 열림. C-1/2/3/5/6/7·H-2·M-4 = 이미 닫힘).

**범위 밖:** 이미 닫힌 항목, M-1(resolve_call_chain dao/query — 별도 큰 작업), L-4(MCP 동시접속 — 환경 가이드).

---

## File Structure
- `scripts/scan_source.js` — **수정**: ①API_BODY_SIGNALS에 Jackson JSON-view 시그널 추가(C-4) ②@RequestMapping `method=` 속성 파싱(H-3) ③api-by-naming 보조 힌트(C-4 보강).
- `scripts/tests/test_scan_source.js` — **신규**: 합성 컨트롤러로 api 분류·method 파싱 검증(node 실행).
- `scripts/dispatch_inf_gen.py` — **수정**: rate-limit 감지 시 haiku 자동 폴백(H-1) + 성공 시 failed[] 정리(M-5).
- `scripts/scan_source.js` BAT 판정 — **수정(M-3)**: 스케줄러 시그널 가중, Mapper/Model/Service 접미사 제외.
- `skills/sl-recon/SKILL.md`(인라인 reconfigure L-2), `scripts/README.md`, `CLAUDE.md`, `.claude-plugin/plugin.json` — 동기화 + 버전.

---

## Phase A — scan_source 정확도 (C-4, H-3)

### Task 1: Jackson JSON-view 핸들러를 api로 분류 (C-4)

**Files:** Modify `scripts/scan_source.js`; Test `scripts/tests/test_scan_source.js`

> 근거(실측): nkshop ajax 핸들러는 `return new ModelAndView(Globals.MAPPING_JACKSON_JSON_VIEW)`로 JSON 반환하는데 API_BODY_SIGNALS에 그 패턴이 없어 form 오분류 → INF 누락(UIS-PRD-002에서 5개 표면화, 잠재 다수).

- [ ] **Step 1: 실패 테스트 작성** (`scripts/tests/test_scan_source.js` 신규)

```javascript
// node scripts/tests/test_scan_source.js  로 실행 (assert 기반)
const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCAN = path.join(__dirname, '..', 'scan_source.js');

function scanFixture(javaSrc) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-scan-'));
  const ctrlDir = path.join(dir, 'src', 'main', 'java', 'app', 'product');
  fs.mkdirSync(ctrlDir, { recursive: true });
  fs.writeFileSync(path.join(ctrlDir, 'Pr205Controller.java'), javaSrc);
  cp.execFileSync('node', [SCAN, dir], { stdio: 'pipe' });
  const idx = JSON.parse(fs.readFileSync(path.join(dir, '_tmp', 'source_index.json'), 'utf-8'));
  return idx;
}

function test_jackson_json_view_is_api() {
  const src = `
@Controller
public class Pr205Controller {
  @RequestMapping(value="/app/product/prdreg/productImageDetails", method=RequestMethod.POST)
  public ModelAndView productImageDetails() {
    return new ModelAndView(Globals.MAPPING_JACKSON_JSON_VIEW);
  }
}`;
  const idx = scanFixture(src);
  const routes = (idx.routes || idx.files || []).flatMap(f => f.routes || []).concat(idx.routes || []);
  const hit = JSON.stringify(idx).includes('productImageDetails');
  assert.ok(hit, 'route 추출됨');
  // kind=api 여야 함 (JSON 뷰 반환)
  assert.ok(/"kind"\s*:\s*"api"[^}]*productImageDetails|productImageDetails[^}]*"kind"\s*:\s*"api"/.test(JSON.stringify(idx)) ||
            JSON.stringify(idx).match(/productImageDetails/) && JSON.stringify(idx).includes('"kind":"api"'),
            'productImageDetails가 api로 분류돼야 함');
}

if (require.main === module) {
  test_jackson_json_view_is_api();
  console.log('PASS test_jackson_json_view_is_api');
}
```

> 주의: scan_source의 산출 스키마(routes 위치)를 먼저 `node scan_source.js <dir>` 1회 실행해 확인하고, 위 assert의 경로 추출을 실제 스키마에 맞춰 조정한다(구현자가 스키마 확인 후 정확화).

- [ ] **Step 2: 실패 확인**

Run: `node scripts/tests/test_scan_source.js`
Expected: AssertionError (productImageDetails가 form으로 분류됨)

- [ ] **Step 3: API_BODY_SIGNALS 보강**

`scripts/scan_source.js` line 139:

```javascript
const API_BODY_SIGNALS = /GridResultUtil|AjaxMessageMapRenderer|ResponseEntity|MAPPING_JACKSON_JSON_VIEW|JSON_VIEW|jsonView|MappingJackson|new\s+ModelAndView\s*\(\s*[A-Za-z0-9_.]*[Jj]son/;
```

- [ ] **Step 4: 통과 확인**

Run: `node scripts/tests/test_scan_source.js`
Expected: PASS

- [ ] **Step 5: nkshop 실측 + 커밋**

Run: `node scripts/scan_source.js "D:\nkshop-bos\nkshop-bos-admin"` 후 `productImageDetails`/`productHopeQtyGrid`가 kind=api로 분류되는지 grep.

```bash
git add scripts/scan_source.js scripts/tests/test_scan_source.js
git commit -m "fix(scan): Jackson JSON-view 핸들러를 api로 분류(C-4, INF 누락 근절)"
```

### Task 2: @RequestMapping method= 속성 파싱 (H-3)

**Files:** Modify `scripts/scan_source.js`; Test `scripts/tests/test_scan_source.js`

- [ ] **Step 1: 실패 테스트 추가**

```javascript
function test_requestmapping_method_attr() {
  const src = `
@Controller
public class Pr205Controller {
  @RequestMapping(value="/app/product/x", method=RequestMethod.POST)
  public ModelAndView x() { return new ModelAndView("v"); }
}`;
  const idx = scanFixture(src);
  const s = JSON.stringify(idx);
  assert.ok(/"method"\s*:\s*"POST"/.test(s), 'method=POST가 파싱돼야 함 (ANY 아님)');
}
```
그리고 `if (require.main)` 블록에 `test_requestmapping_method_attr(); console.log('PASS ...');` 추가.

- [ ] **Step 2: 실패 확인**

Run: `node scripts/tests/test_scan_source.js`
Expected: FAIL — method=ANY로 기록됨

- [ ] **Step 3: 구현 — verb 결정 시 method 속성 우선**

scan_source.js에서 `@RequestMapping` → verb 결정부 2곳 수정:
- AST 경로(line ~254-255): verbMatch가 'Request'이고 어노테이션 텍스트에 `method=RequestMethod.XXX`가 있으면 그 XXX를 verb로.
- regex 경로(line ~369): `m[1] === 'Request' ? 'ANY' : ...`를, 어노테이션 원문에서 `method\s*=\s*RequestMethod\.(\w+)` 추출해 있으면 사용, 없으면 ANY.

공용 헬퍼 추가(파일 상단 유틸 영역):
```javascript
function verbFromRequestMapping(annotationText, fallback) {
  const m = /method\s*=\s*\{?\s*RequestMethod\.([A-Z]+)/.exec(annotationText || '');
  return m ? m[1] : fallback; // 복수 시 첫째
}
```
두 경로에서 `verb = (verbMatch[1]==='Request') ? verbFromRequestMapping(annoText, 'ANY') : verbMap[...]` 형태로 적용(annoText = 해당 어노테이션 원문 슬라이스).

- [ ] **Step 4: 통과 + nkshop 실측 + 커밋**

Run: `node scripts/tests/test_scan_source.js` → PASS. nkshop 재스캔 후 method=ANY 비율 감소 확인.

```bash
git add scripts/scan_source.js scripts/tests/test_scan_source.js
git commit -m "fix(scan): @RequestMapping method= 속성 파싱(H-3, ANY 남발 해소)"
```

---

## Phase B — 디스패치 견고성 (H-1, M-5)

### Task 3: 모델 한도 자동 폴백 + failed[] 정리

**Files:** Modify `scripts/dispatch_inf_gen.py`

> 근거: 이번 세션 포함 실제로 "weekly limit"으로 전 그룹 즉시 실패. haiku는 별도 쿼터(검증됨).

- [ ] **Step 1: 모델 env + 폴백 체인 도입**

`scripts/dispatch_inf_gen.py` 상단:
```python
import os
MODEL = os.environ.get("SL_DISPATCH_MODEL", "claude-sonnet-4-6")
FALLBACK_MODEL = os.environ.get("SL_DISPATCH_FALLBACK", "claude-haiku-4-5-20251001")
RATE_LIMIT_RE = re.compile(r"weekly limit|session limit|rate.?limit", re.I)
```
(`re` import 확인)

- [ ] **Step 2: 서브프로세스 출력에서 rate-limit 감지 → 폴백 재시도**

그룹 실행 함수에서 서브프로세스 결과(stdout+stderr)에 `RATE_LIMIT_RE` 매치 시, 같은 그룹을 `FALLBACK_MODEL`로 1회 재시도. 폴백도 실패면 failed 처리. (전역 1회 감지 후 이후 그룹은 처음부터 FALLBACK_MODEL 사용하도록 플래그 `_rate_limited=True`로 전환해 무의미한 sonnet 재시도 방지.)

- [ ] **Step 3: 성공 시 failed[]에서 제거 (M-5)**

그룹 성공 처리 지점에서 `status["failed"] = [x for x in status.get("failed", []) if x != i]` 추가(done과 상호배타 유지).

- [ ] **Step 4: 검증(드라이) + 커밋**

`SL_DISPATCH_MODEL` 미설정 시 기본 sonnet, 설정 시 반영되는지 `--limit 0` 또는 로그로 확인. (실제 rate-limit 재현은 어려우니 코드 경로 리뷰 + 로그 문구 확인.)

```bash
git add scripts/dispatch_inf_gen.py
git commit -m "feat(dispatch): rate-limit 자동 haiku 폴백 + 성공 시 failed[] 정리(H-1/M-5)"
```

---

## Phase C — 품질·견고성 (M-3, L-2) + 릴리즈

### Task 4: BAT 오탐 축소 (M-3)

**Files:** Modify `scripts/scan_source.js`

> 근거: `*Task*/*step*` Mapper가 배치로 오탐(product 14건 전부 오탐). 실제 배치는 스케줄러 시그널 보유.

- [ ] **Step 1: 배치 판정 보강**

BAT 후보 판정부에서:
1. Mapper/Model/Service/Controller 접미사 파일은 배치 후보에서 제외.
2. 스케줄러 시그널(`@Scheduled`, `implements Job`, `extends .*Scheduler`, `QuartzJobBean`) 있으면 가중(있으면 배치, 없고 이름 키워드만이면 후보에서 강등).

- [ ] **Step 2: nkshop 실측 + 커밋**

Run: nkshop 재스캔 → 배치 후보가 `common/batchmonitoring/**` 위주로 좁혀지고 `*Mapper`가 빠졌는지 확인.

```bash
git add scripts/scan_source.js
git commit -m "fix(scan): BAT 오탐 축소 — 스케줄러 시그널 가중 + Mapper/Service 제외(M-3)"
```

### Task 5: 인라인 파이썬 cp949 표준화 (L-2) + 동기화 + 버전

**Files:** Modify `skills/sl-recon/SKILL.md` 외 인라인 스니펫, `scripts/README.md`, `CLAUDE.md`, `.claude-plugin/plugin.json`

- [ ] **Step 1: reconfigure 누락 스니펫 보강**

Run: `grep -rn '!python' skills/ | head` 로 인라인 파이썬 스니펫 점검 → em-dash/한글 출력하는데 `sys.stdout.reconfigure(encoding='utf-8')` 누락된 곳에 상단 추가. (이미 있는 곳은 스킵)

- [ ] **Step 2: 동기화 + 버전**

scripts/README scan_source 항목에 "JSON-view api 분류·method 파싱·BAT 스케줄러 판정" 반영. dispatch_inf_gen에 "SL_DISPATCH_MODEL/폴백" 반영. plugin.json → `3.15.0`(SRS 재설계가 3.14면 그 다음, 아니면 조정). CLAUDE.md 노트: "RECON 실전 개선 잔여분 — C-4(JSON-view api)/H-3(method 파싱)/H-1(모델 폴백)/M-3(BAT)/M-5/L-2."

- [ ] **Step 3: 전체 검증 + 커밋**

Run: `node scripts/tests/test_scan_source.js && python -m pytest scripts/tests/ -q`

```bash
git add -A && git commit -m "docs: v3.15.0 RECON 실전 개선 잔여분 동기화 + 버전 bump"
```

---

## Self-Review
- C-4 → Task1 ✅, H-3 → Task2 ✅, H-1/M-5 → Task3 ✅, M-3 → Task4 ✅, L-2 → Task5 ✅.
- 이미 닫힘(C-1/2/3/5/6/7·H-2·M-4)은 범위 제외(상단 명시). M-1(dao/query)·L-4(MCP)는 별도.
- Placeholder: 없음(코드/명령 구체). 단 scan_source 산출 스키마 의존부(Task1 Step1)는 구현자가 1회 실행해 정확화하도록 명시(스키마 비공개라 불가피).
- 타입/상수 일관: SL_DISPATCH_MODEL/FALLBACK_MODEL/RATE_LIMIT_RE, verbFromRequestMapping. API_BODY_SIGNALS 단일 정규식 확장(중복 정의 없음 — line 139 1곳).
- 위험: scan_source 정규식 확장이 과탐(form을 api로) 유발 가능 → JSON-view 시그널은 명시적 토큰이라 과탐 낮음. nkshop 실측으로 확인(각 Task Step).
