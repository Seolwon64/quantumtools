// 회로 공유/내보내기: URL 해시 인코딩(base64url), OpenQASM 2.0 / Qiskit 코드 생성.
// 셀은 canonical { gate, targets, controls, params } 구조. 구버전(v:1) URL도 계속 열린다.
import { GATE_INFO } from "./quantum.js";
import { MIN_QUBITS, MAX_QUBITS, MAX_COLUMNS, migrateCell } from "./circuit.js";
import { opFor, normalizeCircuit } from "./qasm.js";

function b64urlEncode(str) {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str) {
  return atob(str.replace(/-/g, "+").replace(/_/g, "/"));
}

function emptyGrid(n) {
  return Array.from({ length: MAX_COLUMNS }, () => new Array(n).fill(null));
}

// clbitCount를 생략하면 큐비트 수와 같다고 본다(구버전 호출부 호환).
export function encodeCircuit(qubitCount, grid, clbitCount) {
  const placements = [];
  for (let col = 0; col < grid.length; col++) {
    for (let row = 0; row < qubitCount; row++) {
      const cell = grid[col][row];
      if (!cell) continue;
      const p = { c: col, g: cell.gate, tg: cell.targets };
      if (cell.controls && cell.controls.length) p.x = cell.controls;
      const prm = cell.params ?? {};
      const params = {};
      if (prm.theta !== undefined) params.t = +prm.theta.toFixed(6);
      if (prm.phi !== undefined) params.f = +prm.phi.toFixed(6);
      if (prm.lambda !== undefined) params.l = +prm.lambda.toFixed(6);
      if (prm.cbit !== undefined) params.cb = prm.cbit; // Measure가 기록하는 고전 비트
      if (prm.cif !== undefined) params.ci = prm.cif;   // 조건부 연산의 조건 비트
      if (Object.keys(params).length) p.p = params;
      placements.push(p);
    }
  }
  const data = { v: 2, n: qubitCount, p: placements };
  // 고전 비트 수가 큐비트 수와 같으면(기본값) 굳이 넣지 않는다 — 기존 URL과 동일한 문자열이 나온다.
  if (clbitCount !== undefined && clbitCount !== qubitCount) data.c = clbitCount;
  return b64urlEncode(JSON.stringify(data));
}

export function decodeCircuit(encoded) {
  try {
    const data = JSON.parse(b64urlDecode(encoded));
    if (typeof data.n !== "number" || !Array.isArray(data.p)) return null;
    if (data.n < MIN_QUBITS || data.n > MAX_QUBITS) return null;
    const grid = emptyGrid(data.n);

    if (data.v === 2) {
      for (const p of data.p) {
        if (!Array.isArray(p.tg) || !GATE_INFO[p.g]) continue;
        const home = p.tg[0];
        if (typeof p.c !== "number" || p.c < 0 || p.c >= MAX_COLUMNS) continue;
        if (typeof home !== "number" || home < 0 || home >= data.n) continue;
        const params = {};
        if (p.p) {
          if (typeof p.p.t === "number") params.theta = p.p.t;
          if (typeof p.p.f === "number") params.phi = p.p.f;
          if (typeof p.p.l === "number") params.lambda = p.p.l;
          if (typeof p.p.cb === "number") params.cbit = p.p.cb;
          if (typeof p.p.ci === "number") params.cif = p.p.ci;
        }
        grid[p.c][home] = {
          gate: p.g,
          targets: p.tg,
          controls: Array.isArray(p.x) ? p.x : [],
          params,
        };
      }
    } else if (data.v === 1) {
      // 구버전 포맷: { c, q, g, t/f/l, x:controls, r:partner } → canonical 마이그레이션
      for (const p of data.p) {
        if (typeof p.c !== "number" || typeof p.q !== "number" || !GATE_INFO[p.g]) continue;
        if (p.c < 0 || p.c >= MAX_COLUMNS || p.q < 0 || p.q >= data.n) continue;
        const oldCell = { gate: p.g };
        if (typeof p.t === "number") oldCell.theta = p.t;
        if (typeof p.f === "number") oldCell.phi = p.f;
        if (typeof p.l === "number") oldCell.lambda = p.l;
        if (Array.isArray(p.x)) oldCell.controls = p.x;
        if (typeof p.r === "number") oldCell.partner = p.r;
        // canonical 홈 = targets[0] (RCCX/RC3X는 첫 컨트롤이 홈이라 p.q와 다를 수 있음)
        const cell = migrateCell(oldCell, p.q);
        const home = cell.targets[0];
        if (home >= 0 && home < data.n) grid[p.c][home] = cell;
      }
    } else {
      return null;
    }
    // 고전 비트 수가 없는 기존 URL은 큐비트 수와 같게 연다(배포된 링크가 그대로 동작).
    const clbitCount = typeof data.c === "number"
      ? Math.max(0, Math.min(MAX_QUBITS, data.c))
      : data.n;
    return { qubitCount: data.n, clbitCount, grid };
  } catch {
    return null;
  }
}

export function parseShareHash(hash) {
  const match = /^#c=([A-Za-z0-9_-]+)$/.exec(hash);
  return match ? decodeCircuit(match[1]) : null;
}

export function buildShareUrl(qubitCount, grid, clbitCount) {
  return `${location.origin}${location.pathname}#c=${encodeCircuit(qubitCount, grid, clbitCount)}`;
}

// ---------- QASM / Qiskit ----------
// 매핑은 js/qasm.js 의 QASM_OPS 표 하나뿐이다. 여기서 게이트 이름을 다시 적지 않는다 —
// 예전엔 SIMPLE/PARAM/qasmControlled/본문 if-else 로 다섯 군데에 흩어져 있었고,
// 역방향 파서가 그 지식을 다시 적으면 export 와 parse 가 조용히 갈라진다.

function fmt(x) {
  return String(+Number(x ?? 0).toFixed(6));
}

/** 조건이 하나라도 있고 고전 비트가 2개 이상일 때만 붙는 안내. */
const IF_SEMANTICS_NOTE = [
  "// NOTE: This app treats `if (c==2^k)` as \"bit c[k] is 1\" regardless of",
  "// other bits. OpenQASM 2.0 compares the whole register value.",
  "// With 2+ classical bits these differ: below, `if (c==2) x q[2];` runs",
  "// in this app whenever c[1]==1, but in Qiskit only when c is exactly 0b10.",
];

export const IF_SEMANTICS_WARNING =
  'Conditions differ from OpenQASM 2.0: this app reads `if (c==2^k)` as "bit c[k] is 1" ' +
  "regardless of other bits, while OpenQASM compares the whole register value. " +
  "With 2+ classical bits the exported `if` lines behave differently in Qiskit.";

/**
 * 정규화된 회로를 열 순서로 순회한다. 정규화가 이미 제어점을 접었으므로
 * 여기서 CTRL 을 만날 일은 없다(만나면 정규화를 건너뛴 호출부의 버그다).
 */
function eachCell(qubitCount, grid, visit) {
  for (let col = 0; col < grid.length; col++) {
    for (let row = 0; row < qubitCount; row++) {
      const cell = grid[col][row];
      if (!cell || cell.gate === "CTRL") continue;
      visit(cell);
    }
  }
}

/** 조건부 연산이 하나라도 있는가. */
function hasConditions(qubitCount, grid) {
  let found = false;
  eachCell(qubitCount, grid, (cell) => {
    if (cell.params?.cif !== undefined) found = true;
  });
  return found;
}

/**
 * OpenQASM 2.0 코드.
 * @returns {{code: string, warnings: string[]}} warnings 는 화면 배너용이다.
 *   표현하지 못한 게이트를 조용히 주석 처리하고 넘어가면 사용자가 **틀린 코드를 복사해 간다**.
 */
export function toQASM(qubitCount, rawGrid, clbitCount = qubitCount) {
  const { grid } = normalizeCircuit(qubitCount, rawGrid);
  const warnings = [];
  const lines = ["OPENQASM 2.0;", 'include "qelib1.inc";', `qreg q[${qubitCount}];`];
  if (clbitCount > 0) lines.push(`creg c[${clbitCount}];`);

  // 이 안내는 **코드 문자열 안에** 있어야 한다 — 배너는 화면에만 있으므로,
  // Copy 로 붙여넣은 사람도 차이를 알 수 있어야 한다.
  const conditional = hasConditions(qubitCount, grid);
  if (conditional && clbitCount > 1) {
    lines.push("", ...IF_SEMANTICS_NOTE);
    warnings.push(IF_SEMANTICS_WARNING);
  }
  lines.push("");

  const q = (i) => `q[${i}]`;
  const push = (stmt, params) =>
    lines.push(params?.cif !== undefined ? `if (c==${1 << params.cif}) ${stmt}` : stmt);

  eachCell(qubitCount, grid, (cell) => {
    const { gate, targets, controls = [], params = {} } = cell;

    if (gate === "MEASURE") {
      const cb = params.cbit ?? targets[0];
      if (clbitCount > 0 && cb < clbitCount) lines.push(`measure ${q(targets[0])} -> c[${cb}];`);
      else warnings.push(`Measure on q[${targets[0]}] has no classical bit to write to.`);
      return;
    }
    if (gate === "RESET") { lines.push(`reset ${q(targets[0])};`); return; }
    if (gate === "BARRIER") { lines.push(`barrier ${q(targets[0])};`); return; }

    const op = opFor(gate, controls.length);
    if (!op) {
      const what = controls.length ? `${gate} with ${controls.length} control(s)` : gate;
      lines.push(`// cannot be represented in OpenQASM 2.0: ${what}`);
      warnings.push(`${what} cannot be represented in OpenQASM 2.0 — that line is a comment, not a gate.`);
      return;
    }
    const args = [...controls, ...targets].map(q).join(",");
    const ps = (op.params ?? []).map((k) => fmt(params[k] ?? GATE_INFO[gate]?.defaultTheta));
    const call = ps.length ? `${op.qasm}(${ps.join(",")})` : op.qasm;
    push(`${call} ${args};`, params);
  });

  return { code: lines.join("\n") + "\n", warnings };
}

/** Qiskit 메서드명은 QASM 이름과 거의 같다. 다른 것만 예외로 적는다. */
const QISKIT_NAME = { id: "id", sdg: "sdg", sxdg: "sxdg", rc3x: "rcccx", c3x: "mcx", c4x: "mcx" };

/**
 * Qiskit(Python) 코드. 읽기 전용이므로 왕복 대상이 아니다 —
 * Python 은 브라우저에서 파싱할 수 없어 이 앱은 생성만 한다.
 */
export function toQiskit(qubitCount, rawGrid, clbitCount = qubitCount) {
  const { grid } = normalizeCircuit(qubitCount, rawGrid);
  const warnings = [];
  const lines = [
    "from qiskit import QuantumCircuit",
    "",
    `qc = QuantumCircuit(${qubitCount}${clbitCount > 0 ? `, ${clbitCount}` : ""})`,
  ];
  const conditional = hasConditions(qubitCount, grid);
  if (conditional && clbitCount > 1) {
    lines.push(
      "",
      "# NOTE: This app treats a condition as \"bit c[k] is 1\" regardless of other bits.",
      "# .c_if(creg, value) compares the whole register value.",
      "# With 2+ classical bits these differ."
    );
    warnings.push(IF_SEMANTICS_WARNING);
  }
  lines.push("");

  const push = (stmt, params) =>
    lines.push(params?.cif !== undefined ? `${stmt}.c_if(qc.cregs[0], ${1 << params.cif})` : stmt);

  eachCell(qubitCount, grid, (cell) => {
    const { gate, targets, controls = [], params = {} } = cell;

    if (gate === "MEASURE") {
      const cb = params.cbit ?? targets[0];
      if (clbitCount > 0 && cb < clbitCount) lines.push(`qc.measure(${targets[0]}, ${cb})`);
      return;
    }
    if (gate === "RESET") { lines.push(`qc.reset(${targets[0]})`); return; }
    if (gate === "BARRIER") { lines.push(`qc.barrier(${targets[0]})`); return; }

    const op = opFor(gate, controls.length);
    if (!op) {
      const what = controls.length ? `${gate} with ${controls.length} control(s)` : gate;
      lines.push(`# cannot be represented: ${what}`);
      warnings.push(`${what} cannot be represented in Qiskit's basic gate set here.`);
      return;
    }
    const method = QISKIT_NAME[op.qasm] ?? op.qasm;
    const ps = (op.params ?? []).map((k) => fmt(params[k] ?? GATE_INFO[gate]?.defaultTheta));
    // mcx 는 제어 목록을 배열로 받는다 — 인자 모양이 다른 유일한 예외.
    const qubits =
      method === "mcx"
        ? `[${controls.join(", ")}], ${targets[0]}`
        : [...controls, ...targets].join(", ");
    push(`qc.${method}(${[...ps, qubits].join(", ")})`, params);
  });

  return { code: lines.join("\n") + "\n", warnings };
}
