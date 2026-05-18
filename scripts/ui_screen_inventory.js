#!/usr/bin/env node
/**
 * ui_screen_inventory.js — knowledge-graph.json에서 화면 후보를 뽑아 UIS-F 초안을 만든다.
 *
 * 사용법:
 *   node ui_screen_inventory.js [project-root]
 *   node ui_screen_inventory.js . --print-md          # UI_Spec에 붙일 3열 표 행만 stdout
 *   node ui_screen_inventory.js . --write-json       # docs/05_설계서/_ui_screen_inventory.json
 *   node ui_screen_inventory.js . --stubs            # docs/05_설계서/screens/UIS-F-XXX.md 스켈레톤 (없을 때만)
 *   node ui_screen_inventory.js . --write-json --stubs --print-md
 *
 * 화면 후보 규칙(경로 기준, POSIX):
 *   - Next app router: .../app/.../page.(tsx|jsx|ts|js) (루트 `app/page.tsx` 포함)
 *   - Next pages: .../pages/*.tsx|jsx|js (pages/api 제외, _app/_document 제외)
 *   - Vite/CRA 식: .../src/App.tsx|jsx → 단일 "App shell" 후보
 *   - 관례 views: .../views/*.tsx|jsx|vue → 라우트는 [추정] 주석
 *   - JSP: .../*.jsp
 *
 * REQ-ID는 그래프에 없으므로 3열 표에는 REQ-F-XXX 자리 표시자를 둔다 — RTM/RD 매핑 후 수동·에이전트 치환.
 */

"use strict";

const fs = require("fs");
const path = require("path");

let argv = process.argv.slice(2);
let projectRoot = process.cwd();
if (argv.length > 0 && !argv[0].startsWith("-")) {
  projectRoot = path.resolve(argv[0]);
  argv = argv.slice(1);
}
const args = new Set(argv.filter((a) => a.startsWith("-")));

const printMd = args.has("--print-md");
const writeJson = args.has("--write-json");
const stubs = args.has("--stubs");

const uaGraphPath = path.join(projectRoot, ".understand-anything", "knowledge-graph.json");
const outJson = path.join(projectRoot, "docs", "05_DDD", "_ui_screen_inventory.json");
const screensDir = path.join(projectRoot, "docs", "05_DDD", "screens");

function normalizeRel(p) {
  if (typeof p !== "string") return "";
  return p.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function filePathFromNode(n) {
  const fp = n.filePath || (typeof n.id === "string" && n.id.startsWith("file:") ? n.id.slice(5) : "");
  return normalizeRel(fp);
}

/** 레이어가 UI 성격인지 (이름·설명·id 휴리스틱) */
function isUiLikeLayer(layer) {
  const blob = `${layer.id || ""} ${layer.name || ""} ${layer.description || ""}`.toLowerCase();
  return /\b(ui|ux|presentation|frontend|view|screen|web|client|pages|portal)\b/.test(blob);
}

function inferRouteAndKind(rel) {
  const lower = rel.toLowerCase();
  if (/\.jsp$/i.test(rel)) {
    return {
      kind: "jsp",
      route: "",
      routeNote: "[추정] JSP·서버 매핑은 수동",
      title: path.basename(rel, path.extname(rel)),
    };
  }
  const appPage = rel.match(/(?:^|\/)app\/(.*)page\.(tsx|jsx|ts|js)$/i);
  if (appPage) {
    const inner = (appPage[1] || "").replace(/\/+$/, "");
    const route = inner ? "/" + inner.replace(/^\/+/, "").replace(/\/+/g, "/") : "/";
    const title = route === "/" ? "(app root)" : route;
    return { kind: "next-app-router", route, title };
  }
  const pagesFile = rel.match(/(?:^|\/)pages\/([^/]+)\.(tsx|jsx|ts|js)$/i);
  if (pagesFile) {
    const base = pagesFile[1];
    if (base === "_app" || base === "_document") return null;
    if (lower.includes("/pages/api/")) return null;
    const route = base === "index" ? "/" : "/" + base;
    return { kind: "next-pages-router", route, title: route };
  }
  const viewFile = rel.match(/(?:^|\/)views\/([^/]+)\.(tsx|jsx|vue)$/i);
  if (viewFile) {
    const base = viewFile[1].replace(/View$/i, "").replace(/Page$/i, "");
    return {
      kind: "spa-view",
      route: "",
      routeNote: `[추정] /${base} (라우터 설정 확인)`,
      title: base,
    };
  }
  if (/(?:^|\/)src\/App\.(tsx|jsx)$/i.test(rel)) {
    return {
      kind: "spa-shell",
      route: "/",
      title: "App shell",
    };
  }
  return null;
}

function humanTitle(route, basename, kind) {
  if (route && route !== "/") return route;
  if (kind === "jsp") return basename;
  return route || basename || "screen";
}

function collectScreenCandidates(graph) {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const layers = Array.isArray(graph.layers) ? graph.layers : [];

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const uiLayerIds = new Set();
  for (const layer of layers) {
    if (isUiLikeLayer(layer)) uiLayerIds.add(layer.id);
  }

  const inUiLayer = new Set();
  for (const layer of layers) {
    if (!isUiLikeLayer(layer)) continue;
    for (const nid of layer.nodeIds || []) {
      const n = nodeById.get(nid);
      if (n && n.type === "file") inUiLayer.add(filePathFromNode(n));
    }
  }

  const seen = new Set();
  const screens = [];

  for (const n of nodes) {
    if (n.type !== "file") continue;
    const rel = filePathFromNode(n);
    if (!rel || /node_modules|\/dist\/|\/build\/|\.test\.|\.spec\.|\/__tests__\//i.test(rel)) continue;

    const inferred = inferRouteAndKind(rel);
    if (!inferred) continue;
    if (seen.has(rel)) continue;
    seen.add(rel);

    const displayTitle =
      typeof inferred.title === "string" && inferred.title.trim()
        ? inferred.title.trim()
        : humanTitle(inferred.route, base.replace(/\.[^.]+$/, ""), inferred.kind);
    screens.push({
      primaryFile: rel,
      inferredRoute: inferred.route || "",
      routeNote: inferred.routeNote || "",
      kind: inferred.kind,
      title: displayTitle || base,
      summary: typeof n.summary === "string" ? n.summary : "",
      inUiLayer: inUiLayer.has(rel),
    });
  }

  screens.sort((a, b) => a.primaryFile.localeCompare(b.primaryFile));

  let i = 0;
  for (const s of screens) {
    i += 1;
    s.uisId = `UIS-F-${String(i).padStart(3, "0")}`;
  }

  return { screens, uiLayerIds: [...uiLayerIds] };
}

function mdTableRows(screens) {
  const lines = [];
  for (const s of screens) {
    const name = s.title || s.primaryFile;
    lines.push(`| ${s.uisId} | ${name} | REQ-F-XXX |`);
  }
  return lines.join("\n");
}

function stubMarkdown(s) {
  const routeCell = s.inferredRoute
    ? `\`${s.inferredRoute}\` (경로 규칙 추정)`
    : s.routeNote
      ? s.routeNote
      : "`—` (수동 입력)";

  return `---
uis_id: ${s.uisId}
doc_type: 화면 상세 (소스 기반 와이어)
version: 1.0
status: draft
linked_req: []
---

# ${s.uisId} — ${s.title}

> **자동 생성 스텁** — \`ui_screen_inventory.js --stubs\`. §2 와이어·§3·§4는 소스를 읽고 채운다. **3열 UIS 표는 넣지 않음** (\`UI_Spec_v1.0.md\` 전용).

---

## 1. 근거·라우트

| 항목 | 내용 |
|------|------|
| **근거 소스** | \`${s.primaryFile}\` |
| **진입 라우트·URL** | ${routeCell} |
| **화면 종류** | ${s.kind} |

${s.summary ? `**그래프 summary:** ${s.summary}\n` : ""}
---

## 2. 소스 기반 와이어 (ASCII)

\`\`\`
+------------------------------------------------------------------+
|  [BL-01] (미작성 — 위 근거 파일의 최상위 JSX/HTML 구조를 반영)   |
+------------------------------------------------------------------+
\`\`\`

---

## 3. 블록·구역 스키마

| Block-ID | 구역명 | 소스 힌트 | 비고 |
|----------|--------|-----------|------|
| — | — | — | 소스 분석 후 채움 |

---

## 4. 위젯·입력 목록

| 위젯 ID | 유형 | 라벨 | 액션 | 비고 |
|---------|------|------|------|------|
| — | — | — | — | — |

---

## 5. 상태·가드·빈 데이터

| 상태 | 소스 근거 | 화면 |
|------|-----------|------|
| — | — | — |

---

## 6. 미확인·보강 메모

- REQ-ID·SRS 연결: \`UI_Spec_v1.0.md\` 색인 표와 RTM 갱신 필요.
`;
}

function main() {
  if (args.has("--help") || args.has("-h")) {
    console.log(`Usage: node ui_screen_inventory.js [project-root] [--print-md] [--write-json] [--stubs]`);
    process.exit(0);
  }

  if (!fs.existsSync(uaGraphPath)) {
    console.error(`오류: ${uaGraphPath} 가 없습니다. 먼저 knowledge-graph를 생성하세요.`);
    process.exit(1);
  }

  let graph;
  try {
    graph = JSON.parse(fs.readFileSync(uaGraphPath, "utf-8"));
  } catch (e) {
    console.error("오류: knowledge-graph.json 파싱 실패", e.message);
    process.exit(1);
  }

  const { screens, uiLayerIds } = collectScreenCandidates(graph);
  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    sourceGraph: ".understand-anything/knowledge-graph.json",
    uiLayerIds,
    screens,
  };

  if (writeJson) {
    const ddd = path.join(projectRoot, "docs", "05_DDD");
    fs.mkdirSync(ddd, { recursive: true });
    fs.writeFileSync(outJson, JSON.stringify(payload, null, 2), "utf-8");
    console.error(`작성: ${path.relative(projectRoot, outJson)} (${screens.length} screens)`);
  }

  if (stubs) {
    fs.mkdirSync(screensDir, { recursive: true });
    let created = 0;
    let skipped = 0;
    for (const s of screens) {
      const name = `${s.uisId}.md`;
      const dest = path.join(screensDir, name);
      if (fs.existsSync(dest)) {
        skipped += 1;
        continue;
      }
      fs.writeFileSync(dest, stubMarkdown(s), "utf-8");
      created += 1;
    }
    console.error(`스텁: 생성 ${created}, 스킵(기존) ${skipped} → ${path.relative(projectRoot, screensDir)}/`);
  }

  if (printMd) {
    if (screens.length === 0) {
      console.log(
        "(화면 후보 없음 — app/.../page.tsx, pages/*.tsx, src/App.tsx, views/*, *.jsp 경로를 그래프에서 찾지 못함)"
      );
    } else {
      console.log(mdTableRows(screens));
    }
  }

  if (!writeJson && !stubs && !printMd) {
    console.error(`화면 후보: ${screens.length}건 (출력 옵션: --print-md, --write-json, --stubs)`);
    for (const s of screens.slice(0, 30)) {
      console.error(`  ${s.uisId}  ${s.primaryFile}`);
    }
    if (screens.length > 30) console.error(`  ... 외 ${screens.length - 30}건`);
  }
}

main();
