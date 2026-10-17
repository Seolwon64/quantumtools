// OpenQASM 2.0 ↔ canonical 회로. **양방향이 이 파일 하나를 본다.**
//
// 예전에는 매핑 지식이 export.js 안에 다섯 군데로 흩어져 있었다(SIMPLE, PARAM,
// qasmControlled(), toQASM 본문 if-else, controlledQiskit()). 역방향 파서가 그 지식을
// 다시 적으면 export 와 parse 가 조용히 갈라져 왕복이 깨진다. 그래서 QASM_OPS 표 하나로
// 합치고 export 도 parse 도 이 표만 인덱싱한다.

import { GATE_INFO, homeRow, columnCells } from "./quantum.js";
import { MIN_QUBITS, MAX_QUBITS, MAX_COLUMNS, canCondition, conditionRejection } from "./circuit.js";

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
 * ASAP 배치기 — **normalizeCircuit(내보내기)과 parseQASM(가져오기)이 같은 함수를 쓴다.** 예전엔 같은 규칙이 두 곳에 따로 적혀
 * 있었다. 갈라지면 정규형이 둘이 되어 왕복이 깨진다.
 *
 * 셀을 실행 순서(원래 열, 그다음 homeRow — 앱이 도는 순서. 가져오기에서는 문장 순서)로 받아, 그 셀이 갈 수 있는 가장 이른 열을
 * 돌려준다. 넘치면 -1. 순서를 정하는 자원은 큐비트와 **고전 비트**다. 고전 비트는 읽기(조건 cif)와 쓰기(measure 의 기록 비트)를
 * 구분한다 — 읽기는 마지막 쓰기 뒤, 쓰기는 마지막 읽기·쓰기 뒤, 읽기끼리는 같은 열을 나눠 쓴다. "뒤" 는 다음 열 이후이거나, 같은
 * 열이면 더 아래 행이다(앱은 한 열을 homeRow 오름차순으로 돈다).
 *
 * 예전엔 고전 비트를 "조건은 그 비트를 쓴 measure 의 다음 열" 하나로만 봤다. 그래서 (1) 조건이 읽은 뒤 그 비트를 덮어쓰는 measure 가
 * 조건 앞으로 당겨졌고(P(q1=1) 1 → 0), (2) 같은 열에서 같은 비트를 쓰는 측정 둘의 순서가 뒤집혔고, (3) 같은 열의 쓰기 → 읽기가 열을
 * 하나 더 써서 12열을 다 쓴 회로의 마지막 게이트가 내보내기에서 조용히 사라졌다(셀 13 → 12) — 모두 실측. 이 규칙이면 앱이 만든 회로는
 * 열이 늘지 않는다: 앞선 제약은 모두 원래 더 앞 열이거나 같은 열의 위 행이라 원래 열 이하에서 풀린다.
 */
function createPlacer(qubitCount) {
  const nextFree = new Array(qubitCount).fill(0);
  const lastWrite = new Map(); // 비트 → { col, row }
  const lastRead = new Map(); // 비트 → { col, row } — 실행 순서로 가장 늦은 읽기
  // mark 뒤에 도는 가장 이른 열 — 같은 열이라도 아래 행이면 뒤다.
  const after = (mark, row) => (mark === undefined ? 0 : row > mark.row ? mark.col : mark.col + 1);
  const isLater = (mark, than) => !than || mark.col > than.col || (mark.col === than.col && mark.row > than.row);
  return function place(cell) {
    const row = homeRow(cell);
    const qubits = [...cell.targets, ...(cell.controls ?? [])];
    const read = cell.params?.cif;
    const write = cell.gate === "MEASURE" ? (cell.params?.cbit ?? cell.targets[0]) : undefined;
    let col = Math.max(...qubits.map((q) => nextFree[q]));
    if (read !== undefined) col = Math.max(col, after(lastWrite.get(read), row));
    if (write !== undefined) col = Math.max(col, after(lastWrite.get(write), row), after(lastRead.get(write), row));
    if (col >= MAX_COLUMNS) return -1;
    for (const q of qubits) nextFree[q] = col + 1;
    const mark = { col, row };
    if (read !== undefined && isLater(mark, lastRead.get(read))) lastRead.set(read, mark);
    if (write !== undefined) lastWrite.set(write, mark);
    return col;
  };
}

/**
 * 회로를 QASM 이 표현할 수 있는 정규형으로 바꾼다. **의미는 완전히 보존된다.**
 *
 * 1. 제어점(CTRL)을 같은 열 게이트들의 명시적 controls 로 접는다.
 *    QASM 에는 "열 전체에 제어를 건다"는 문법이 없다. 예전 export 는 CTRL 을 그냥
 *    건너뛰고 주석만 남겨서 **제어가 빠진 다른 회로**를 내보내고 있었다.
 * 2. 빈 열을 없앤다(ASAP 압축, createPlacer). QASM 은 순차 명령 목록이라 열 번호가 남지 않으므로,
 *    파싱해 되돌리면 어차피 압축된 모양이 된다. 양쪽이 같은 배치기를 쓴다.
 *
 * 넘치면 **던진다.** 앱이 만든 회로에서는 일어나지 않는다(createPlacer 주석). 일어났다면 그리드가 앱 규칙을 어긴 것이다 — 같은 열에서
 * 큐비트가 겹치는 셀(공유 링크는 막지 않는다)이나 여러 게이트에 걸린 제어점처럼. 예전엔 넘친 셀을 조용히 버려, 내보낸 코드에서 게이트가
 * 사라졌다. 코드 밴드가 이 예외를 받아 사유로 보인다(codepanel.js exportCode).
 *
 * @returns {{grid, changed: {emptyColumns: boolean, controlDots: boolean}, placed: number, origin}}
 *   origin[col][row] — 정규형의 그 셀이 원래 그리드에서 있던 열(0부터). 정규화가 셀을 앞당기므로
 *   내보낸 텍스트의 순서로는 사용자가 보는 열을 알 수 없다 — Apply 가 지울 게이트를 "몇 열" 로 말할 때 쓴다.
 */
export function normalizeCircuit(qubitCount, grid) {
  const out = emptyGrid(qubitCount);
  const origin = emptyGrid(qubitCount);
  let controlDots = false;
  let moved = false;
  const place = createPlacer(qubitCount);
  let placed = 0;

  for (let col = 0; col < grid.length; col++) {
    // 이 열의 제어점들 — 같은 열 모든 게이트에 제어로 붙는다(circuit.js 와 같은 규칙).
    const dots = [];
    for (let q = 0; q < qubitCount; q++) {
      if (grid[col]?.[q]?.gate === "CTRL") dots.push(q);
    }
    if (dots.length) controlDots = true;

    // 실행 순서로 돈다 — 배치기의 "같은 열의 아래 행" 판정이 앱이 그 열을 도는 순서와 같아야 한다.
    for (const cell of columnCells(grid, col, qubitCount)) {
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
      const at = place(next);
      if (at < 0) {
        throw new Error(
          `This circuit can't be exported: written one operation per line it needs more than ${MAX_COLUMNS} columns ` +
            `(gates in column ${col + 1} overlap or share a control dot).`
        );
      }
      if (at !== col) moved = true;
      out[at][homeRow(next)] = next;
      origin[at][homeRow(next)] = col;
      placed++;
    }
  }

  // "빈 열 제거"는 게이트가 실제로 왼쪽으로 당겨졌을 때만 보고한다 —
  // 열 개수만 비교하면 gap 이 있어도 개수가 같아 못 잡는다.
  return { grid: out, changed: { emptyColumns: moved, controlDots }, placed, origin };
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

/** `c[3]` → { name: "c", index: 3 }. 인덱스가 없으면 null. */
function parseBitRef(token) {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)\[(\d+)\]$/.exec(token.trim());
  return m ? { name: m[1], index: Number(m[2]) } : null;
}

/**
 * `if (r==v)` 을 **OpenQASM 의 뜻(레지스터 r 전체가 정수 v 와 같다)** 으로 읽어 앱의 조건 비트(c[k] == 1)로 옮긴다. 옮길 수 없으면
 * 줄 번호와 이유를 붙여 거부한다.
 *   - 1비트 r: v = 1 일 때만 그 비트. 그 밖(v = 0 등)은 거부한다 — 앱의 조건은 "비트가 1" 뿐이다.
 *   - 여러 비트 r: v = 2^k 이고 k < r 의 폭이며, 그 줄 앞에서 r 의 **다른** 비트를 쓴 measure 가 없을 때만 받는다. 레지스터는 0 으로
 *     시작하므로 그때 "r == 2^k" 와 "r[k] == 1" 이 같은 뜻이다. k 가 폭을 넘으면 이어 붙인 번호가 옆 레지스터로 넘어가므로 거부한다.
 * 예전엔 다른 비트를 무시하고 `c==2^k` 를 비트 k 로 읽었다(앱만의 뜻). 표준대로 쓴 Qiskit 텍스트가 조용히 다른 회로가 됐다 — c[0]·c[1] 을
 * 쓴 뒤의 `if (c==2)` 는 표준으로 P(q2=1) 0.25 인데 0.5 로 읽혔다(실측). 같은 이유로 앱이 예전에 비트 둘 이상을 쓰고 내보낸
 * 텍스트(텔레포테이션)는 이제 거부된다. 비트 하나만 쓰인 예전 텍스트는 같은 뜻이라 그대로 읽힌다.
 * 전체 레지스터 measure(`measure q -> c;`)는 받지 않는다(parseBitRef 가 인덱스를 요구한다). 받게 되면 아래 "다른 비트가 먼저 쓰였나" 에서
 * 레지스터의 모든 비트를 쓴 것으로 세야 한다.
 * @param writtenAt 앱 비트 번호 → 그 비트를 처음 쓴 measure 의 줄. 문장 순서로 채워지므로 "그 줄 앞" 이다.
 */
function conditionBit(name, value, line, cregs, writtenAt) {
  const reg = cregs.get(name);
  if (!reg) return { error: fail(line, `unknown classical register '${name}'`) };
  const { offset, size } = reg;
  if (size === 1) {
    if (value === 1) return { bit: offset };
    return {
      error: fail(line, `Not supported: if (${name}==${value}) — this app conditions on a classical bit being 1, ` +
        `so a 1-bit register can only be compared with 1`),
    };
  }
  const k = Math.log2(value);
  if (!Number.isInteger(k)) {
    return {
      error: fail(line, `Not supported: multi-bit conditions (if (${name}==${value})). ` +
        `This app conditions on one classical bit being 1.`),
    };
  }
  if (k >= size) {
    return { error: fail(line, `Not supported: if (${name}==${value}) is never true — ${name} has only ${size} bits`) };
  }
  for (let j = 0; j < size; j++) {
    if (j === k || !writtenAt.has(offset + j)) continue;
    return {
      error: fail(line, `if (${name}==${value}) compares all ${size} bits of ${name}, but ${name}[${j}] is written on line ` +
        `${writtenAt.get(offset + j)} — this app conditions on one bit. Use a 1-bit register per condition bit ` +
        `(creg ${name}${k}[1]; … if (${name}${k}==1) …).`),
    };
  }
  return { bit: offset + k };
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
  // 고전 레지스터는 여럿 받아 선언 순서로 이어 붙인다 — 앱의 고전 비트는 번호 하나다. 내보내기가 조건 있는 회로를 비트마다 1비트
  // 레지스터(c0[1], c1[1] …)로 쓰기 때문에 받아야 왕복한다.
  const cregs = new Map(); // 이름 → { offset, size }
  const writtenAt = new Map(); // 앱 비트 번호 → 그 비트를 처음 쓴 measure 의 줄
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
      const name = m[2];
      if (m[1] === "qreg") {
        if (qregName !== null) return fail(line, "Not supported: multiple qreg (only one quantum register)");
        if (cregs.has(name)) return fail(line, `quantum register '${name}' has the same name as a classical register`);
        if (size < MIN_QUBITS) return fail(line, `needs at least ${MIN_QUBITS} qubit`);
        if (size > MAX_QUBITS) return fail(line, `needs ${size} qubits, but the maximum is ${MAX_QUBITS}`);
        qregName = name;
        qubitCount = size;
      } else {
        if (cregs.has(name)) return fail(line, `classical register '${name}' is declared twice`);
        if (name === qregName) return fail(line, `classical register '${name}' has the same name as the quantum register`);
        if (clbitCount + size > MAX_QUBITS) {
          return fail(line, `needs ${clbitCount + size} classical bits, but the maximum is ${MAX_QUBITS}`);
        }
        cregs.set(name, { offset: clbitCount, size });
        clbitCount += size;
      }
      continue;
    }
    if (/^(qreg|creg)\b/.test(text)) return fail(line, `malformed register declaration`);

    // if (c==N) <statement>
    let cif;
    m = /^if\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*==\s*(\d+)\s*\)\s*(.*)$/.exec(text);
    if (m) {
      if (cregs.size === 0) return fail(line, "condition used but no creg is declared");
      const cond = conditionBit(m[1], Number(m[2]), line, cregs, writtenAt);
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
      const ref = parseBitRef(m[2]);
      const reg = ref && cregs.get(ref.name);
      if (q === null) return fail(line, `unknown qubit '${m[1].trim()}'`);
      if (!reg) return fail(line, `unknown classical bit '${m[2].trim()}'`);
      if (q >= qubitCount) return fail(line, `qubit index ${q} is out of range`);
      // 레지스터마다 폭을 본다 — 이어 붙인 번호만 보면 a[2] 가 옆 레지스터 b[0] 으로 넘어간다.
      if (ref.index >= reg.size) return fail(line, `classical bit index ${ref.index} is out of range (${ref.name} has ${reg.size})`);
      if (cif !== undefined) return fail(line, conditionRejection("MEASURE"));
      const cbit = reg.offset + ref.index;
      if (!writtenAt.has(cbit)) writtenAt.set(cbit, line);
      ops.push({ line, name: "measure", args: [q], params: [], cbit });
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
      // 앱은 reset·barrier 에 조건을 붙이지 않는다(canCondition). 받으면 셀에 조건이 남는데 화면 메뉴로는 지울 수도 없다.
      if (cif !== undefined) return fail(line, conditionRejection(name.toUpperCase()));
      ops.push({ line, name, args, params });
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
    if (cif !== undefined && !canCondition(op.gate)) return fail(line, conditionRejection(op.gate));
    ops.push({ line, name, args, params, cif, op });
  }

  if (qubitCount === null) return fail(1, "no qreg declared (expected: qreg q[n];)");

  // ---- 배치: 문장 순서로 가능한 가장 이른 열에 놓는다 — normalizeCircuit 과 같은 배치기(createPlacer). ----
  const grid = emptyGrid(qubitCount);
  const place = createPlacer(qubitCount);

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

    // 외부 텍스트는 12열에 안 들어갈 수 있다 — 내보내기와 달리 정상적인 실패다.
    const col = place(cell);
    if (col < 0) return fail(o.line, `too many columns (the circuit holds at most ${MAX_COLUMNS})`);
    grid[col][homeRow(cell)] = cell;
  }

  return { ok: true, qubitCount, clbitCount, grid };
}
