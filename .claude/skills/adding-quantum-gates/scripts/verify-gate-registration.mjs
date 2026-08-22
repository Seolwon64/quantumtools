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
// 환경변수로 루트를 바꿀 수 있게 두지 않는다 — 다른 리포를 검사하고 exit 0 을 내는
// 경로가 생기고, SKILL.md 의 "입력: 없음" 과도 어긋난다.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const at = (rel) => resolve(repoRoot, rel);

if (!existsSync(at("js/quantum.js"))) {
  die(`리포 루트를 찾지 못했다: ${repoRoot} 아래에 js/quantum.js 가 없다.\n` +
      `이 스크립트는 <repo>/.claude/skills/adding-quantum-gates/scripts/ 에 있어야 한다.`);
}

const { GATE_INFO, matrixFor } = await import(pathToFileURL(at("js/quantum.js")).href);
const { QASM_OPS, opFor } = await import(pathToFileURL(at("js/qasm.js")).href);

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
// CZ 는 팔레트엔 없지만 공유 회로로 캔버스에 올 수 있어
// js/main.js 의 GATE_CATEGORY.CZ 수동 지정으로 카테고리를 받는다.
const PALETTE_EXEMPT = new Set(["CZ"]);

// ─── 텍스트 파싱 ──────────────────────────────────────────────────────────
// 정규식이 일부만 읽고 지나가면 오탐·미검출이 조용히 생긴다. 파싱한 개수를
// 원본에서 센 개수와 대조해, 어긋나면 결과를 내지 않고 die 한다.
function parsePaletteCategories() {
  const src = readFileSync(at("js/main.js"), "utf8");
  const block = src.match(/const PALETTE_CATEGORIES = \[([\s\S]*?)\n\];/);
  if (!block) die("js/main.js 에서 PALETTE_CATEGORIES 블록을 찾지 못했다.");
  const cats = [...block[1].matchAll(/\{\s*id:\s*["'](\w+)["'][^}]*gates:\s*\[([^\]]*)\]/g)].map(
    (m) => ({ id: m[1], gates: [...m[2].matchAll(/["'](\w+)["']/g)].map((g) => g[1]) }),
  );
  const idCount = (block[1].match(/\bid:\s*["']/g) ?? []).length;
  if (cats.length !== idCount) {
    die(`PALETTE_CATEGORIES 파싱이 불완전하다: id ${idCount}개 중 ${cats.length}개만 읽었다.\n` +
        `카테고리 객체가 { id: ... , gates: [...] } 형태인지 확인해라.`);
  }
  if (cats.length === 0) {
    die("js/main.js 의 PALETTE_CATEGORIES 블록에서 카테고리를 하나도 읽지 못했다.");
  }
  return cats;
}

// SINGLE_QUBIT_GATES 는 js/quantum.js 에서 export 되지 않으므로 텍스트로 읽는다.
function parseSingleQubitGates() {
  const src = readFileSync(at("js/quantum.js"), "utf8");
  const block = src.match(/const SINGLE_QUBIT_GATES = new Set\(\[([\s\S]*?)\]\)/);
  if (!block) die("js/quantum.js 에서 SINGLE_QUBIT_GATES 블록을 찾지 못했다.");
  const names = [...block[1].matchAll(/["'](\w+)["']/g)].map((m) => m[1]);
  const quoteCount = (block[1].match(/["']\w+["']/g) ?? []).length;
  if (names.length !== quoteCount || names.length === 0) {
    die(`SINGLE_QUBIT_GATES 파싱이 불완전하다: 항목 ${quoteCount}개 중 ${names.length}개만 읽었다.`);
  }
  return new Set(names);
}

// ─── 검사 ────────────────────────────────────────────────────────────────
const cats = parsePaletteCategories();
const singleQubit = parseSingleQubitGates();
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
  "js/qasm.js 의 QASM_OPS 에 행을 추가해라. 없으면 내보내기에서 게이트가 아니라 " +
    "'cannot be represented' 주석으로 나간다(경고도 함께).",
);

report(
  "E. 행렬이 있어야 하는데 matrixFor 가 실패한다",
  Object.entries(GATE_INFO)
    .filter(([, i]) => MATRIX_KINDS.has(i.kind))
    .filter(([g, i]) => {
      // 던지지 않고 undefined·빈 배열을 돌려줘도 실패다. 반환값까지 확인한다.
      try {
        const m = matrixFor(g, i.defaultTheta);
        return !Array.isArray(m) || m.length === 0;
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

// 1큐비트 유니터리는 SINGLE_QUBIT_GATES 에 이름이 있어야 엔진이 applyUnitary 로 태운다.
// 빠지면 게이트가 정의돼 있는데 시뮬레이션에서 적용되지 않는다.
report(
  "G. 1큐비트 게이트인데 SINGLE_QUBIT_GATES 에 없다",
  Object.entries(GATE_INFO)
    .filter(([g, i]) => MATRIX_KINDS.has(i.kind) && !singleQubit.has(g))
    .map(([g]) => g),
  "js/quantum.js 의 SINGLE_QUBIT_GATES 에 이름을 추가해라.",
);

// 검사 D 는 controlled 를 면제한다(base + nc 로 내보내므로 고유 행이 필요 없다).
// 그 면제가 가리는 실패를 여기서 잡는다 — base+controls 조합에 QASM 연산이 없으면
// 내보내기에서 게이트가 아니라 주석으로 나간다.
report(
  "H. controlled 인데 opFor(base, controls) 가 null 이다",
  Object.entries(GATE_INFO)
    .filter(([, i]) => i.kind === "controlled")
    .filter(([, i]) => !opFor(i.base, i.controls))
    .map(([g]) => g),
  "base 와 controls 조합에 해당하는 QASM 연산이 없다. 그 게이트를 추가하지 마라 — " +
    "내보내기에서 'cannot be represented' 주석으로 나간다.",
);

if (problems.length === 0) process.exit(0);

for (const p of problems) {
  process.stdout.write(`${p.label}: ${p.items.join(", ")}\n  → ${p.fix}\n`);
}
process.exit(1);
