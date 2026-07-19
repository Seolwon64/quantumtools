// 회로 공유/내보내기: URL 해시 인코딩(base64url), OpenQASM 2.0 / Qiskit 코드 생성.
import { GATE_INFO } from "./quantum.js";
import { MIN_QUBITS, MAX_QUBITS, MAX_COLUMNS } from "./circuit.js";

function b64urlEncode(str) {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str) {
  return atob(str.replace(/-/g, "+").replace(/_/g, "/"));
}

export function encodeCircuit(qubitCount, grid) {
  const placements = [];
  for (let col = 0; col < grid.length; col++) {
    for (let q = 0; q < qubitCount; q++) {
      const cell = grid[col][q];
      if (!cell) continue;
      const p = { c: col, q, g: cell.gate };
      if (cell.theta !== undefined) p.t = +cell.theta.toFixed(6);
      if (cell.phi !== undefined) p.f = +cell.phi.toFixed(6);
      if (cell.lambda !== undefined) p.l = +cell.lambda.toFixed(6);
      if (cell.controls !== undefined) p.x = cell.controls;
      if (cell.partner !== undefined) p.r = cell.partner;
      placements.push(p);
    }
  }
  return b64urlEncode(JSON.stringify({ v: 1, n: qubitCount, p: placements }));
}

export function decodeCircuit(encoded) {
  try {
    const data = JSON.parse(b64urlDecode(encoded));
    if (data.v !== 1 || typeof data.n !== "number" || !Array.isArray(data.p)) return null;
    if (data.n < MIN_QUBITS || data.n > MAX_QUBITS) return null;
    const grid = Array.from({ length: MAX_COLUMNS }, () => new Array(data.n).fill(null));
    for (const p of data.p) {
      if (typeof p.c !== "number" || typeof p.q !== "number" || !GATE_INFO[p.g]) continue;
      if (p.c < 0 || p.c >= MAX_COLUMNS || p.q < 0 || p.q >= data.n) continue;
      const cell = { gate: p.g };
      if (typeof p.t === "number") cell.theta = p.t;
      if (typeof p.f === "number") cell.phi = p.f;
      if (typeof p.l === "number") cell.lambda = p.l;
      if (Array.isArray(p.x)) cell.controls = p.x;
      if (typeof p.r === "number") cell.partner = p.r;
      grid[p.c][p.q] = cell;
    }
    return { qubitCount: data.n, grid };
  } catch {
    return null;
  }
}

export function parseShareHash(hash) {
  const match = /^#c=([A-Za-z0-9_-]+)$/.exec(hash);
  return match ? decodeCircuit(match[1]) : null;
}

export function buildShareUrl(qubitCount, grid) {
  return `${location.origin}${location.pathname}#c=${encodeCircuit(qubitCount, grid)}`;
}

// ---------- QASM / Qiskit ----------

const QASM_SIMPLE = {
  H: "h", X: "x", Y: "y", Z: "z", S: "s", Sdg: "sdg",
  T: "t", Tdg: "tdg", I: "id", SX: "sx", SXdg: "sxdg",
};
const QASM_PARAM = { RX: "rx", RY: "ry", RZ: "rz", P: "p" };
const QASM_CONTROLLED = { CNOT: "cx", CZ: "cz", CCX: "ccx", RCCX: "rccx", RC3X: "rc3x" };

function fmt(x) {
  return String(+Number(x ?? 0).toFixed(6));
}

function eachPlacement(qubitCount, grid, visit) {
  let hasCtrl = false;
  for (let col = 0; col < grid.length; col++) {
    for (let q = 0; q < qubitCount; q++) {
      const cell = grid[col][q];
      if (!cell) continue;
      if (cell.gate === "CTRL") {
        hasCtrl = true;
        continue;
      }
      visit(cell, q);
    }
  }
  return hasCtrl;
}

export function toQASM(qubitCount, grid) {
  const lines = [
    "OPENQASM 2.0;",
    'include "qelib1.inc";',
    `qreg q[${qubitCount}];`,
    `creg c[${qubitCount}];`,
    "",
  ];
  const hasCtrl = eachPlacement(qubitCount, grid, (cell, q) => {
    const g = cell.gate;
    const theta = cell.theta ?? GATE_INFO[g].defaultTheta;
    if (QASM_SIMPLE[g]) {
      lines.push(`${QASM_SIMPLE[g]} q[${q}];`);
    } else if (QASM_PARAM[g]) {
      lines.push(`${QASM_PARAM[g]}(${fmt(theta)}) q[${q}];`);
    } else if (g === "U") {
      lines.push(`u(${fmt(theta)},${fmt(cell.phi)},${fmt(cell.lambda)}) q[${q}];`);
    } else if (QASM_CONTROLLED[g]) {
      const args = [...cell.controls, q].map((i) => `q[${i}]`).join(",");
      lines.push(`${QASM_CONTROLLED[g]} ${args};`);
    } else if (g === "SWAP") {
      lines.push(`swap q[${q}],q[${cell.partner}];`);
    } else if (g === "RXX") {
      lines.push(`rxx(${fmt(theta)}) q[${q}],q[${cell.partner}];`);
    } else if (g === "RZZ") {
      lines.push(`rzz(${fmt(theta)}) q[${q}],q[${cell.partner}];`);
    } else if (g === "MEASURE") {
      lines.push(`measure q[${q}] -> c[${q}];`);
    } else if (g === "RESET") {
      lines.push(`reset q[${q}];`);
    } else if (g === "BARRIER") {
      lines.push(`barrier q[${q}];`);
    }
  });
  if (hasCtrl) lines.push("// note: control-dot (•) column modifiers are not exported");
  return lines.join("\n") + "\n";
}

const QISKIT_CONTROLLED = { CNOT: "cx", CZ: "cz", CCX: "ccx", RCCX: "rccx", RC3X: "rcccx" };

export function toQiskit(qubitCount, grid) {
  const lines = [
    "from qiskit import QuantumCircuit",
    "",
    `qc = QuantumCircuit(${qubitCount}, ${qubitCount})`,
  ];
  const hasCtrl = eachPlacement(qubitCount, grid, (cell, q) => {
    const g = cell.gate;
    const theta = cell.theta ?? GATE_INFO[g].defaultTheta;
    if (QASM_SIMPLE[g]) {
      lines.push(`qc.${QASM_SIMPLE[g]}(${q})`);
    } else if (QASM_PARAM[g]) {
      lines.push(`qc.${QASM_PARAM[g]}(${fmt(theta)}, ${q})`);
    } else if (g === "U") {
      lines.push(`qc.u(${fmt(theta)}, ${fmt(cell.phi)}, ${fmt(cell.lambda)}, ${q})`);
    } else if (QISKIT_CONTROLLED[g]) {
      lines.push(`qc.${QISKIT_CONTROLLED[g]}(${[...cell.controls, q].join(", ")})`);
    } else if (g === "SWAP") {
      lines.push(`qc.swap(${q}, ${cell.partner})`);
    } else if (g === "RXX") {
      lines.push(`qc.rxx(${fmt(theta)}, ${q}, ${cell.partner})`);
    } else if (g === "RZZ") {
      lines.push(`qc.rzz(${fmt(theta)}, ${q}, ${cell.partner})`);
    } else if (g === "MEASURE") {
      lines.push(`qc.measure(${q}, ${q})`);
    } else if (g === "RESET") {
      lines.push(`qc.reset(${q})`);
    } else if (g === "BARRIER") {
      lines.push(`qc.barrier(${q})`);
    }
  });
  if (hasCtrl) lines.push("# note: control-dot (•) column modifiers are not exported");
  return lines.join("\n") + "\n";
}
