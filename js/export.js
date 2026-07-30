// 회로 공유/내보내기: URL 해시 인코딩(base64url), OpenQASM 2.0 / Qiskit 코드 생성.
// 셀은 canonical { gate, targets, controls, params } 구조. 구버전(v:1) URL도 계속 열린다.
import { GATE_INFO } from "./quantum.js";
import { MIN_QUBITS, MAX_QUBITS, MAX_COLUMNS, migrateCell } from "./circuit.js";

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

function fmt(x) {
  return String(+Number(x ?? 0).toFixed(6));
}

const SIMPLE = {
  H: "h", X: "x", Y: "y", Z: "z", S: "s", Sdg: "sdg",
  T: "t", Tdg: "tdg", I: "id", SX: "sx", SXdg: "sxdg",
};
const PARAM = { RX: "rx", RY: "ry", RZ: "rz", P: "p" };

// canonical 셀을 순회하며 방문 (CTRL 점은 표준 표현이 없어 export 생략)
function eachCell(qubitCount, grid, visit) {
  let hasCtrl = false;
  for (let col = 0; col < grid.length; col++) {
    for (let row = 0; row < qubitCount; row++) {
      const cell = grid[col][row];
      if (!cell) continue;
      if (cell.gate === "CTRL") {
        hasCtrl = true;
        continue;
      }
      visit(cell);
    }
  }
  return hasCtrl;
}

// controls 패턴을 표준 게이트명으로 역매핑한다. X+1→cx, Z+1→cz, X+2→ccx (반드시).
// 지원되지 않는 조합은 null을 반환해 주석 처리한다.
function qasmControlled(gate, nc) {
  if (gate === "X") return nc === 1 ? "cx" : nc === 2 ? "ccx" : null;
  if (gate === "Z") return nc === 1 ? "cz" : null;
  if (gate === "Y") return nc === 1 ? "cy" : null;
  if (gate === "H") return nc === 1 ? "ch" : null;
  if (gate === "RZ") return nc === 1 ? "crz" : null;
  if (gate === "SWAP") return nc === 1 ? "cswap" : null;
  return null;
}

export function toQASM(qubitCount, grid, clbitCount = qubitCount) {
  const lines = [
    "OPENQASM 2.0;",
    'include "qelib1.inc";',
    `qreg q[${qubitCount}];`,
  ];
  if (clbitCount > 0) lines.push(`creg c[${clbitCount}];`); // 고전 비트가 없으면 creg도 없다
  lines.push("");
  const q = (i) => `q[${i}]`;
  // 조건부 연산은 OpenQASM 2.0의 `if (c==N) …` 로 감싼다(단일 비트 조건 → N = 1<<k).
  const push = (stmt, params) =>
    lines.push(params?.cif !== undefined ? `if (c==${1 << params.cif}) ${stmt}` : stmt);
  const hasCtrl = eachCell(qubitCount, grid, (cell) => {
    const { gate, targets, controls = [], params = {} } = cell;
    const nc = controls.length;
    const theta = params.theta ?? GATE_INFO[gate]?.defaultTheta;

    // 고유 상대위상 게이트: 역매핑(X+2→ccx)보다 먼저 검사 — ccx로 잘못 나가지 않게.
    if (gate === "RCCX") { push(`rccx ${targets.map(q).join(",")};`, params); return; }
    if (gate === "RC3X") { push(`rc3x ${targets.map(q).join(",")};`, params); return; }

    if (nc === 0) {
      if (SIMPLE[gate]) push(`${SIMPLE[gate]} ${q(targets[0])};`, params);
      else if (PARAM[gate]) push(`${PARAM[gate]}(${fmt(theta)}) ${q(targets[0])};`, params);
      else if (gate === "U") push(`u(${fmt(params.theta)},${fmt(params.phi)},${fmt(params.lambda)}) ${q(targets[0])};`, params);
      else if (gate === "SWAP") push(`swap ${q(targets[0])},${q(targets[1])};`, params);
      else if (gate === "RXX") push(`rxx(${fmt(theta)}) ${q(targets[0])},${q(targets[1])};`, params);
      else if (gate === "RYY") push(`ryy(${fmt(theta)}) ${q(targets[0])},${q(targets[1])};`, params);
      else if (gate === "RZZ") push(`rzz(${fmt(theta)}) ${q(targets[0])},${q(targets[1])};`, params);
      // 측정 대상 고전 비트는 params.cbit (없으면 같은 인덱스). 고전 비트가 없으면 내보내지 않는다.
      else if (gate === "MEASURE") {
        const cb = params.cbit ?? targets[0];
        if (clbitCount > 0 && cb < clbitCount) lines.push(`measure ${q(targets[0])} -> c[${cb}];`);
      }
      else if (gate === "RESET") lines.push(`reset ${q(targets[0])};`);
      else if (gate === "BARRIER") lines.push(`barrier ${q(targets[0])};`);
      return;
    }
    const name = qasmControlled(gate, nc);
    if (name) {
      const args = [...controls, ...targets].map(q).join(",");
      push(`${name} ${args};`, params);
    } else {
      lines.push(`// unsupported in OpenQASM 2.0: ${gate} with ${nc} controls (needs decomposition)`);
    }
  });
  if (hasCtrl) lines.push("// note: control-dot (•) column modifiers are not exported");
  return lines.join("\n") + "\n";
}

export function toQiskit(qubitCount, grid, clbitCount = qubitCount) {
  const lines = ["from qiskit import QuantumCircuit", "", `qc = QuantumCircuit(${qubitCount}${clbitCount > 0 ? `, ${clbitCount}` : ""})`];
  // Qiskit 컨트롤드 메서드: X+n는 cx/ccx/mcx, Z+1 cz, 그 외 표준 매핑
  const controlledQiskit = (gate, nc, controls, targets) => {
    const cs = controls.join(", ");
    const t = targets[0];
    if (gate === "X") {
      if (nc === 1) return `qc.cx(${controls[0]}, ${t})`;
      if (nc === 2) return `qc.ccx(${controls[0]}, ${controls[1]}, ${t})`;
      return `qc.mcx([${cs}], ${t})`;
    }
    if (gate === "Z") return nc === 1 ? `qc.cz(${controls[0]}, ${t})` : `qc.h(${t})\nqc.mcx([${cs}], ${t})\nqc.h(${t})`;
    if (gate === "Y" && nc === 1) return `qc.cy(${controls[0]}, ${t})`;
    if (gate === "H" && nc === 1) return `qc.ch(${controls[0]}, ${t})`;
    if (gate === "SWAP" && nc === 1) return `qc.cswap(${controls[0]}, ${targets[0]}, ${targets[1]})`;
    return null;
  };
  // 조건부 연산은 Qiskit의 .c_if(creg, value)로 내보낸다(단일 비트 조건 → value = 1<<k).
  const push = (stmt, params) =>
    lines.push(params?.cif !== undefined ? `${stmt}.c_if(qc.cregs[0], ${1 << params.cif})` : stmt);
  const hasCtrl = eachCell(qubitCount, grid, (cell) => {
    const { gate, targets, controls = [], params = {} } = cell;
    const nc = controls.length;
    const theta = params.theta ?? GATE_INFO[gate]?.defaultTheta;

    // 고유 상대위상 게이트: 역매핑(X→ccx)보다 먼저. Qiskit: RCCXGate=rccx, RC3XGate=rcccx.
    if (gate === "RCCX") { push(`qc.rccx(${targets.join(", ")})`, params); return; }
    if (gate === "RC3X") { push(`qc.rcccx(${targets.join(", ")})`, params); return; }

    if (nc === 0) {
      if (SIMPLE[gate]) push(`qc.${SIMPLE[gate]}(${targets[0]})`, params);
      else if (PARAM[gate]) push(`qc.${PARAM[gate]}(${fmt(theta)}, ${targets[0]})`, params);
      else if (gate === "U") push(`qc.u(${fmt(params.theta)}, ${fmt(params.phi)}, ${fmt(params.lambda)}, ${targets[0]})`, params);
      else if (gate === "SWAP") push(`qc.swap(${targets[0]}, ${targets[1]})`, params);
      else if (gate === "RXX") push(`qc.rxx(${fmt(theta)}, ${targets[0]}, ${targets[1]})`, params);
      else if (gate === "RYY") push(`qc.ryy(${fmt(theta)}, ${targets[0]}, ${targets[1]})`, params);
      else if (gate === "RZZ") push(`qc.rzz(${fmt(theta)}, ${targets[0]}, ${targets[1]})`, params);
      else if (gate === "MEASURE") {
        const cb = params.cbit ?? targets[0];
        if (clbitCount > 0 && cb < clbitCount) lines.push(`qc.measure(${targets[0]}, ${cb})`);
      }
      else if (gate === "RESET") lines.push(`qc.reset(${targets[0]})`);
      else if (gate === "BARRIER") lines.push(`qc.barrier(${targets[0]})`);
      return;
    }
    const code = controlledQiskit(gate, nc, controls, targets);
    if (code) push(code, params);
    else lines.push(`# unsupported controlled gate: ${gate} with ${nc} controls`);
  });
  if (hasCtrl) lines.push("# note: control-dot (•) column modifiers are not exported");
  return lines.join("\n") + "\n";
}
