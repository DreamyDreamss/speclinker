// scan_source.js 분류/메서드 파싱 회귀 테스트 — `node scripts/tests/test_scan_source.js`
// C-4: Jackson JSON-view(ModelAndView(MAPPING_JACKSON_JSON_VIEW)) 핸들러 → api
// H-3: @RequestMapping(method=RequestMethod.POST) → method=POST (ANY 아님)
const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCAN = path.join(__dirname, '..', 'scan_source.js');

function scan(java) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-scan-'));
  const cdir = path.join(dir, 'src', 'main', 'java', 'app', 'product');
  fs.mkdirSync(cdir, { recursive: true });
  fs.writeFileSync(path.join(cdir, 'Pr205Controller.java'), java);
  const out = path.join(dir, 'out.json');
  cp.execFileSync('node', [SCAN, '--workspace=' + dir, '--out=' + out], { stdio: 'pipe' });
  const idx = JSON.parse(fs.readFileSync(out, 'utf-8'));
  const routes = (idx.files || []).flatMap(f => f.routes || []);
  fs.rmSync(dir, { recursive: true, force: true });
  return routes;
}

function findRoute(routes, handler) { return routes.find(r => r.handlerMethod === handler); }

function test_jackson_json_view_is_api() {
  const r = findRoute(scan(
    '@Controller\n' +
    'public class Pr205Controller {\n' +
    '  @RequestMapping(value="/app/product/prdreg/productImageDetails", method=RequestMethod.POST)\n' +
    '  public ModelAndView productImageDetails() { return new ModelAndView(Globals.MAPPING_JACKSON_JSON_VIEW); }\n' +
    '}\n'), 'productImageDetails');
  assert.ok(r, 'productImageDetails route 추출됨');
  assert.strictEqual(r.kind, 'api', 'JSON-view 핸들러는 api로 분류돼야 함');
}

function test_requestmapping_method_attr() {
  const r = findRoute(scan(
    '@Controller\n' +
    'public class Pr205Controller {\n' +
    '  @RequestMapping(value="/app/product/x", method=RequestMethod.POST)\n' +
    '  public ModelAndView x() { return new ModelAndView("v"); }\n' +
    '}\n'), 'x');
  assert.ok(r, 'x route 추출됨');
  assert.strictEqual(r.method, 'POST', '@RequestMapping method=POST가 파싱돼야 함 (ANY 아님)');
}

// M-3: 배치 디렉토리 안의 Mapper는 dao(배치 아님), @Scheduled 클래스는 batch
function scanFile(relPath, src) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-scan-'));
  const full = path.join(dir, relPath.replace(/\//g, path.sep));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, src);
  const out = path.join(dir, 'out.json');
  cp.execFileSync('node', [SCAN, '--workspace=' + dir, '--out=' + out], { stdio: 'pipe' });
  const idx = JSON.parse(fs.readFileSync(out, 'utf-8'));
  const f = (idx.files || []).find(x => x.relPath && x.relPath.endsWith(path.basename(relPath)));
  fs.rmSync(dir, { recursive: true, force: true });
  return f;
}

function test_mapper_in_batch_dir_not_batch() {
  const f = scanFile('src/main/java/app/batch/CmmBatchLogMapper.java',
    '@Mapper\npublic interface CmmBatchLogMapper { int insert(); }');
  assert.ok(f, 'file 스캔됨');
  assert.notStrictEqual(f.type, 'batch', '배치 디렉토리 안이라도 Mapper는 batch가 아니어야 함(M-3)');
}

function test_scheduled_class_is_batch() {
  const f = scanFile('src/main/java/app/svc/PriceSyncRunner.java',
    '@Component\npublic class PriceSyncRunner {\n  @Scheduled(cron="0 0 * * * *")\n  public void run() {}\n}');
  assert.ok(f, 'file 스캔됨');
  assert.strictEqual(f.type, 'batch', '@Scheduled 클래스는 batch여야 함(M-3)');
}

if (require.main === module) {
  test_jackson_json_view_is_api(); console.log('PASS test_jackson_json_view_is_api');
  test_requestmapping_method_attr(); console.log('PASS test_requestmapping_method_attr');
  test_mapper_in_batch_dir_not_batch(); console.log('PASS test_mapper_in_batch_dir_not_batch');
  test_scheduled_class_is_batch(); console.log('PASS test_scheduled_class_is_batch');
}
