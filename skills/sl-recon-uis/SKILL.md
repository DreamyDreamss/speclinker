---
name: sl-recon-uis
description: RECON Phase-2 — 사용자가 메뉴로 화면을 띄우고 구조(탭·상태)를 지시하면, 그 화면을 라이브 캡처하고 소스를 읽어 SOP급 화면설계서(UIS)를 만드는 가이드형 대화 세션. /sl-recon 후(또는 독립) 실행.
triggers:
  - /sl-recon-uis
---

# /sl-recon-uis — SOP급 화면설계서 생성 (가이드형 대화 세션)

## 핵심 모델 (재설계 v2 — 2026-06-05)

**UIS는 "화면 열고 한 번 명령 → 산출"이 아니다.** 한 화면 안에서 **사용자가 구조·상태(탭/편집상태/제외/팝업)에 대한 의견을 주면 그에 맞춰 동작하는 대화 루프**다.

- **소스가 권위, 스크린샷은 보조.** 화면 구조·위젯·동작·권한은 *소스*(view + 동작 JS/컴포넌트)에서 확정. DOM 스냅샷·스크린샷은 위젯 골격·시각 자료.
- **역할 경계:** *화면을 문서화 상태로 만드는 것*(메뉴 진입·등록 누름·상품 선택·팝업 띄움 — 화면별 지식)은 **사용자**. *그 상태에서 캡처·탭 순회·소스 문서화*(기계적·범용)는 **에이전트**.
- **파서 아님:** ddd-ui-agent가 소스를 *읽어* 일반화한다(JSP `auth:button`이든 React `<Button>`이든). 프레임워크별 분기 코드 없음.

> 폐기됨: BFS 전수탐색, form URL goto 일괄캡처, 위젯 truncation (구 STEP 6-2/6-0-GOTO 전부).

### 출력 디렉토리 규약 (화면당 1 디렉토리)

```
docs/05_설계서/{domain}/UIS/UIS-{CODE}-{NNN}_{화면명}/
  spec.md                          ← 한 화면 = 한 문서 (탭은 §4 섹션)
  preview.png  preview_annotated.png   ← 대표/개요(마커)
  tabs/  tab1_{탭명}_annotated.png ...  ← 탭 자산(멀티탭일 때)
```
> **탭=섹션 vs 별도 UIS:** 탭이 독립 라우트 또는 독립 저장이면 별도 UIS, 아니면 한 화면의 §4 섹션. (저장 엔드포인트가 전 탭 파라미터를 모으면 한 화면.)

---

## 전제 조건

```bash
!cat project.env 2>/dev/null | grep -E 'PREVIEW_BASE_URL|PREVIEW_CDP_PORT|PLUGIN_PATH|SOURCE' || echo "project.env 확인 — /sl-init 먼저"
```

- `PREVIEW_BASE_URL` + 앱 구동 가능 → **인터랙티브 모드**(권장)
- 없음/앱 미구동 → **소스폴백 모드**(STEP U1 건너뜀 → STEP U2'')
- INF는 있어도 없어도 됨 — UIS를 먼저 만들고 나중에 `link_uis_inf`로 연결(조인키=raw 경로).

---

## STEP U1 — Chrome CDP + 로그인 (인터랙티브)

CDP 포트가 살아있지 않으면 디버그 프로파일 Chrome을 띄운다.

```bash
!python -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
import os, subprocess, sys, socket, time, platform, tempfile
try: sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except: pass
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8') if '=' in l and not l.startswith('#'))
port = env.get('PREVIEW_CDP_PORT','9222'); base = env.get('PREVIEW_BASE_URL','')
def alive(p):
    try: s=socket.create_connection(('localhost',int(p)),timeout=1); s.close(); return True
    except: return False
if alive(port):
    print('[OK] Chrome CDP '+port+' 이미 열림')
else:
    prof=os.path.join(tempfile.gettempdir(),'speclinker-chrome-debug'); plat=platform.system()
    if plat=='Windows':
        cands=[os.path.expandvars(r'%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe'),
               os.path.expandvars(r'%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe'),
               os.path.expandvars(r'%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe')]
        exe=next((p for p in cands if os.path.exists(p)),'chrome')
        subprocess.Popen('\"'+exe+'\" --remote-debugging-port='+port+' --user-data-dir=\"'+prof+'\" '+(base or 'about:blank'),shell=True)
    elif plat=='Darwin':
        subprocess.Popen(['open','-a','Google Chrome','--args','--remote-debugging-port='+port,'--user-data-dir='+prof])
    else:
        subprocess.Popen(['google-chrome','--remote-debugging-port='+port,'--user-data-dir='+prof])
    for _ in range(25):
        time.sleep(1)
        if alive(port): break
print('='*54); print(' Chrome에서 '+base+' 로그인 후 메뉴로 첫 화면을 띄우고'); print(' Claude에게 화면 이름과 함께 \"캡처해\" 라고 하세요.'); print('='*54)
"
```

> 사용자가 로그인 + **메뉴로 화면 진입** 후 말하면 STEP U2로.

---

## STEP U2 — 가이드형 세션 루프 (화면 1개씩)

> 이 STEP은 **대화 루프**다. 사용자가 화면을 띄우고 구조 의견을 줄 때마다 아래를 수행하고 다음 화면으로 반복한다.
> `$PLUGIN`=PLUGIN_PATH, `$PORT`=PREVIEW_CDP_PORT, `$SOURCE_ROOTS`=SOURCE_PATH[,SOURCE_2_PATH...].

### U2-1. 현재 화면 캡처 + 탭 검출 + 도메인 판정

사용자가 "캡처해"(또는 화면명 제시)하면:

```bash
!node "$PLUGIN/scripts/capture_screen_dom.js" --workspace=. --port=$PORT             # 현재 활성화면 캡처
!node "$PLUGIN/scripts/capture_screen_dom.js" --workspace=. --port=$PORT --list-tabs # 탭 검출
```

- 산출: `_tmp/captures/{screenId}/preview.png` + `dom_snapshot.json`, 탭 목록(JSON).
- **도메인 = activeRoute URL 세그먼트**(예: `/product/prdreg/...` → `product`). `docs/05_설계서/_domain_plan.json`에서 코드 조회, 없으면 임시 코드.
- **screenId** = 화면 프레임 URL 마지막 세그먼트(자동) 또는 사용자가 준 이름.

### U2-2. 사용자에게 구조 확인 (멀티탭/상태)

검출 결과를 알리고 **지시를 받는다**:
- 탭이 2개 이상이면:
  > "{N}개 탭 검출({탭명}). 탭 내용 캡처엔 **편집 상태**가 필요할 수 있어요(등록 누름/상품 선택). 상태를 만들고 어느 탭을 캡처할지 알려주세요(전체/일부/제외)."
- 사용자가 상태 설정 + 범위 지시("등록 눌렀어, 다 캡처해" / "가격탭만" / "팝업도 떴어")할 때까지 **대기**.

### U2-3. (멀티탭) 사용자 확정 탭 순회 캡처

사용자가 편집상태를 만들고 "됐어/캡처해" 하면, **확정 탭만** 순회:

```bash
# 사용자 지정 범위의 탭마다
!node "$PLUGIN/scripts/capture_screen_dom.js" --workspace=. --port=$PORT --tab-text="{탭명}" --suffix="_tab{N}" --screenId={screenId}
```

- 산출: `preview_tab{N}.png` + `dom_snapshot_tab{N}.json`. 탭 클릭·순회 자동, 편집상태는 사용자 설정. 검출 실패 시 사용자 탭클릭→"캡처" 수동 폴백.

### U2-4. 소스 슬라이스 수집

```bash
!python "$PLUGIN/scripts/collect_screen_slice.py" --workspace=. --screen-id={screenId} --route={route} --source-roots=$SOURCE_ROOTS
```

- 산출: `_tmp/captures/{screenId}/source_slice.json` (core=본체, related=팝업, endpointCandidates=raw 경로).

### U2-5. ddd-ui-agent 디스패치 → SOP급 UIS + 마커

`speclinker:ddd-ui-agent`를 호출한다(화면 1개 = 1호출):

```
subagent_type: "speclinker:ddd-ui-agent"
prompt: |
  화면ID: {screenId}
  라우트: {route}
  도메인: {domain}     도메인 코드: {CODE}
  UIS-ID: UIS-{CODE}-{NNN}
  캡처 디렉토리: _tmp/captures/{screenId}/   (preview.png, dom_snapshot.json, 멀티탭이면 *_tab{N}.*)
  탭 목록: {탭명 배열 — 사용자 확정 범위}
  소스 슬라이스: _tmp/captures/{screenId}/source_slice.json
  INF 디렉토리: docs/05_설계서/{domain}/INF/
  출력 디렉토리: docs/05_설계서/{domain}/UIS/UIS-{CODE}-{NNN}_{화면명}/
  워크스페이스: {절대경로}
```

에이전트가 소스 권위로 SOP급 UIS(§1 목적·§2 작업 시나리오·§3 블록·§4 위젯·액션[탭별 §4.{N}]·§5 권한·§6 데이터·anchors) 작성 + frontmatter `api_hints`(raw) + 마커(`preview[_tab{N}]_annotated.png`)를 출력 디렉토리에 생성.

### U2-6. 이 화면 즉시 INF 연결 (멱등·증분)

UIS 생성 직후 **그 화면만** 링크한다 — "끝" 신호 없이도 캡처할 때마다 자동 연결(그 화면의 INF가 이미 있으면 즉시 `[INF-ID]` 링크 + INF.screens 역기록, 없으면 패스).

```bash
!python "$PLUGIN/scripts/link_uis_inf.py" . --screen-id={screenId}
```

> `link_uis_inf`는 zero-LLM·멱등이라 화면마다 돌려도 안전하고, INF 미존재 시 raw 경로를 그대로 둔다(나중에 U3 전체 sweep에서 재연결).

### U2-7. 다음 화면

사용자가 다음 화면을 띄우고 지시하면 U2-1로 반복. **"끝/마무리"** 하면 STEP U3(전체 sweep)로.

---

## STEP U2'' — 소스폴백 (앱 미구동)

`PREVIEW_BASE_URL` 없거나 캡처 불가 시: 라이브 DOM 없이 진행.

```bash
!python "$PLUGIN/scripts/collect_screen_slice.py" --workspace=. --screen-id={screenId} --route={route} --source-roots=$SOURCE_ROOTS
```

`_tmp/screen_inventory_static.json`(/sl-recon STEP4)의 화면 목록을 사용자와 함께 선별 → 화면별 슬라이스 → ddd-ui-agent(소스폴백 모드: §0 스크린샷 생략, §4를 view 소스의 폼필드·버튼에서 도출).

---

## STEP U3 — 마무리: 전체 sweep (모든 UIS ↔ INF 재연결)

사용자가 **"끝/마무리"** 하면 실행. U2-6 증분 연결이 누락한 것(예: 나중에 만든 INF, 화면 간 공유 INF)을 **전 화면 일괄** 재연결한다.

```bash
!python "$PLUGIN/scripts/link_uis_inf.py" .
```

- UIS의 raw 경로(api_hints / §4·§6) × INF(method,path) 인덱스 → 연결 API를 INF-ID 링크로 치환.
- INF frontmatter `screens:`에 UIS-ID 역기록(양방향).
- **생성 순서 무관·멱등** — UIS 먼저든 INF 먼저든, INF 생기면 재실행으로 연결. (U2-6 증분 + U3 sweep 이중 안전망.)

---

## STEP U4 — SpecLens 인덱스 / IA 갱신

```bash
!python "$PLUGIN/scripts/gen_docsify.py" . 2>/dev/null; echo "SpecLens 인덱스 갱신"
```

`gen_docsify`가 `{domain}/UIS/{화면디렉토리}/spec.md`를 스캔(도메인별). `/sl-ia`로 IA_MAP 반영 가능.

---

## 완료 보고

```
생성 UIS: {N}개 ({도메인별})
멀티탭 화면: {화면}={탭수}
api_hints→INF 연결: {연결 수} (미연결 {수} = INF 미생성)
다음: /sl-recon-doc 또는 /sl-ia
```
