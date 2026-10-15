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

/**
 * 회로 자체의 서명 — "회로가 바뀌었는가" 를 렌더와 구별할 때 쓴다(코드 밴드의 충돌 줄·두 단계 Apply).
 * **공유 URL 인코딩을 그대로 쓴다.** 그 형식이 이미 "회로를 빠짐없이, 보기 상태는 빼고" 를 지키도록 만들어져 있어
 * 회로의 정의처가 하나로 남는다. 따로 JSON.stringify(grid) 로 만들면 두 방향으로 틀린다 — grid 에 무관한 값이 붙거나
 * 키 순서가 다르면 거짓 충돌이 남고(넘침), 회로 정보가 grid 밖에 생기면 진짜 변경을 놓쳐 Apply 가 그것을 소리 없이
 * 덮어쓴다(모자람 — 데이터 손실).
 * 한계: 각도는 인코딩처럼 소수 6자리다. UI 로 만들 수 있는 가장 작은 변경은 1° 슬라이더(0.017 rad)라 닿지 않는다.
 */
export function circuitSignature(snapshot) {
  return encodeCircuit(snapshot.qubitCount, snapshot.grid, snapshot.clbitCount);
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
      visit(cell, col, row);
    }
  }
}

/**
 * "S with 1 control" · "Z with 2 controls" · "S" — 제어가 붙은 게이트를 부르는 이름은 이 규칙 하나다.
 * 표시 줄·화면 경고·상태 줄·Qiskit 주석이 모두 여기서 이름을 얻는다(예전엔 "control(s)" 를 네 곳에 따로 적었다).
 */
function withControls(gate, controlCount) {
  if (!controlCount) return gate;
  return `${gate} with ${controlCount} control${controlCount === 1 ? "" : "s"}`;
}

/** 표현 불가 표시 줄의 머리말. Apply 판정이 이 머리말로 "내보내기가 남긴 표시 줄이었던 줄" 을 알아본다. */
export const UNREPRESENTABLE_PREFIX = "// cannot be represented in OpenQASM 2.0:";

/**
 * 셀 하나가 QASM 문으로 나가지 못하면 그 사실을, 나갈 수 있으면 null 을 돌려준다.
 * 표시 줄·화면 경고·Apply 판정이 **이 함수 하나**에서 나온다 — 내보내기와 판정이 따로 규칙을 적으면
 * "표시 줄이 남았는데 알리지 않는" 경우가 조용히 생긴다(QASM_OPS 표를 하나로 둔 것과 같은 이유).
 *
 * 표시 줄에 큐비트를 넣는다. 예전엔 게이트 이름뿐이라 다른 큐비트의 CS 두 개가 같은 줄이 되어, 사용자가
 * 어느 쪽 줄을 지웠는지 가릴 수 없었다. 열은 넣지 않는다 — 텍스트는 정규화(ASAP)된 순서라 위치가 회로의
 * 열이 아니고, 충돌 뒤 Keep 처럼 회로가 바뀌어도 게이트·큐비트는 맞는다.
 * @param column 원래 그리드의 열(1부터) — 경고와 상태 줄이 사용자가 보는 열을 말한다.
 * @returns {{what, marker, warning, label} | null}
 */
function unrepresentable(cell, clbitCount, column) {
  const { gate, targets, controls = [], params = {} } = cell;
  if (gate === "MEASURE") {
    const cb = params.cbit ?? targets[0];
    if (clbitCount > 0 && cb < clbitCount) return null;
    // 예전엔 줄을 아예 쓰지 않았다 — 배너 경고만 있어 Apply 판정이 "사용자가 지웠다" 와 구별할 수 없었다.
    const what = `MEASURE on q[${targets[0]}]`;
    return {
      what,
      marker: `${UNREPRESENTABLE_PREFIX} ${what} (no classical bit to write to)`,
      warning: `${what} at column ${column} has no classical bit to write to — that line is a comment, not a measurement.`,
      label: `${what} (column ${column}, no classical bit)`,
    };
  }
  if (gate === "RESET" || gate === "BARRIER" || opFor(gate, controls.length)) return null;
  const what = `${withControls(gate, controls.length)} on ${[...controls, ...targets].map((i) => `q[${i}]`).join(",")}`;
  return {
    what,
    marker: `${UNREPRESENTABLE_PREFIX} ${what}`,
    warning: `${what} at column ${column} cannot be represented in OpenQASM 2.0 — that line is a comment, not a gate.`,
    label: `${what} (column ${column})`,
  };
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
  const { grid, origin } = normalizeCircuit(qubitCount, rawGrid);
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

  eachCell(qubitCount, grid, (cell, col, row) => {
    const { gate, targets, controls = [], params = {} } = cell;

    const lost = unrepresentable(cell, clbitCount, origin[col][row] + 1);
    if (lost) {
      lines.push(lost.marker);
      warnings.push(lost.warning);
      return;
    }
    if (gate === "MEASURE") {
      lines.push(`measure ${q(targets[0])} -> c[${params.cbit ?? targets[0]}];`);
      return;
    }
    if (gate === "RESET") { lines.push(`reset ${q(targets[0])};`); return; }
    if (gate === "BARRIER") { lines.push(`barrier ${q(targets[0])};`); return; }

    const op = opFor(gate, controls.length);
    const args = [...controls, ...targets].map(q).join(",");
    const ps = (op.params ?? []).map((k) => fmt(params[k] ?? GATE_INFO[gate]?.defaultTheta));
    const call = ps.length ? `${op.qasm}(${ps.join(",")})` : op.qasm;
    push(`${call} ${args};`, params);
  });

  return { code: lines.join("\n") + "\n", warnings };
}

/**
 * Apply 가 **알리지 않고** 지울 게이트 — 표현 못 한 게이트 가운데 그 표시 줄이 편집된 텍스트에 남은 것.
 *
 * Apply 는 텍스트에서 회로를 통째로 다시 만든다. 표시 줄은 주석이라 파서가 버리고 게이트는 사라진다.
 * 그 줄이 남아 있으면 사용자는 그 게이트를 지울 생각이 없었고, 직접 지웠으면 지운다는 뜻이다.
 * **의심스러우면 알린다.** 머리말로 시작하는데 어느 게이트와도 맞지 않는 줄이 남아 있으면(큐비트를 고쳤다든지)
 * 무엇을 뜻했는지 모르므로, 짝을 못 찾은 게이트를 모두 넣는다. 지울 뜻이 있었는데 경고하는 비용은 클릭
 * 한 번이고, 지울 뜻이 없었는데 경고하지 않는 비용은 조용한 회로 변경이다.
 * 줄 앞뒤 공백은 무시한다. 글자까지 같은 표시 줄(같은 게이트·같은 큐비트)은 내보낸 순서대로 짝짓는다.
 *
 * DOM 을 모른다 — 코드 밴드(codepanel.js)가 두 단계 Apply 와 배너에 쓴다.
 * @returns {Array<{gate, controls, targets, column, what, label, warning}>} 내보낸 순서. column 은 원래 그리드의 열(1부터).
 */
export function gatesApplyWouldDrop(qubitCount, rawGrid, clbitCount, editedText) {
  return lossesOnApply(qubitCount, rawGrid, clbitCount, editedText).unannounced;
}

/**
 * Apply 가 지울 표현 불가 게이트 전부를 둘로 나눈다.
 *   unannounced — 알리지 않고 지울 것(표시 줄이 남았거나, 의심스러운 줄이 있어 모두 알린다). 두 단계 확인을 거친다.
 *   lineDeleted — 사용자가 표시 줄을 직접 지운 것. 확인은 건너뛰지만 **실행 뒤 상태 줄에 적는다** — 지울 뜻을
 *                 잘못 판정했을 때의 비용이 크다(조용한 회로 변경).
 * 둘 다 내보낸 순서. 항목 모양은 gatesApplyWouldDrop 와 같다.
 */
export function lossesOnApply(qubitCount, rawGrid, clbitCount, editedText) {
  const { grid, origin } = normalizeCircuit(qubitCount, rawGrid);
  const lost = [];
  eachCell(qubitCount, grid, (cell, col, row) => {
    const column = origin[col][row] + 1;
    const u = unrepresentable(cell, clbitCount, column);
    if (u) lost.push({ gate: cell.gate, controls: [...(cell.controls ?? [])], targets: [...cell.targets], column, ...u });
  });
  if (!lost.length) return { unannounced: [], lineDeleted: [] };

  const remaining = new Map();
  for (const line of editedText.split("\n")) {
    const t = line.trim();
    if (t.startsWith(UNREPRESENTABLE_PREFIX)) remaining.set(t, (remaining.get(t) ?? 0) + 1);
  }
  const kept = lost.map((g) => {
    const n = remaining.get(g.marker) ?? 0;
    if (n > 0) remaining.set(g.marker, n - 1);
    return n > 0;
  });
  const strayMarker = [...remaining.values()].some((n) => n > 0);
  const strip = ({ marker, ...g }) => g;
  return {
    unannounced: lost.filter((_, i) => kept[i] || strayMarker).map(strip),
    lineDeleted: lost.filter((_, i) => !kept[i] && !strayMarker).map(strip),
  };
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
      const what = withControls(gate, controls.length);
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
