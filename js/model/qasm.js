// OpenQASM 2.0 ↔ canonical 회로. **양방향이 이 파일 하나를 본다.**
//
// 예전에는 매핑 지식이 export.js 안에 다섯 군데로 흩어져 있었다(SIMPLE, PARAM,
// qasmControlled(), toQASM 본문 if-else, controlledQiskit()). 역방향 파서가 그 지식을
// 다시 적으면 export 와 parse 가 조용히 갈라져 왕복이 깨진다. 그래서 QASM_OPS 표 하나로
// 합치고 export 도 parse 도 이 표만 인덱싱한다.

import { GATE_INFO } from "./quantum.js";
import { MIN_QUBITS, MAX_QUBITS, MAX_COLUMNS } from "./circuit.js";

/**
 * canonical 게이트 ↔ QASM 이름.
 *   qasm   QASM 게이트명
 *   gate   canonical 게이트 이름
 *   nc     제어 큐비트 수 (인자 앞쪽에서 이만큼을 controls 로 읽는다)
 *   nt     타깃 큐비트 수 (인자 뒤쪽)
 *   params 파라미터 이름 순서 (QASM 괄호 안 순서와 일치해야 한다)
 *
 * c3x·c4x·crx·cry·cp·rxx·ryy·rzz·rccx·rc3x·sx·sxdg·p 는 OpenQASM 2.0 표준이 아니라
 * Qiskit 의 확장 qelib1.inc 에 있는 것들이다. 표준만 고집하면 MCX 같은 게이트가
 * 주석으로 빠져 **내보낸 코드가 다른 회로**가 되므로 커버리지를 넓히는 쪽을 택했다.
 */
export const QASM_OPS = [
  // --- 1큐비트 고정 게이트 ---
  { qasm: "h", gate: "H", nc: 0, nt: 1 },
  { qasm: "x", gate: "X", nc: 0, nt: 1 },
  { qasm: "y", gate: "Y", nc: 0, nt: 1 },
  { qasm: "z", gate: "Z", nc: 0, nt: 1 },
  { qasm: "s", gate: "S", nc: 0, nt: 1 },
  { qasm: "sdg", gate: "Sdg", nc: 0, nt: 1 },
  { qasm: "t", gate: "T", nc: 0, nt: 1 },
  { qasm: "tdg", gate: "Tdg", nc: 0, nt: 1 },
  { qasm: "id", gate: "I", nc: 0, nt: 1 },
  { qasm: "sx", gate: "SX", nc: 0, nt: 1 },
  { qasm: "sxdg", gate: "SXdg", nc: 0, nt: 1 },

  // --- 파라미터 게이트 ---
  { qasm: "rx", gate: "RX", nc: 0, nt: 1, params: ["theta"] },
  { qasm: "ry", gate: "RY", nc: 0, nt: 1, params: ["theta"] },
  { qasm: "rz", gate: "RZ", nc: 0, nt: 1, params: ["theta"] },
  { qasm: "p", gate: "P", nc: 0, nt: 1, params: ["theta"] },
  { qasm: "u", gate: "U", nc: 0, nt: 1, params: ["theta", "phi", "lambda"] },

  // --- 2큐비트 상호작용 ---
  { qasm: "swap", gate: "SWAP", nc: 0, nt: 2 },
  { qasm: "rxx", gate: "RXX", nc: 0, nt: 2, params: ["theta"] },
  { qasm: "ryy", gate: "RYY", nc: 0, nt: 2, params: ["theta"] },
  { qasm: "rzz", gate: "RZZ", nc: 0, nt: 2, params: ["theta"] },

  // --- 상대위상 (고유 게이트, 제어 순서가 결과를 바꾸므로 targets 순서를 지킨다) ---
  { qasm: "rccx", gate: "RCCX", nc: 0, nt: 3 },
  { qasm: "rc3x", gate: "RC3X", nc: 0, nt: 4 },

  // --- 제어형 ---
  { qasm: "cx", gate: "X", nc: 1, nt: 1 },
  { qasm: "ccx", gate: "X", nc: 2, nt: 1 },
  { qasm: "c3x", gate: "X", nc: 3, nt: 1 },
  { qasm: "c4x", gate: "X", nc: 4, nt: 1 },
  { qasm: "cy", gate: "Y", nc: 1, nt: 1 },
  { qasm: "cz", gate: "Z", nc: 1, nt: 1 },
  { qasm: "ch", gate: "H", nc: 1, nt: 1 },
  { qasm: "cswap", gate: "SWAP", nc: 1, nt: 2 },
  { qasm: "crx", gate: "RX", nc: 1, nt: 1, params: ["theta"] },
  { qasm: "cry", gate: "RY", nc: 1, nt: 1, params: ["theta"] },
  { qasm: "crz", gate: "RZ", nc: 1, nt: 1, params: ["theta"] },
  { qasm: "cp", gate: "P", nc: 1, nt: 1, params: ["theta"] },
];

/** QASM 이름 → op. 파싱용. */
const BY_QASM = new Map(QASM_OPS.map((op) => [op.qasm, op]));
/** `${gate}/${nc}` → op. export 용. 같은 키가 둘이면 표가 모순이므로 먼저 것을 쓴다. */
const BY_GATE = new Map();
for (const op of QASM_OPS) {
  const key = `${op.gate}/${op.nc}`;
  if (!BY_GATE.has(key)) BY_GATE.set(key, op);
}

/** canonical 게이트 + 제어 수로 QASM op 찾기. 없으면 null(= 표현 불가). */
export function opFor(gate, controlCount) {
  return BY_GATE.get(`${gate}/${controlCount}`) ?? null;
}

/** QASM 이름으로 op 찾기. */
export function opByName(name) {
  return BY_QASM.get(name) ?? null;
}

/** measure/reset/barrier 는 인자 모양이 달라 표 밖에서 다룬다. */
export const SPECIAL_QASM = new Set(["measure", "reset", "barrier"]);

// ---------- 정규화 ----------

function emptyGrid(qubitCount) {
  return Array.from({ length: MAX_COLUMNS }, () => new Array(qubitCount).fill(null));
}

function cloneCell(cell) {
  return {
    gate: cell.gate,
    targets: [...cell.targets],
    controls: [...(cell.controls ?? [])],
    params: { ...(cell.params ?? {}) },
  };
}

/**
 * 회로를 QASM 이 표현할 수 있는 정규형으로 바꾼다. **의미는 완전히 보존된다.**
 *
 * 1. 제어점(CTRL)을 같은 열 게이트들의 명시적 controls 로 접는다.
 *    QASM 에는 "열 전체에 제어를 건다"는 문법이 없다. 예전 export 는 CTRL 을 그냥
 *    건너뛰고 주석만 남겨서 **제어가 빠진 다른 회로**를 내보내고 있었다.
 * 2. 빈 열을 없앤다(ASAP 압축). QASM 은 순차 명령 목록이라 열 번호가 남지 않으므로,
 *    파싱해 되돌리면 어차피 압축된 모양이 된다. 양쪽을 같은 규칙으로 맞춰 둔다.
 *
 * @returns {{grid, changed: {emptyColumns: boolean, controlDots: boolean}}}
 */
export function normalizeCircuit(qubitCount, grid) {
  const out = emptyGrid(qubitCount);
  let controlDots = false;
  let moved = false;

  // **배치 규칙은 parseQASM 과 반드시 같아야 한다** — 큐비트별로 비는 즉시(ASAP) 놓는다.
  // 한쪽은 열 단위로 압축하고 다른 쪽은 ASAP 이면 정규형이 둘이 되어 왕복 비교가 깨진다.
  const nextFree = new Array(qubitCount).fill(0);
  // 고전 비트도 자원이다. 이걸 빼먹으면 조건부 게이트가 **그 조건을 쓰는 measure 앞으로**
  // 당겨져 인과가 뒤집힌다(왕복 테스트가 실제로 이걸 잡았다).
  const clbitReady = new Map();
  let placed = 0;

  for (let col = 0; col < grid.length; col++) {
    // 이 열의 제어점들 — 같은 열 모든 게이트에 제어로 붙는다(circuit.js 와 같은 규칙).
    const dots = [];
    for (let q = 0; q < qubitCount; q++) {
      if (grid[col]?.[q]?.gate === "CTRL") dots.push(q);
    }
    if (dots.length) controlDots = true;

    // 행 순서로 순회한다 — toQASM 이 내보내는 순서와 같아야 파서가 같은 열에 되놓는다.
    for (let q = 0; q < qubitCount; q++) {
      const cell = grid[col]?.[q];
      if (!cell || cell.gate === "CTRL") continue;
      const next = cloneCell(cell);
      if (dots.length) {
        const seen = new Set(next.controls);
        for (const d of dots) {
          // 자기 타깃에는 제어를 걸 수 없고, 중복도 만들지 않는다.
          if (!next.targets.includes(d) && !seen.has(d)) {
            next.controls.push(d);
            seen.add(d);
          }
        }
        next.controls.sort((a, b) => a - b);
      }
      const used = [...next.targets, ...next.controls];
      let at = Math.max(...used.map((x) => nextFree[x]));
      // 조건부 게이트는 그 비트에 기록한 measure 뒤에 와야 한다.
      const cif = next.params?.cif;
      if (cif !== undefined) at = Math.max(at, clbitReady.get(cif) ?? 0);
      if (at >= MAX_COLUMNS) continue; // 열이 넘치면 버린다(파서도 같은 상한을 쓴다)
      if (at !== col) moved = true;
      out[at][next.targets[0]] = next;
      for (const x of used) nextFree[x] = at + 1;
      if (next.gate === "MEASURE") {
        const cb = next.params?.cbit ?? next.targets[0];
        clbitReady.set(cb, at + 1);
      }
      placed++;
    }
  }

  // "빈 열 제거"는 게이트가 실제로 왼쪽으로 당겨졌을 때만 보고한다 —
  // 열 개수만 비교하면 gap 이 있어도 개수가 같아 못 잡는다.
  return { grid: out, changed: { emptyColumns: moved, controlDots }, placed };
}

/** 두 회로가 셀 단위로 같은지. 왕복 테스트의 판정 기준. */
export function sameCircuit(aCount, aGrid, bCount, bGrid) {
  if (aCount !== bCount) return false;
  const key = (cell) =>
    cell
      ? JSON.stringify([cell.gate, cell.targets, [...(cell.controls ?? [])].sort((x, y) => x - y),
          Object.entries(cell.params ?? {}).sort(([m], [n]) => (m < n ? -1 : 1))])
      : null;
  for (let col = 0; col < MAX_COLUMNS; col++) {
    for (let q = 0; q < aCount; q++) {
      if (key(aGrid[col]?.[q]) !== key(bGrid[col]?.[q])) return false;
    }
  }
  return true;
}

// ---------- 파싱 ----------

/** 파싱 실패. 줄 번호와 **구체적 사유**를 함께 준다 — "syntax error" 만으로는 고칠 수 없다. */
function fail(line, message) {
  return { ok: false, line, message: `Line ${line}: ${message}` };
}

/** `q[3]` → 3. 레지스터 이름이 다르면 null. */
function parseReg(token, name) {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)\[(\d+)\]$/.exec(token.trim());
  if (!m || m[1] !== name) return null;
  return Number(m[2]);
}

/** 괄호 안 파라미터. pi 를 포함한 간단한 산술만 받는다. */
function parseParamList(text, line) {
  const parts = text.split(",").map((s) => s.trim()).filter((s) => s.length);
  const out = [];
  for (const raw of parts) {
    // pi/2, -pi, 1.5708, 2*pi/3 정도까지. 임의 식은 받지 않는다(안전·예측 가능성).
    if (!/^[-+0-9.eE\s*/()]*(pi)?[-+0-9.eE\s*/()pi]*$/.test(raw)) {
      return { error: fail(line, `Not supported: parameter expression '${raw}'`) };
    }
    const expr = raw.replace(/\bpi\b/g, "Math.PI");
    let value;
    try {
      // 위 정규식이 식별자·호출을 이미 막았다. 숫자와 연산자, Math.PI 만 남는다.
      value = Function(`"use strict";return (${expr});`)();
    } catch {
      return { error: fail(line, `Not supported: parameter expression '${raw}'`) };
    }
    if (!Number.isFinite(value)) return { error: fail(line, `invalid parameter '${raw}'`) };
    out.push(value);
  }
  return { values: out };
}

/** 조건 `if (c==N)` → 비트 인덱스. 2의 거듭제곱이 아니면 이 앱의 조건 모델로 표현할 수 없다. */
function conditionBit(value, line, cregName, name) {
  if (name !== cregName) return { error: fail(line, `unknown classical register '${name}'`) };
  if (value <= 0 || (value & (value - 1)) !== 0) {
    return {
      error: fail(
        line,
        `Not supported: multi-bit conditions (if (${name}==${value})). ` +
          `This app conditions on a single bit, so only powers of two work.`
      ),
    };
  }
  return { bit: Math.log2(value) };
}

/**
 * OpenQASM 2.0 → canonical 회로.
 *
 * **전부 성공하거나 아무것도 하지 않는다.** 임시 grid 에만 쌓고 마지막에 반환하므로,
 * 실패 시 호출부가 손댈 수 있는 부분 결과 자체가 존재하지 않는다.
 *
 * @returns {{ok:true, qubitCount, clbitCount, grid} | {ok:false, line, message}}
 */
export function parseQASM(text) {
  const rawLines = String(text).split("\n");

  // 주석 제거 후에도 원래 줄 번호를 유지해야 에러 위치가 맞는다.
  const stripped = rawLines.map((l) => l.replace(/\/\/.*$/, ""));

  let qubitCount = null;
  let clbitCount = 0;
  let qregName = null;
  let cregName = null;
  const ops = []; // { line, name, params, args, cif }

  // 블록 주석은 QASM 2.0 표준이 아니지만 흔히 섞여 들어온다 — 제거하되 줄 수는 유지한다.
  let inBlockComment = false;
  for (let i = 0; i < stripped.length; i++) {
    let s = stripped[i];
    if (inBlockComment) {
      const end = s.indexOf("*/");
      if (end < 0) { stripped[i] = ""; continue; }
      s = s.slice(end + 2);
      inBlockComment = false;
    }
    const start = s.indexOf("/*");
    if (start >= 0) { inBlockComment = true; s = s.slice(0, start); }
    stripped[i] = s;
  }

  // 세미콜론 단위로 자르되, 각 문장이 시작한 줄 번호를 기억한다.
  const statements = [];
  let buffer = "";
  let bufferLine = 1;
  for (let i = 0; i < stripped.length; i++) {
    const chunk = stripped[i];
    if (!buffer.trim() && chunk.trim()) bufferLine = i + 1;
    let rest = chunk;
    let idx;
    while ((idx = rest.indexOf(";")) >= 0) {
      buffer += rest.slice(0, idx);
      if (buffer.trim()) statements.push({ line: bufferLine, text: buffer.trim() });
      buffer = "";
      rest = rest.slice(idx + 1);
      if (rest.trim()) bufferLine = i + 1;
    }
    buffer += rest + " ";
    // 중괄호는 세미콜론 없이도 나타난다 — 커스텀 게이트 정의 감지용으로 따로 본다.
    if (/[{}]/.test(chunk)) statements.push({ line: i + 1, text: chunk.trim(), brace: true });
  }
  if (buffer.trim()) statements.push({ line: bufferLine, text: buffer.trim() });

  for (const st of statements) {
    const line = st.line;
    let text = st.text;
    if (!text) continue;

    if (st.brace) {
      if (/\bgate\b/.test(text) || text.includes("{")) {
        return fail(line, "Not supported: custom gate definitions (gate ... { })");
      }
      continue;
    }

    if (/^OPENQASM\b/i.test(text)) {
      const m = /^OPENQASM\s+([\d.]+)$/i.exec(text);
      if (m && !m[1].startsWith("2")) {
        return fail(line, `Not supported: OpenQASM ${m[1]} (this app reads 2.0)`);
      }
      continue;
    }
    if (/^include\b/i.test(text)) continue;

    if (/^\s*(for|while|def|opaque)\b/.test(text)) {
      return fail(line, "Not supported: loops and functions");
    }
    if (/^\s*gate\b/.test(text)) {
      return fail(line, "Not supported: custom gate definitions (gate ... { })");
    }

    // qreg / creg
    let m = /^(qreg|creg)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\[\s*(\d+)\s*\]$/.exec(text);
    if (m) {
      const size = Number(m[3]);
      if (m[1] === "qreg") {
        if (qregName !== null) return fail(line, "Not supported: multiple qreg/creg (only one of each)");
        if (size < MIN_QUBITS) return fail(line, `needs at least ${MIN_QUBITS} qubit`);
        if (size > MAX_QUBITS) return fail(line, `needs ${size} qubits, but the maximum is ${MAX_QUBITS}`);
        qregName = m[2];
        qubitCount = size;
      } else {
        if (cregName !== null) return fail(line, "Not supported: multiple qreg/creg (only one of each)");
        if (size > MAX_QUBITS) return fail(line, `needs ${size} classical bits, but the maximum is ${MAX_QUBITS}`);
        cregName = m[2];
        clbitCount = size;
      }
      continue;
    }
    if (/^(qreg|creg)\b/.test(text)) return fail(line, `malformed register declaration`);

    // if (c==N) <statement>
    let cif;
    m = /^if\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*==\s*(\d+)\s*\)\s*(.*)$/.exec(text);
    if (m) {
      if (cregName === null) return fail(line, "condition used but no creg is declared");
      const cond = conditionBit(Number(m[2]), line, cregName, m[1]);
      if (cond.error) return cond.error;
      cif = cond.bit;
      text = m[3].trim();
      if (!text) return fail(line, "if without a statement");
    }

    if (qubitCount === null) return fail(line, "a gate appears before qreg is declared");

    // measure q[i] -> c[j]
    m = /^measure\s+(\S+)\s*->\s*(\S+)$/.exec(text);
    if (m) {
      const q = parseReg(m[1], qregName);
      const c = cregName === null ? null : parseReg(m[2], cregName);
      if (q === null) return fail(line, `unknown qubit '${m[1].trim()}'`);
      if (c === null) return fail(line, `unknown classical bit '${m[2].trim()}'`);
      if (q >= qubitCount) return fail(line, `qubit index ${q} is out of range`);
      if (c >= clbitCount) return fail(line, `classical bit index ${c} is out of range`);
      ops.push({ line, name: "measure", args: [q], params: [], cif, cbit: c });
      continue;
    }
    if (/^measure\b/.test(text)) return fail(line, "malformed measure (expected: measure q[i] -> c[j])");

    // 일반 게이트: name(params) args
    m = /^([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(([^)]*)\))?\s*(.*)$/.exec(text);
    if (!m) return fail(line, `could not read this statement`);
    const name = m[1];
    const paramText = m[2] ?? "";
    const argText = (m[3] ?? "").trim();

    let params = [];
    if (paramText.trim()) {
      const parsed = parseParamList(paramText, line);
      if (parsed.error) return parsed.error;
      params = parsed.values;
    }

    const argTokens = argText ? argText.split(",").map((s) => s.trim()).filter(Boolean) : [];
    const args = [];
    for (const tok of argTokens) {
      const q = parseReg(tok, qregName);
      if (q === null) {
        // 레지스터 전체를 넘기는 형태(barrier q;)는 인덱스가 없다 — 아래에서 따로 본다.
        if (tok === qregName) { args.push(-1); continue; }
        return fail(line, `unknown qubit '${tok}'`);
      }
      if (q >= qubitCount) return fail(line, `qubit index ${q} is out of range (qreg has ${qubitCount})`);
      args.push(q);
    }

    if (SPECIAL_QASM.has(name)) {
      ops.push({ line, name, args, params, cif });
      continue;
    }

    const op = opByName(name);
    if (!op) {
      // 이 앱이 아는 게이트지만 그 제어 수를 QASM 으로 못 쓰는 경우와, 아예 모르는 이름을 구분한다.
      const mcx = /^(?:c(\d+)x|mcx)$/.exec(name);
      if (mcx) {
        return fail(line, `Not supported: ${name} has no OpenQASM 2.0 equivalent in this app (up to c4x)`);
      }
      return fail(line, `unknown gate '${name}'`);
    }
    if (args.length !== op.nc + op.nt) {
      return fail(line, `${name} expects ${op.nc + op.nt} qubit(s), got ${args.length}`);
    }
    if ((op.params?.length ?? 0) !== params.length) {
      return fail(line, `${name} expects ${op.params?.length ?? 0} parameter(s), got ${params.length}`);
    }
    if (args.some((a) => a < 0)) return fail(line, `${name} needs indexed qubits like ${qregName}[0]`);
    if (new Set(args).size !== args.length) return fail(line, `${name} uses the same qubit twice`);
    ops.push({ line, name, args, params, cif, op });
  }

  if (qubitCount === null) return fail(1, "no qreg declared (expected: qreg q[n];)");

  // ---- 배치: 각 연산을 가능한 가장 이른 열에 놓는다(ASAP). normalizeCircuit 과 같은 규칙. ----
  const grid = emptyGrid(qubitCount);
  const nextFree = new Array(qubitCount).fill(0);
  // 고전 비트도 자원이다 — normalizeCircuit 과 같은 규칙이어야 정규형이 하나로 유지된다.
  const clbitReady = new Map();

  for (const o of ops) {
    let cell;
    if (o.name === "measure") {
      cell = { gate: "MEASURE", targets: [o.args[0]], controls: [], params: { cbit: o.cbit } };
    } else if (o.name === "reset") {
      if (o.args.length !== 1) return fail(o.line, "reset expects one qubit");
      cell = { gate: "RESET", targets: [o.args[0]], controls: [], params: {} };
    } else if (o.name === "barrier") {
      // barrier q; (레지스터 전체)는 첫 큐비트에 놓는다 — 이 앱의 배리어는 열 표시용이다.
      const t = o.args.length && o.args[0] >= 0 ? o.args[0] : 0;
      cell = { gate: "BARRIER", targets: [t], controls: [], params: {} };
    } else {
      const op = o.op;
      const controls = o.args.slice(0, op.nc);
      const targets = o.args.slice(op.nc);
      const params = {};
      (op.params ?? []).forEach((k, i) => { params[k] = o.params[i]; });
      if (o.cif !== undefined) params.cif = o.cif;
      cell = { gate: op.gate, targets, controls, params };
      if (!GATE_INFO[op.gate]) return fail(o.line, `unknown gate '${o.name}'`);
    }
    if (o.cif !== undefined && cell.params.cif === undefined) cell.params.cif = o.cif;

    const used = [...cell.targets, ...cell.controls];
    let col = Math.max(...used.map((q) => nextFree[q]));
    const cif = cell.params?.cif;
    if (cif !== undefined) col = Math.max(col, clbitReady.get(cif) ?? 0);
    if (col >= MAX_COLUMNS) {
      return fail(o.line, `too many columns (the circuit holds at most ${MAX_COLUMNS})`);
    }
    grid[col][cell.targets[0]] = cell;
    for (const q of used) nextFree[q] = col + 1;
    if (cell.gate === "MEASURE") clbitReady.set(cell.params.cbit, col + 1);
  }

  return { ok: true, qubitCount, clbitCount, grid };
}
