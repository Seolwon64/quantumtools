// 게이트가 모든 등록 지점에 빠짐없이 들어갔는지 교차 검증한다.
// 위반이 없으면 무출력 + exit 0, 있으면 항목별 목록 + exit 1.
//
// js/main.js 는 import 할 수 없다 — scene.js 가 three 를 CDN 임포트맵에서 끌어오는데
// node_modules 에 없어 "Cannot find package 'three'" 로 죽는다. 그래서 main.js 와
// style.css 는 텍스트 파싱하고, quantum.js/qasm.js 만 import 한다.
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function die(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

// cwd 에 의존하지 않는다: <repo>/.claude/skills/adding-quantum-gates/scripts/ 에서 4단계 위.
// QT_REPO_ROOT 는 테스트용 탈출구다(스킬을 설치하기 전에 로직을 돌려보기 위한 것).
const repoRoot =
  process.env.QT_REPO_ROOT ??
  resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const at = (rel) => resolve(repoRoot, rel);

if (!existsSync(at("js/quantum.js"))) {
  die(`리포 루트를 찾지 못했다: ${repoRoot} 아래에 js/quantum.js 가 없다.\n` +
      `이 스크립트는 <repo>/.claude/skills/adding-quantum-gates/scripts/ 에 있어야 한다.`);
}

const { GATE_INFO, matrixFor } = await import(pathToFileURL(at("js/quantum.js")).href);
const { QASM_OPS } = await import(pathToFileURL(at("js/qasm.js")).href);

// ─── 예외는 이름이 아니라 kind 규칙으로 유도한다 ────────────────────────────
// 이름 목록을 박아두면 다음에 controlled 게이트를 추가하는 순간 오탐이 난다.
// 그 게이트야말로 이 스킬로 추가할 게이트다 — 스킬이 자기 산출물에 오탐을 내면 안 된다.

// QASM 표에 고유 행이 없어도 정상인 kind.
// controlled/cswap 은 base 게이트 + nc 로 내보내고(cx → gate:"X", nc:1),
// dot/noop/reset 은 구조·비유니터리라 별도 방출 경로를 탄다.
// decomposed 는 일부러 넣지 않았다 — RCCX/RC3X 는 이미 QASM 행이 있어 면제가 발동할
// 일이 없고, 넣어두면 새 decomposed 게이트가 QASM 행을 빠뜨려도 잡히지 않는다.
const QASM_EXEMPT_KINDS = new Set(["controlled", "cswap", "dot", "noop", "reset"]);

// matrixFor 가 책임지는 kind. param3(U)는 uMatrix() 가 따로 처리하므로 제외된다.
const MATRIX_KINDS = new Set(["fixed", "param"]);

// 팔레트에 없어도 정상인 게이트 — 유일한 진짜 일회성 예외.
// CZ 는 팔레트엔 없지만 공유 회로로 캔버스에 올 수 있어 js/main.js:44 에서
// GATE_CATEGORY.CZ 로 카테고리를 수동 부여한다.
const PALETTE_EXEMPT = new Set(["CZ"]);

// ─── main.js 텍스트 파싱 ──────────────────────────────────────────────────
function parsePaletteCategories() {
  const src = readFileSync(at("js/main.js"), "utf8");
  const block = src.match(/const PALETTE_CATEGORIES = \[([\s\S]*?)\n\];/);
  if (!block) die("js/main.js 에서 PALETTE_CATEGORIES 블록을 찾지 못했다.");
  const cats = [...block[1].matchAll(/\{\s*id:\s*["'](\w+)["'][^}]*gates:\s*\[([^\]]*)\]/g)].map(
    (m) => ({ id: m[1], gates: [...m[2].matchAll(/["'](\w+)["']/g)].map((g) => g[1]) }),
  );
  if (cats.length === 0) {
    die("js/main.js 의 PALETTE_CATEGORIES 블록에서 카테고리를 하나도 읽지 못했다.");
  }
  return cats;
}

// ─── 검사 ────────────────────────────────────────────────────────────────
const cats = parsePaletteCategories();
const palette = new Set(cats.flatMap((c) => c.gates));
const info = new Set(Object.keys(GATE_INFO));
const qasmGates = new Set(QASM_OPS.map((o) => o.gate));
const css = readFileSync(at("style.css"), "utf8");

const problems = [];
const report = (label, items, fix) => {
  if (items.length) problems.push({ label, items, fix });
};

report(
  "A. GATE_INFO 에 있는데 팔레트에 없다",
  [...info].filter((g) => !palette.has(g) && !PALETTE_EXEMPT.has(g)),
  "js/main.js 의 PALETTE_CATEGORIES 에서 알맞은 카테고리의 gates 배열에 넣어라.",
);

report(
  "B. 팔레트에 있는데 GATE_INFO 에 없다",
  [...palette].filter((g) => !info.has(g)),
  "js/quantum.js 의 GATE_INFO 에 항목을 추가하거나 팔레트의 이름을 고쳐라.",
);

report(
  "C. QASM_OPS 가 참조하는데 GATE_INFO 에 없다",
  [...qasmGates].filter((g) => !info.has(g)),
  "js/quantum.js 의 GATE_INFO 에 항목을 추가하거나 QASM_OPS 의 gate 값을 고쳐라.",
);

report(
  "D. GATE_INFO 에 있는데 QASM 표에 없다",
  Object.entries(GATE_INFO)
    .filter(([g, i]) => !qasmGates.has(g) && !QASM_EXEMPT_KINDS.has(i.kind))
    .map(([g]) => g),
  "js/qasm.js 의 QASM_OPS 에 행을 추가해라. 없으면 QASM/Qiskit 내보내기에서 조용히 빠진다.",
);

report(
  "E. 행렬이 있어야 하는데 matrixFor 가 실패한다",
  Object.entries(GATE_INFO)
    .filter(([, i]) => MATRIX_KINDS.has(i.kind))
    .filter(([g, i]) => {
      try {
        matrixFor(g, i.defaultTheta);
        return false;
      } catch {
        return true;
      }
    })
    .map(([g]) => g),
  "js/quantum.js 의 FIXED_MATRICES 또는 PARAM_MATRIX_BUILDERS 에 행렬을 추가해라.",
);

report(
  "F. 팔레트 카테고리에 대응하는 CSS 변수가 없다",
  cats.flatMap((c) =>
    ["", "-border", "-hover"].map((s) => `--cat-${c.id}${s}`).filter((v) => !css.includes(`${v}:`)),
  ),
  "style.css 에 카테고리 색 3종(base/border/hover)을 정의해라.",
);

if (problems.length === 0) process.exit(0);

for (const p of problems) {
  process.stdout.write(`${p.label}: ${p.items.join(", ")}\n  → ${p.fix}\n`);
}
process.exit(1);
