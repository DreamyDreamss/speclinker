import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { exec } from "node:child_process";

// Generate a one-time token when the server process starts.
// This token is printed to the terminal and must be in the URL
// to fetch knowledge-graph.json or diff-overlay.json.
const ACCESS_TOKEN = crypto.randomBytes(16).toString("hex");

export default defineConfig({
  // FIX 1 — bind only to localhost, not 0.0.0.0
  // This blocks access from any other device on the same LAN / WiFi.
  server: {
    host: "127.0.0.1",
    port: 5173,
    open: `/?token=${ACCESS_TOKEN}`,
  },

  resolve: {
    alias: {
      "@understand-anything/core/schema": path.resolve(__dirname, "../core/dist/schema.js"),
      "@understand-anything/core/search": path.resolve(__dirname, "../core/dist/search.js"),
      "@understand-anything/core/types": path.resolve(__dirname, "../core/dist/types.js"),
    },
  },

  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) {
            return "react-vendor";
          }
          if (id.includes("node_modules/@xyflow/")) return "xyflow";
          if (
            id.includes("node_modules/@dagrejs/") ||
            id.includes("node_modules/d3-force/")
          ) {
            return "graph-layout";
          }
          if (
            id.includes("node_modules/react-markdown/") ||
            id.includes("node_modules/hast-util-to-jsx-runtime/") ||
            /[\\/]node_modules[\\/](remark|rehype|mdast|hast|unist|micromark|decode-named-character-reference|property-information|space-separated-tokens|comma-separated-tokens|html-url-attributes|devlop|bail|ccount|character-entities|is-plain-obj|trim-lines|trough|unified|vfile|zwitch)/.test(id)
          ) {
            return "markdown";
          }
        },
      },
    },
  },

  plugins: [
    react(),
    tailwindcss(),
    {
      name: "serve-knowledge-graph",
      configureServer(server) {
        // Print the access URL once so the developer can open it.
        server.httpServer?.once("listening", () => {
          console.log(
            `\n  🔑  Dashboard URL: http://127.0.0.1:5173?token=${ACCESS_TOKEN}\n`
          );
        });

        server.middlewares.use((req, res, next) => {
          const url = new URL(req.url ?? "/", "http://127.0.0.1:5173");
          const pathname = url.pathname;
          const isProtectedEndpoint =
            pathname === "/knowledge-graph.json" ||
            pathname === "/domain-graph.json" ||
            pathname === "/diff-overlay.json" ||
            pathname === "/meta.json" ||
            pathname === "/si-graph.json" ||
            /^\/knowledge-graph-[a-zA-Z0-9_-]+\.json$/.test(pathname);

          if (!isProtectedEndpoint) {
            next();
            return;
          }

          // FIX 3 — require the one-time token on all data endpoints.
          // Requests without a matching ?token= get a 403.
          if (url.searchParams.get("token") !== ACCESS_TOKEN) {
            res.statusCode = 403;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Forbidden: missing or invalid token" }));
            return;
          }

          const labelMatch = pathname.match(/^\/knowledge-graph-([a-zA-Z0-9_-]+)\.json$/);
          const fileName = labelMatch
            ? `knowledge-graph-${labelMatch[1]}.json`
            : pathname === "/diff-overlay.json"
              ? "diff-overlay.json"
              : pathname === "/meta.json"
              ? "meta.json"
              : pathname === "/domain-graph.json"
              ? "domain-graph.json"
              : pathname === "/si-graph.json"
              ? "si-graph.json"
              : "knowledge-graph.json";

          const graphDir = process.env.GRAPH_DIR;
          if (!graphDir) {
            console.warn(
              "[speclinker] GRAPH_DIR not set — falling back to cwd. " +
              "Run via run-dashboard.ps1 / run-dashboard.sh to set it automatically."
            );
          }
          const candidates = [
            ...(graphDir
              ? [path.resolve(graphDir, `.understand-anything/${fileName}`)]
              : []),
            path.resolve(process.cwd(), `.understand-anything/${fileName}`),
          ];

          for (const candidate of candidates) {
            if (!fs.existsSync(candidate)) continue;

            // FIX 2 — sanitise absolute file paths before sending the JSON.
            // Nodes can contain filePath values like /Users/alice/company/src/auth.ts.
            // We convert those to relative paths (src/auth.ts) so the developer's
            // home directory and company directory layout are not leaked.
            try {
              const raw = JSON.parse(fs.readFileSync(candidate, "utf-8")) as {
                nodes?: Array<Record<string, unknown>>;
                [key: string]: unknown;
              };

              // Derive the project root from the candidate path so we can
              // make file paths relative to it.
              const projectRoot = path.dirname(
                candidate.replace(
                  `${path.sep}.understand-anything${path.sep}${fileName}`,
                  ""
                )
              );

              if (Array.isArray(raw.nodes)) {
                raw.nodes = raw.nodes.map((node) => {
                  if (typeof node.filePath !== "string") return node;
                  const abs = node.filePath;
                  // Only relativise paths that actually sit inside projectRoot.
                  // Leave external or already-relative paths untouched.
                  const rel = abs.startsWith(projectRoot)
                    ? abs.slice(projectRoot.length).replace(/^[\\/]/, "")
                    : path.isAbsolute(abs)
                    ? path.basename(abs) // absolute but outside root — use filename only
                    : abs;              // already relative — keep as-is
                  return { ...node, filePath: rel };
                });
              }

              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify(raw));
            } catch (err) {
              // If we cannot parse or sanitise the file, refuse to serve it
              // rather than accidentally leaking raw content.
              console.error("[understand-anything] Failed to sanitise graph file:", err);
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "Failed to read graph file" }));
            }
            return;
          }

          // No matching file found on disk.
          res.statusCode = 404;
          if (pathname === "/knowledge-graph.json") {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "No knowledge graph found. Run /understand first." }));
          } else {
            res.end();
          }
        });
      },
    },
    {
      name: "speclinker-api",
      configureServer(server) {
        const sseClients: Set<import("http").ServerResponse> = new Set();

        // 파일 변경 감시 → SSE 브로드캐스트 (docs/ 전체 + .understand-anything)
        const graphDir = process.env.GRAPH_DIR || process.cwd();
        const watchPaths = [
          path.join(graphDir, ".understand-anything"),
          path.join(graphDir, "docs"),
          path.join(graphDir, "_tmp"),
        ];

        for (const wp of watchPaths) {
          if (fs.existsSync(wp)) {
            fs.watch(wp, { recursive: true }, (eventType: string, filename: string | null) => {
              if (!filename?.endsWith(".json") && !filename?.endsWith(".md")) return;
              const msg = JSON.stringify({ type: "file-changed", path: filename });
              for (const client of sseClients) {
                client.write(`data: ${msg}\n\n`);
              }
            });
          }
        }

        server.middlewares.use((req, res, next) => {
          const url = new URL(req.url ?? "/", "http://127.0.0.1:5173");

          // SSE endpoint
          if (url.pathname === "/api/events") {
            res.setHeader("Content-Type", "text/event-stream");
            res.setHeader("Cache-Control", "no-cache");
            res.setHeader("Connection", "keep-alive");
            res.write('data: {"type":"connected"}\n\n');
            sseClients.add(res);
            req.on("close", () => sseClients.delete(res));
            return;
          }

          // Command execution endpoint
          if (url.pathname === "/api/run" && req.method === "POST") {
            let body = "";
            req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
            req.on("end", () => {
              try {
                const { command } = JSON.parse(body) as { command: string };

                const ALLOWED = [
                  /^\/sl-spec(\s|$)/,
                  /^\/sl-dev(\s|$)/,
                  /^\/sl-test(\s|$)/,
                  /^\/sl-init(\s|$)/,
                  /^node\s+.*ua_req_bridge\.js/,
                  /^bash\s+.*req_scan\.sh/,
                ];
                if (!ALLOWED.some(r => r.test(command.trim()))) {
                  res.statusCode = 403;
                  res.end(JSON.stringify({ error: `허용되지 않은 커맨드: ${command}` }));
                  return;
                }

                const cwd = process.env.GRAPH_DIR || process.cwd();
                const proc = exec(`claude ${command}`, { cwd });
                const runId = Date.now().toString();

                proc.stdout?.on("data", (data: string) => {
                  const msg = JSON.stringify({ type: "log", runId, stream: "stdout", data });
                  for (const client of sseClients) client.write(`data: ${msg}\n\n`);
                });
                proc.stderr?.on("data", (data: string) => {
                  const msg = JSON.stringify({ type: "log", runId, stream: "stderr", data });
                  for (const client of sseClients) client.write(`data: ${msg}\n\n`);
                });
                proc.on("close", (code: number | null) => {
                  const msg = JSON.stringify({ type: "done", runId, code });
                  for (const client of sseClients) client.write(`data: ${msg}\n\n`);
                });

                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ runId, status: "started" }));
              } catch (e) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: String(e) }));
              }
            });
            return;
          }

          // docs/ 트리 반환
          if (url.pathname === "/api/docs-tree") {
            const graphDir2 = process.env.GRAPH_DIR || process.cwd();
            const docsRoot  = path.join(graphDir2, "docs");

            type TreeEntry = { type: "file"; name: string; path: string }
                           | { type: "dir";  name: string; label?: string; icon?: string; children: TreeEntry[] };

            const DIR_META: Record<string, { label: string; icon: string }> = {
              "01_요구사항정의서":   { label: "요구사항 정의서 (RD)",  icon: "📋" },
              "02_추적표":           { label: "추적 매트릭스 (RTM)",   icon: "🔗" },
              "03_기능명세서":       { label: "기능 명세서 (SRS)",     icon: "📝" },
              "04_아키텍처설계서":   { label: "아키텍처 설계서 (SAD)", icon: "🏗️" },
              "05_설계서":           { label: "상세 설계 (DDD)",       icon: "📐" },
              "07_테스트케이스":     { label: "테스트케이스 (TC)",     icon: "🧪" },
              "08_테스트결과보고서": { label: "테스트 결과 (TR)",      icon: "📊" },
              "변경관리":            { label: "변경 관리 (SR)",        icon: "🔁" },
              // legacy English names — kept for backward compatibility
              "01_RD":   { label: "요구사항 정의서 (RD)",  icon: "📋" },
              "02_RTM":  { label: "추적 매트릭스 (RTM)",   icon: "🔗" },
              "03_SRS":  { label: "기능 명세서 (SRS)",     icon: "📝" },
              "04_SAD":  { label: "아키텍처 설계서 (SAD)", icon: "🏗️" },
              "05_DDD":  { label: "상세 설계 (DDD)",       icon: "📐" },
              "07_TC":   { label: "테스트케이스 (TC)",     icon: "🧪" },
              "08_TR":   { label: "테스트 결과 (TR)",      icon: "📊" },
            };

            function buildTree(dir: string, relBase: string): TreeEntry[] {
              if (!fs.existsSync(dir)) return [];
              const entries = fs.readdirSync(dir, { withFileTypes: true });
              const result: TreeEntry[] = [];
              // 디렉터리 먼저, 그 다음 파일 순으로 정렬
              const dirs  = entries.filter(e => e.isDirectory() && !e.name.startsWith("."));
              const files = entries.filter(e => e.isFile()      && e.name.endsWith(".md") && !e.name.startsWith("."));
              for (const e of dirs) {
                const children = buildTree(path.join(dir, e.name), `${relBase}/${e.name}`);
                if (children.length > 0) result.push({ type: "dir", name: e.name, children });
              }
              for (const e of files) {
                result.push({ type: "file", name: e.name, path: `${relBase}/${e.name}` });
              }
              return result;
            }

            if (!fs.existsSync(docsRoot)) {
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify([]));
              return;
            }

            const rawTree = buildTree(docsRoot, "docs");
            // 최상위 레이어에 label/icon 주입
            const enriched = rawTree.map(node =>
              node.type === "dir" && DIR_META[node.name]
                ? { ...node, ...DIR_META[node.name] }
                : node
            );

            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(enriched));
            return;
          }

          // 소스 라벨 목록 (project.env의 SOURCE_N_LABEL 읽기)
          if (url.pathname === "/api/source-labels") {
            const graphDir2 = process.env.GRAPH_DIR || process.cwd();
            const envPath = path.join(graphDir2, "project.env");
            const labels: string[] = [];
            const labelPaths: Record<string, string> = {};
            if (fs.existsSync(envPath)) {
              const env: Record<string, string> = {};
              for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
                const m = line.trim().match(/^([A-Z0-9_]+)=(.*)$/);
                if (m) env[m[1]] = m[2];
              }
              const count = parseInt(env.SOURCE_COUNT || "0", 10);
              for (let i = 1; i <= count; i++) {
                const label = env[`SOURCE_${i}_LABEL`];
                const srcPath = env[`SOURCE_${i}_PATH`];
                if (label) {
                  labels.push(label);
                  if (srcPath) labelPaths[label] = srcPath;
                }
              }
            }
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ labels, labelPaths }));
            return;
          }

          // MCP 연결 상태 (_tmp/mcp_status.json)
          if (url.pathname === "/api/mcp-status") {
            const graphDir2 = process.env.GRAPH_DIR || process.cwd();
            const mcpPath = path.join(graphDir2, "_tmp", "mcp_status.json");
            res.setHeader("Content-Type", "application/json");
            res.end(fs.existsSync(mcpPath) ? fs.readFileSync(mcpPath, "utf-8") : "{}");
            return;
          }

          // Recon 진행 상황 (docs/05_설계서/ 도메인별 파일 카운트)
          if (url.pathname === "/api/recon-progress") {
            const graphDir2 = process.env.GRAPH_DIR || process.cwd();
            const designDir = path.join(graphDir2, "docs", "05_설계서");
            type ProgressEntry = { domain: string; infCount: number; schCount: number; uiCount: number };
            const result: ProgressEntry[] = [];
            if (fs.existsSync(designDir)) {
              const domains = fs.readdirSync(designDir, { withFileTypes: true })
                .filter(e => e.isDirectory() && !e.name.startsWith("_"))
                .map(e => e.name);
              for (const domain of domains) {
                const domainPath = path.join(designDir, domain);
                const topFiles = fs.readdirSync(domainPath).filter(f => f.endsWith(".md"));
                const infSubDir = path.join(domainPath, "INF");
                const infSubFiles = fs.existsSync(infSubDir)
                  ? fs.readdirSync(infSubDir).filter(f => f.endsWith(".md"))
                  : [];
                const uiSubDir2 = path.join(domainPath, "UI");
                const uiSubCount = fs.existsSync(uiSubDir2)
                  ? fs.readdirSync(uiSubDir2, { withFileTypes: true })
                      .filter(e => e.isDirectory() && fs.existsSync(path.join(uiSubDir2, e.name, "spec.md"))).length
                  : 0;
                result.push({
                  domain,
                  infCount: topFiles.filter(f => /^INF-\d+/.test(f)).length + infSubFiles.filter(f => /^INF-\d+/.test(f)).length,
                  schCount: topFiles.filter(f => /^SCH-\d+/.test(f) || /^DB_/.test(f)).length,
                  uiCount:  topFiles.filter(f => /^UIS-F-\d+/.test(f) || /^UI_/.test(f)).length + uiSubCount,
                });
              }
            }
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(result));
            return;
          }

          // IA 맵 (ia_map_builder.py 출력)
          if (url.pathname === "/api/ia-map") {
            const graphDir2 = process.env.GRAPH_DIR || process.cwd();
            const iaMapPath = path.join(graphDir2, "_tmp", "ia-map.json");
            res.setHeader("Content-Type", "application/json");
            if (fs.existsSync(iaMapPath)) {
              res.end(fs.readFileSync(iaMapPath, "utf-8"));
            } else {
              res.end(JSON.stringify({ domains: [], matrix: { screens: [], apis: [], links: [] }, totalScreens: 0, totalApis: 0 }));
            }
            return;
          }

          // UIS 화면 목록
          if (url.pathname === "/api/uis-list") {
            const graphDir2 = process.env.GRAPH_DIR || process.cwd();
            const designDir = path.join(graphDir2, "docs", "05_설계서");

            type UISEntry = {
              uisId: string; domain: string; path: string;
              previewHtmlPath?: string; previewPngPath?: string;
            };

            const getPreviewPaths = (domName: string, uisNum: string): Partial<UISEntry> => {
              const base = `docs/05_설계서/${domName}/UIS-F-${uisNum}`;
              const baseAbs = path.join(graphDir2, base);
              return {
                ...(fs.existsSync(path.join(baseAbs, "preview.html")) ? { previewHtmlPath: `${base}/preview.html` } : {}),
                ...(fs.existsSync(path.join(baseAbs, "preview.png")) ? { previewPngPath: `${base}/preview.png` } : {}),
              };
            };

            const inventoryPath = path.join(graphDir2, "_tmp", "screen_inventory.json");
            if (fs.existsSync(inventoryPath)) {
              try {
                const items = JSON.parse(fs.readFileSync(inventoryPath, "utf-8")) as UISEntry[];
                const enriched = items.map(item => {
                  if (item.previewHtmlPath || item.previewPngPath) return item;
                  const m = item.uisId.match(/^UIS-F-(\d+)$/);
                  if (!m) return item;
                  return { ...item, ...getPreviewPaths(item.domain, m[1]) };
                });
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify(enriched));
                return;
              } catch { /* fall through to scan */ }
            }

            // fallback: docs/ 스캔 (flat 파일 + 디렉터리 구조 모두 지원)
            const uiFiles: UISEntry[] = [];
            if (fs.existsSync(designDir)) {
              for (const d of fs.readdirSync(designDir, { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith("_"))) {
                const domainDir = path.join(designDir, d.name);
                const domEntries = fs.readdirSync(domainDir, { withFileTypes: true });

                // 평탄 파일: UIS-F-NNN.md
                for (const e of domEntries.filter(e => e.isFile() && e.name.endsWith(".md"))) {
                  const m = e.name.match(/^UIS-F-(\d+)/);
                  if (!m) continue;
                  uiFiles.push({ uisId: `UIS-F-${m[1]}`, domain: d.name, path: `docs/05_설계서/${d.name}/${e.name}`, ...getPreviewPaths(d.name, m[1]) });
                }

                // 디렉터리 구조: UIS-F-NNN/spec.md
                for (const e of domEntries.filter(e => e.isDirectory())) {
                  const m = e.name.match(/^UIS-F-(\d+)$/);
                  if (!m) continue;
                  if (uiFiles.some(u => u.uisId === `UIS-F-${m[1]}` && u.domain === d.name)) continue;
                  if (!fs.existsSync(path.join(domainDir, e.name, "spec.md"))) continue;
                  uiFiles.push({ uisId: `UIS-F-${m[1]}`, domain: d.name, path: `docs/05_설계서/${d.name}/${e.name}/spec.md`, ...getPreviewPaths(d.name, m[1]) });
                }

                // GENESIS 통합 파일: UI_{domain}.md
                for (const e of domEntries.filter(e => e.isFile() && /^UI_/.test(e.name) && e.name.endsWith(".md"))) {
                  if (uiFiles.some(u => u.uisId === `UIS-${d.name}` && u.domain === d.name)) continue;
                  uiFiles.push({ uisId: `UIS-${d.name}`, domain: d.name, path: `docs/05_설계서/${d.name}/${e.name}` });
                }

                // RECON 서브 디렉터리: UI/{screenId}/spec.md
                const uiSubDir = path.join(domainDir, "UI");
                if (fs.existsSync(uiSubDir)) {
                  for (const e of fs.readdirSync(uiSubDir, { withFileTypes: true }).filter(e => e.isDirectory())) {
                    const screenId = e.name;
                    if (uiFiles.some(u => u.uisId === screenId && u.domain === d.name)) continue;
                    const specPath = path.join(uiSubDir, screenId, "spec.md");
                    if (!fs.existsSync(specPath)) continue;
                    const previewHtmlPath = fs.existsSync(path.join(uiSubDir, screenId, "preview.html"))
                      ? `docs/05_설계서/${d.name}/UI/${screenId}/preview.html` : undefined;
                    const previewPngPath = fs.existsSync(path.join(uiSubDir, screenId, "preview.png"))
                      ? `docs/05_설계서/${d.name}/UI/${screenId}/preview.png` : undefined;
                    uiFiles.push({
                      uisId: screenId,
                      domain: d.name,
                      path: `docs/05_설계서/${d.name}/UI/${screenId}/spec.md`,
                      ...(previewHtmlPath ? { previewHtmlPath } : {}),
                      ...(previewPngPath ? { previewPngPath } : {}),
                    });
                  }
                }
              }
            }
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(uiFiles));
            return;
          }

          // INF API 목록
          if (url.pathname === "/api/inf-list") {
            const graphDir2 = process.env.GRAPH_DIR || process.cwd();
            const designDir = path.join(graphDir2, "docs", "05_설계서");
            type INFEntry = { infId: string; domain: string; path: string };
            const infFiles: INFEntry[] = [];
            if (fs.existsSync(designDir)) {
              for (const d of fs.readdirSync(designDir, { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith("_"))) {
                for (const f of fs.readdirSync(path.join(designDir, d.name)).filter(f => f.endsWith(".md"))) {
                  const mInd = f.match(/^INF-(\d+)/);
                  if (mInd) {
                    infFiles.push({ infId: `INF-${mInd[1]}`, domain: d.name, path: `docs/05_설계서/${d.name}/${f}` });
                    continue;
                  }
                  // GENESIS 통합 파일: API_{domain}.md
                  if (/^API_/.test(f)) {
                    infFiles.push({ infId: `INF-${d.name}`, domain: d.name, path: `docs/05_설계서/${d.name}/${f}` });
                  }
                  // 통합 API_Design.md (Phase C 집계 파일)
                  if (f === "API_Design.md") {
                    infFiles.push({ infId: `INF-${d.name}-design`, domain: d.name, path: `docs/05_설계서/${d.name}/${f}` });
                  }
                }
                // RECON 서브 디렉터리: docs/05_설계서/{domain}/INF/INF-NNN.md
                const infSubDir2 = path.join(designDir, d.name, "INF");
                if (fs.existsSync(infSubDir2)) {
                  for (const f of fs.readdirSync(infSubDir2).filter(f => f.endsWith(".md"))) {
                    const mInd = f.match(/^INF-(\d+)/);
                    if (mInd) {
                      infFiles.push({ infId: `INF-${mInd[1]}`, domain: d.name, path: `docs/05_설계서/${d.name}/INF/${f}` });
                    }
                  }
                }
              }
              // 루트 레벨 API_Design.md
              const rootApiDesign = path.join(designDir, "API_Design.md");
              if (fs.existsSync(rootApiDesign)) {
                infFiles.push({ infId: "INF-all", domain: "전체", path: "docs/05_설계서/API_Design.md" });
              }
            }
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(infFiles));
            return;
          }

          // SRS 기능명세 목록
          if (url.pathname === "/api/srs-list") {
            const graphDir2 = process.env.GRAPH_DIR || process.cwd();
            type SRSEntry = { srsId: string; domain: string; path: string; title?: string };
            const srsFiles: SRSEntry[] = [];
            const SRS_DIRS = ["docs/03_기능명세서", "docs/03_SRS"];
            for (const srsRelDir of SRS_DIRS) {
              const srsDir = path.join(graphDir2, ...srsRelDir.split("/"));
              if (!fs.existsSync(srsDir)) continue;

              const scanDir = (dir: string, relBase: string) => {
                for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                  if (entry.isDirectory()) {
                    scanDir(path.join(dir, entry.name), `${relBase}/${entry.name}`);
                    continue;
                  }
                  if (!entry.name.endsWith(".md")) continue;
                  const relPath = `${relBase}/${entry.name}`;
                  // SRS_v1.0.md / SRS_v*.md → 전체 색인
                  if (/^SRS_v/.test(entry.name)) {
                    srsFiles.push({ srsId: "SRS-all", domain: "전체", path: relPath, title: "SRS 전체 색인" });
                    continue;
                  }
                  // SRS_{domain}.md → 도메인 명세
                  const mDomain = entry.name.match(/^SRS_(.+)\.md$/);
                  if (mDomain) {
                    srsFiles.push({ srsId: `SRS-${mDomain[1]}`, domain: mDomain[1], path: relPath });
                    continue;
                  }
                  // SRS-F-NNN.md → 개별 SRS 항목
                  const mInd = entry.name.match(/^(SRS-F-\d+)/);
                  if (mInd) {
                    srsFiles.push({ srsId: mInd[1], domain: relBase.split("/").pop() ?? "공통", path: relPath });
                  }
                }
              };
              scanDir(srsDir, srsRelDir);
              if (srsFiles.length > 0) break; // 첫 번째 존재 디렉터리만 사용
            }
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(srsFiles));
            return;
          }

          // 프리뷰 파일 서빙 (HTML/PNG — preview.html, preview.png)
          if (url.pathname === "/preview") {
            const relPath = url.searchParams.get("path");
            if (!relPath || relPath.includes("..")) {
              res.statusCode = 400;
              res.end("Invalid path");
              return;
            }
            const graphDir2 = process.env.GRAPH_DIR || process.cwd();
            const absPath = path.join(graphDir2, relPath);
            if (!fs.existsSync(absPath)) {
              res.statusCode = 404;
              res.end("File not found");
              return;
            }
            const ext = path.extname(absPath).toLowerCase();
            const contentType = ext === ".html" ? "text/html; charset=utf-8"
              : ext === ".png" ? "image/png"
              : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg"
              : "application/octet-stream";
            res.setHeader("Content-Type", contentType);
            res.end(fs.readFileSync(absPath));
            return;
          }

          // RTM 파싱 — REQ-ID별 연결 산출물 구조화
          if (url.pathname === "/api/rtm-parsed") {
            const graphDir2 = process.env.GRAPH_DIR || process.cwd();
            const rtmDir = path.join(graphDir2, "docs", "02_추적표");
            type REQEntry = {
              id: string; title: string;
              srs: string[]; inf: string[]; sch: string[]; uis: string[]; tc: string[];
            };
            const byId: Record<string, REQEntry> = {};

            const extractIds = (text: string, re: RegExp): string[] =>
              [...new Set([...(text.match(re) ?? [])])];

            const merge = (existing: REQEntry, srs: string[], inf: string[], sch: string[], uis: string[], tc: string[]) => {
              existing.srs = [...new Set([...existing.srs, ...srs])];
              existing.inf = [...new Set([...existing.inf, ...inf])];
              existing.sch = [...new Set([...existing.sch, ...sch])];
              existing.uis = [...new Set([...existing.uis, ...uis])];
              existing.tc  = [...new Set([...existing.tc,  ...tc ])];
            };

            if (fs.existsSync(rtmDir)) {
              for (const file of fs.readdirSync(rtmDir).filter(f => /RTM.*\.md$/.test(f))) {
                const lines = fs.readFileSync(path.join(rtmDir, file), "utf-8").split("\n");
                let sectionReqId: string | null = null;

                for (const line of lines) {
                  // 섹션 헤더에서 REQ-ID 추출 (## REQ-F-001 형식)
                  const headerReq = line.match(/^#{1,3}\s+(REQ-[A-Z]+-\d+)[:\s]*(.*)/);
                  if (headerReq) { sectionReqId = headerReq[1]; continue; }

                  // 테이블 행에서 추출
                  if (!line.includes("|")) { if (/^#{1,3}\s/.test(line)) sectionReqId = null; continue; }
                  if (/^[\s|:-]+$/.test(line)) continue;

                  const cells = line.split("|").map(c => c.trim()).filter(Boolean);
                  const rowText = cells.join(" ");
                  const reqInRow = rowText.match(/\b(REQ-[A-Z]+-\d+)\b/);
                  const reqId = reqInRow?.[1] ?? sectionReqId;
                  if (!reqId) continue;

                  const srs = extractIds(rowText, /\bSRS-[A-Z]+-\d+\b/g);
                  const inf = extractIds(rowText, /\bINF-\d+\b/g);
                  const sch = extractIds(rowText, /\bSCH-\d+\b/g);
                  const uis = extractIds(rowText, /\bUIS-F-\d+\b/g);
                  const tc  = extractIds(rowText, /\bTC-[A-Z]+-\d+\b/g);

                  if (byId[reqId]) {
                    merge(byId[reqId], srs, inf, sch, uis, tc);
                  } else {
                    const title = reqInRow ? (cells[1] ?? "") : "";
                    byId[reqId] = { id: reqId, title, srs, inf, sch, uis, tc };
                  }
                }
              }
            }

            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(Object.values(byId).sort((a, b) => a.id.localeCompare(b.id))));
            return;
          }

          // linked_req 주석 스캔 — 소스 → REQ 역인덱스
          if (url.pathname === "/api/req-impl-map") {
            const graphDir2 = process.env.GRAPH_DIR || process.cwd();
            const envPath = path.join(graphDir2, "project.env");
            const sourceDirs: string[] = [];

            if (fs.existsSync(envPath)) {
              const env2: Record<string, string> = {};
              for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
                const m = line.trim().match(/^([A-Z0-9_]+)=(.*)$/);
                if (m) env2[m[1]] = m[2];
              }
              const count = parseInt(env2.SOURCE_COUNT ?? "0", 10);
              for (let i = 1; i <= count; i++) {
                const p = env2[`SOURCE_${i}_PATH`];
                if (p && fs.existsSync(p)) sourceDirs.push(p);
              }
            }
            // generated source
            const codeDir = path.join(graphDir2, "docs", "06_소스코드");
            if (fs.existsSync(codeDir)) sourceDirs.push(codeDir);

            const result: Record<string, Array<{file: string; line: number; label: string}>> = {};
            const EXTS = new Set([".java", ".kt", ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".cs", ".php", ".rb", ".swift", ".rs"]);
            const SKIP = new Set(["node_modules", ".git", "dist", "build", "__pycache__", ".gradle", "target", "vendor", ".next"]);
            let scanned = 0;

            const doScan = (dir: string, label: string) => {
              if (scanned > 8000) return;
              let entries: import("fs").Dirent[];
              try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
              catch { return; }

              for (const e of entries) {
                const fp = path.join(dir, e.name);
                if (e.isDirectory()) {
                  if (!SKIP.has(e.name)) doScan(fp, label);
                } else if (EXTS.has(path.extname(e.name).toLowerCase())) {
                  scanned++;
                  try {
                    const lines = fs.readFileSync(fp, "utf-8").split("\n");
                    lines.forEach((line, idx) => {
                      const re = /linked[_\s]req[:\s]+([A-Z0-9\-,\s]+)/gi;
                      let m: RegExpExecArray | null;
                      while ((m = re.exec(line)) !== null) {
                        const ids = m[1].split(/[,\s]+/)
                          .map(s => s.trim())
                          .filter(s => /^REQ-[A-Z]+-\d+$/.test(s));
                        for (const id of ids) {
                          if (!result[id]) result[id] = [];
                          result[id].push({ file: path.relative(dir, fp).replace(/\\/g, "/"), line: idx + 1, label });
                        }
                      }
                    });
                  } catch { /* skip */ }
                }
              }
            };

            for (const dir of sourceDirs) {
              doScan(dir, path.basename(dir));
            }

            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(result));
            return;
          }

          // FUNC_MAP 파싱 — RECON 모드 FUNC-ID별 연결 구조화
          if (url.pathname === "/api/func-map") {
            const graphDir2 = process.env.GRAPH_DIR || process.cwd();
            type FUNCEntry = {
              id: string; description: string;
              srs: string[]; inf: string[]; sch: string[]; uis: string[];
            };
            const byId: Record<string, FUNCEntry> = {};

            const extractFuncIds = (text: string, re: RegExp) =>
              [...new Set([...(text.match(re) ?? [])])];

            // docs/00_FUNC/FUNC_MAP.md 파싱
            const funcMapPath = path.join(graphDir2, "docs", "00_FUNC", "FUNC_MAP.md");
            if (fs.existsSync(funcMapPath)) {
              const lines = fs.readFileSync(funcMapPath, "utf-8").split("\n");
              let sectionFuncId: string | null = null;
              for (const line of lines) {
                const headerFunc = line.match(/^#{1,3}\s+(FUNC-[\w]+-\d+)[:\s]*(.*)/);
                if (headerFunc) { sectionFuncId = headerFunc[1]; continue; }
                if (!line.includes("|")) { if (/^#{1,3}\s/.test(line)) sectionFuncId = null; continue; }
                if (/^[\s|:-]+$/.test(line)) continue;
                const cells = line.split("|").map(c => c.trim()).filter(Boolean);
                const rowText = cells.join(" ");
                const funcInRow = rowText.match(/\b(FUNC-[\w]+-\d+)\b/);
                const funcId = funcInRow?.[1] ?? sectionFuncId;
                if (!funcId) continue;
                const srs = extractFuncIds(rowText, /\bSRS-F-\d+\b/g);
                const inf = extractFuncIds(rowText, /\bINF-\d+\b/g);
                const sch = extractFuncIds(rowText, /\bSCH-\d+\b/g);
                const uis = extractFuncIds(rowText, /\bUIS-F-\d+\b/g);
                const desc = funcInRow ? (cells[1] ?? "") : "";
                if (byId[funcId]) {
                  byId[funcId].srs = [...new Set([...byId[funcId].srs, ...srs])];
                  byId[funcId].inf = [...new Set([...byId[funcId].inf, ...inf])];
                  byId[funcId].sch = [...new Set([...byId[funcId].sch, ...sch])];
                  byId[funcId].uis = [...new Set([...byId[funcId].uis, ...uis])];
                } else {
                  byId[funcId] = { id: funcId, description: desc, srs, inf, sch, uis };
                }
              }
            }
            // docs/00_FUNC/FUNC_v1.0.md 에서 추가 FUNC-ID 보완
            const funcListPath = path.join(graphDir2, "docs", "00_FUNC", "FUNC_v1.0.md");
            if (fs.existsSync(funcListPath)) {
              const content = fs.readFileSync(funcListPath, "utf-8");
              const matches = content.matchAll(/\b(FUNC-[\w]+-\d+)\b[^\n]*\n?([^\n|#]*)?/g);
              for (const m of matches) {
                const funcId = m[1];
                if (!byId[funcId]) {
                  byId[funcId] = { id: funcId, description: m[2]?.trim() ?? "", srs: [], inf: [], sch: [], uis: [] };
                }
              }
            }
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(Object.values(byId).sort((a, b) => a.id.localeCompare(b.id))));
            return;
          }

          // linked_func 스캔 — 소스 → FUNC 역인덱스 (linked-func-cache.json 활용)
          if (url.pathname === "/api/linked-func-map") {
            const graphDir2 = process.env.GRAPH_DIR || process.cwd();
            // req_scan.py가 생성한 linked-func-cache.json 우선 사용
            const cacheFile = path.join(graphDir2, ".understand-anything", "linked-func-cache.json");
            if (fs.existsSync(cacheFile)) {
              res.setHeader("Content-Type", "application/json");
              res.end(fs.readFileSync(cacheFile, "utf-8"));
              return;
            }
            // fallback: 실시간 스캔
            const envPath = path.join(graphDir2, "project.env");
            const sourceDirs: string[] = [];
            if (fs.existsSync(envPath)) {
              const env2: Record<string, string> = {};
              for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
                const m = line.trim().match(/^([A-Z0-9_]+)=(.*)$/);
                if (m) env2[m[1]] = m[2];
              }
              const count = parseInt(env2.SOURCE_COUNT ?? "0", 10);
              for (let i = 1; i <= count; i++) {
                const p = env2[`SOURCE_${i}_PATH`];
                if (p && fs.existsSync(p)) sourceDirs.push(p);
              }
            }
            const result: Record<string, Array<{file: string; line: number; label: string}>> = {};
            const EXTS = new Set([".java", ".kt", ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".cs", ".php", ".rb", ".swift", ".rs"]);
            const SKIP = new Set(["node_modules", ".git", "dist", "build", "__pycache__", ".gradle", "target", "vendor", ".next"]);
            const doScan = (dir: string, label: string, count: number[]) => {
              if (count[0] > 8000) return;
              let entries: import("fs").Dirent[];
              try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
              for (const e of entries) {
                const fp = path.join(dir, e.name);
                if (e.isDirectory()) { if (!SKIP.has(e.name)) doScan(fp, label, count); }
                else if (EXTS.has(path.extname(e.name).toLowerCase())) {
                  count[0]++;
                  try {
                    const lines = fs.readFileSync(fp, "utf-8").split("\n");
                    lines.forEach((line, idx) => {
                      const re = /linked[_\s]func[:\s]+(FUNC-[\w-]+(?:\s*,\s*FUNC-[\w-]+)*)/gi;
                      let m: RegExpExecArray | null;
                      while ((m = re.exec(line)) !== null) {
                        const ids = m[1].split(/[,\s]+/).map(s => s.trim()).filter(s => /^FUNC-/.test(s));
                        for (const id of ids) {
                          if (!result[id]) result[id] = [];
                          result[id].push({ file: path.relative(dir, fp).replace(/\\/g, "/"), line: idx + 1, label });
                        }
                      }
                    });
                  } catch { /* skip */ }
                }
              }
            };
            const cnt = [0];
            for (const dir of sourceDirs) doScan(dir, path.basename(dir), cnt);
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(result));
            return;
          }

          // 스펙 파일 서빙
          if (url.pathname === "/spec-file") {
            const relPath = url.searchParams.get("path");
            if (!relPath || relPath.includes("..")) {
              res.statusCode = 400;
              res.end("Invalid path");
              return;
            }
            const graphDir2 = process.env.GRAPH_DIR || process.cwd();
            const absPath = path.join(graphDir2, relPath);
            if (!fs.existsSync(absPath)) {
              res.statusCode = 404;
              res.end("File not found");
              return;
            }
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.end(fs.readFileSync(absPath, "utf-8"));
            return;
          }

          next();
        });
      },
    },
  ],
});
