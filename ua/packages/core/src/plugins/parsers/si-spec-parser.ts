import * as fs from "fs";
import * as path from "path";
import type { GraphNode, GraphEdge } from "../../types";

export interface SISpecParserOutput {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ---------------------------------------------------------------------------
// 스펙 체인: REQ → SRS → UIS → INF(인터페이스) → SCH
//           traces_to  traces_to  calls           reads_from
//
// 파싱용 3열 표 규약 (각 SoT 파일):
//   docs/01_RD/**/*.md       | REQ-F-001  | 이름          | 우선순위   |
//   docs/03_SRS/**/*.md      | SRS-F-001  | 이름          | REQ-F-001  |
//   docs/07_TC/**/*.md       | TC-F-001   | 이름          | REQ-F-001  |
//   docs/05_DDD/UI_Spec…     | UIS-F-001  | 화면명         | REQ-F-001  |
//   docs/05_DDD/API_Design…  | INF-001    | 엔드포인트·메소드 | REQ-F-001  |  ← 인터페이스 1건 = 메소드 1개
//   docs/05_DDD/screens/…   | UIS-F-001  | INF-001       |             ← UIS→INF calls 엣지
//   docs/05_DDD/DB_Schema…   | SCH-001    | 테이블명        | INF-001    |  ← INF→SCH reads_from
// ---------------------------------------------------------------------------

const DOCS = "docs";

const REQ_ROW_RE = /\|\s*(REQ-[A-Z]+-\d+)\s*\|([^|]+)\|/g;
const SRS_ROW_RE = /\|\s*(SRS-F-\d+)\s*\|([^|]+)\|\s*(REQ-[A-Z]+-\d+)\s*\|/g;
const TC_ROW_RE  = /\|\s*(TC-[A-Z]+-\d+)\s*\|([^|]+)\|\s*(REQ-[A-Z]+-\d+)\s*\|/g;
const UIS_ROW_RE = /\|\s*(UIS-F-\d+)\s*\|([^|]+)\|\s*(REQ-[A-Z]+-\d+)\s*\|/g;
/** INF(인터페이스) 색인: docs/05_DDD/API_Design.md
 *  행 형식: | INF-001 | POST /auth/login — 로그인 | REQ-F-001 |
 *  1행 = 1메소드(엔드포인트). 같은 파일에 여러 행 → 각각 개별 inf 노드 생성 */
const INF_ROW_RE = /\|\s*(INF-\d+)\s*\|([^|]+)\|\s*(REQ-[A-Z]+-\d+)\s*\|/g;
/** SCH 색인: docs/05_DDD/DB_Schema.md
 *  행 형식: | SCH-001 | users | INF-001 |  (3열 = 해당 테이블을 주로 사용하는 인터페이스 ID) */
const SCH_ROW_RE = /\|\s*(SCH-\d+)\s*\|([^|]+)\|\s*(INF-\d+)\s*\|/g;
/** UIS→INF 링크: screens/UIS-F-xxx.md § 사용 API 절 — 2열: | UIS-F-001 | INF-001 | */
const UIS_INF_ROW_RE = /\|\s*(UIS-F-\d+)\s*\|\s*(INF-\d+)\s*\|/g;

function makeNode(
  id: string,
  type: GraphNode["type"],
  name: string,
  filePath: string,
  reqId: string,
  linkedReqId?: string
): GraphNode {
  return {
    id,
    type,
    name: name.trim(),
    filePath,
    summary: `[${type.toUpperCase()}] ${name.trim()}`,
    tags: [type, reqId],
    complexity: "simple",
    siMeta: { reqId, linkedReqId },
  };
}

function collectMarkdownRelPaths(projectRoot: string, ...subdir: string[]): string[] {
  const absDir = path.join(projectRoot, ...subdir);
  if (!fs.existsSync(absDir)) return [];
  const absFiles: string[] = [];
  const walk = (dir: string) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.isFile() && ent.name.endsWith(".md")) absFiles.push(p);
    }
  };
  walk(absDir);
  return absFiles.map((abs) => path.relative(projectRoot, abs).split(path.sep).join("/"));
}

function sortWithPreferredFirst(relPaths: string[], preferredBasename: string): string[] {
  return [...relPaths].sort((a, b) => {
    const ba = path.basename(a);
    const bb = path.basename(b);
    if (ba === preferredBasename) return -1;
    if (bb === preferredBasename) return 1;
    return a.localeCompare(b);
  });
}

export function parseSISpecs(projectRoot: string): SISpecParserOutput {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  // ── REQ ─────────────────────────────────────────────────────────────────
  const rdFiles = sortWithPreferredFirst(collectMarkdownRelPaths(projectRoot, DOCS, "01_RD"), "RD_v1.0.md");
  const seenReq = new Set<string>();
  for (const rel of rdFiles) {
    const content = fs.readFileSync(path.join(projectRoot, rel), "utf-8");
    for (const match of content.matchAll(REQ_ROW_RE)) {
      const [, reqId, name] = match;
      if (reqId.startsWith("REQ-ID") || seenReq.has(reqId)) continue;
      seenReq.add(reqId);
      nodes.push(makeNode(`req:${reqId}`, "req", name.trim(), rel, reqId));
    }
  }

  // ── SRS ─────────────────────────────────────────────────────────────────
  const srsFiles = sortWithPreferredFirst(collectMarkdownRelPaths(projectRoot, DOCS, "03_SRS"), "SRS_v1.0.md");
  const seenSrs = new Set<string>();
  for (const rel of srsFiles) {
    const content = fs.readFileSync(path.join(projectRoot, rel), "utf-8");
    for (const match of content.matchAll(SRS_ROW_RE)) {
      const [, srsId, srsName, reqId] = match;
      if (srsId.startsWith("SRS-ID") || seenSrs.has(srsId)) continue;
      seenSrs.add(srsId);
      nodes.push(makeNode(`req:${srsId}`, "srs", srsName.trim(), rel, srsId, reqId));
      edges.push({ source: `req:${reqId}`, target: `req:${srsId}`, type: "traces_to", direction: "forward", weight: 0.9 });
    }
  }

  // ── TC ──────────────────────────────────────────────────────────────────
  const tcFiles = sortWithPreferredFirst(collectMarkdownRelPaths(projectRoot, DOCS, "07_TC"), "TC_v1.0.md");
  const seenTc = new Set<string>();
  for (const rel of tcFiles) {
    const content = fs.readFileSync(path.join(projectRoot, rel), "utf-8");
    for (const match of content.matchAll(TC_ROW_RE)) {
      const [, tcId, name, reqId] = match;
      if (tcId.startsWith("TC-ID") || seenTc.has(tcId)) continue;
      seenTc.add(tcId);
      nodes.push(makeNode(`req:${tcId}`, "tc", name.trim(), rel, tcId, reqId));
    }
  }

  // ── UIS ─────────────────────────────────────────────────────────────────
  const uisFiles = sortWithPreferredFirst(collectMarkdownRelPaths(projectRoot, DOCS, "05_DDD"), "UI_Spec_v1.0.md");
  const seenUis = new Set<string>();
  for (const rel of uisFiles) {
    const content = fs.readFileSync(path.join(projectRoot, rel), "utf-8");
    for (const match of content.matchAll(UIS_ROW_RE)) {
      const [, uisId, uisName, reqId] = match;
      if (uisId.startsWith("UIS-ID") || seenUis.has(uisId)) continue;
      seenUis.add(uisId);
      nodes.push(makeNode(`req:${uisId}`, "uis", uisName.trim(), rel, uisId, reqId));
      edges.push({ source: `req:${reqId}`, target: `req:${uisId}`, type: "traces_to", direction: "forward", weight: 0.85 });
    }
    // UIS→INF calls 엣지 (screens/ 또는 UI_Spec 내 2열 링크 섹션)
    for (const match of content.matchAll(UIS_INF_ROW_RE)) {
      const [, uisId, infId] = match;
      edges.push({ source: `req:${uisId}`, target: `req:${infId}`, type: "calls", direction: "forward", weight: 0.8 });
    }
  }

  // ── INF (인터페이스, API 명세 메소드 단위) ────────────────────────────────
  // SoT: docs/05_DDD/API_Design.md
  // 1행 = 1 HTTP 메소드/엔드포인트 = 1 INF 노드
  // 같은 파일에 복수 행 → 각각 개별 노드
  const infFiles = sortWithPreferredFirst(collectMarkdownRelPaths(projectRoot, DOCS, "05_DDD"), "API_Design.md");
  const seenInf = new Set<string>();
  for (const rel of infFiles) {
    const content = fs.readFileSync(path.join(projectRoot, rel), "utf-8");
    for (const match of content.matchAll(INF_ROW_RE)) {
      const [, infId, infName, reqId] = match;
      if (infId.startsWith("INF-ID") || seenInf.has(infId)) continue;
      seenInf.add(infId);
      nodes.push(makeNode(`req:${infId}`, "inf", infName.trim(), rel, infId, reqId));
      edges.push({ source: `req:${reqId}`, target: `req:${infId}`, type: "traces_to", direction: "forward", weight: 0.9 });
    }
  }

  // ── SCH (DB 테이블·스키마) ────────────────────────────────────────────────
  // SoT: docs/05_DDD/DB_Schema.md
  // 3열: | SCH-001 | users | INF-001 |  (주요 연결 인터페이스 ID)
  const schFiles = sortWithPreferredFirst(collectMarkdownRelPaths(projectRoot, DOCS, "05_DDD"), "DB_Schema.md");
  const seenSch = new Set<string>();
  for (const rel of schFiles) {
    const content = fs.readFileSync(path.join(projectRoot, rel), "utf-8");
    for (const match of content.matchAll(SCH_ROW_RE)) {
      const [, schId, schName, infId] = match;
      if (schId.startsWith("SCH-ID") || seenSch.has(schId)) continue;
      seenSch.add(schId);
      nodes.push(makeNode(`req:${schId}`, "sch", schName.trim(), rel, schId, infId));
      edges.push({ source: `req:${infId}`, target: `req:${schId}`, type: "reads_from", direction: "forward", weight: 0.8 });
    }
  }

  return { nodes, edges };
}
