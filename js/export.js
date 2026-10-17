// 회로 공유/내보내기: URL 해시 인코딩(base64url), OpenQASM 2.0 / Qiskit 코드 생성, Apply 가 지울 게이트 판정.
// 셀은 canonical { gate, targets, controls, params } 구조. 구버전(v:1) URL도 계속 열린다.
import { GATE_INFO } from "./quantum.js";
import { MIN_QUBITS, MAX_QUBITS, MAX_COLUMNS, migrateCell, canCondition, conditionRejection } from "./circuit.js";
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
      // 각도는 반올림하지 않는다. 예전엔 소수 6자리로 잘라, 링크를 한 번 열기만 해도 손대지 않은 각도가 바뀌었다
      // (1.2345678901 → 1.234568). JSON 은 숫자를 가장 짧은 정확 왕복 표현으로 쓴다 — 옛 6자리 링크도 그대로 읽힌다.
      if (prm.theta !== undefined) params.t = prm.theta;
      if (prm.phi !== undefined) params.f = prm.phi;
      if (prm.lambda !== undefined) params.l = prm.lambda;
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
 * 덮어쓴다(모자람 — 데이터 손실). 인코딩이 각도를 전체 정밀도로 담으므로 서명도 모든 각도 변경을 본다.
 */
export function circuitSignature(snapshot) {
  return encodeCircuit(snapshot.qubitCount, snapshot.grid, snapshot.clbitCount);
}

/**
 * 공유 URL 해시 → 회로. **실패는 늘 null 이다**(계약 — 프리셋·테스트 20곳이 이것만 본다).
 * 조건을 붙일 수 없는 게이트(측정·리셋 등)에 조건이 있으면 링크 전체를 거부한다. 받으면 셀에 조건이 남는데 내보내기가 그 조건을
 * 쓸 수 없고 화면 메뉴로도 지울 수 없다. 거부 사유는 반환값이 아니라 `onReject(reason)` 으로 준다 — QASM 가져오기와 같은 문장이다.
 * 그 밖의 해독 실패(형식 오류)는 사유 없이 null 이다.
 */
export function decodeCircuit(encoded, onReject) {
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
        if (params.cif !== undefined && !canCondition(p.g)) {
          onReject?.(conditionRejection(p.g));
          return null;
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

/** `#c=…` 해시 → 회로, 아니면 null. 거부 사유는 decodeCircuit 처럼 onReject 로 준다. 해시가 링크인지는 호출부가 `#c=` 로 본다. */
export function parseShareHash(hash, onReject) {
  const match = /^#c=([A-Za-z0-9_-]+)$/.exec(hash);
  return match ? decodeCircuit(match[1], onReject) : null;
}

export function buildShareUrl(qubitCount, grid, clbitCount) {
  return `${location.origin}${location.pathname}#c=${encodeCircuit(qubitCount, grid, clbitCount)}`;
}

// ---------- QASM / Qiskit ----------
// 매핑은 js/qasm.js 의 QASM_OPS 표 하나뿐이다. 여기서 게이트 이름을 다시 적지 않는다 —
// 예전엔 SIMPLE/PARAM/qasmControlled/본문 if-else 로 다섯 군데에 흩어져 있었고,
// 역방향 파서가 그 지식을 다시 적으면 export 와 parse 가 조용히 갈라진다.

// 각도는 전체 정밀도 — String(x) 는 가장 짧은 정확 왕복 표현이라 Number(String(x)) === x 다. 예전엔 소수 6자리로 잘라
// QASM Apply 한 번에 손대지 않은 각도가 바뀌었다. |x| < 1e-6 이나 ≥ 1e21 은 지수 표기(1e-7, 1e+21)가 되는데 소수점이
// 없어 엄밀한 OpenQASM 2.0 실수 문법은 아니다 — 앱 파서와 Qiskit(qasm2.loads·from_qasm_str)은 정확히 읽는다(실측).
function fmt(x) {
  return String(Number(x ?? 0));
}

/**
 * 고전 비트를 QASM 으로 쓰는 법 — 선언·측정 대상·조건 글자를 **한 곳**에서 만든다.
 * OpenQASM 2.0 의 `if (c==n)` 은 레지스터 **전체**를 정수와 비교하고, 비트 하나를 고르는 문법이 없다. 앱의 조건은 "c[k] 가 1" 이라,
 * 조건이 있고 비트가 2개 이상이면 비트마다 1비트 레지스터(`creg c0[1]; …`)를 두고 `if (ck==1)` 로 쓴다. 예전엔 `creg c[n]; if (c==2^k)` 로
 * 써서 Qiskit 이 "c 가 정확히 2^k" 로 읽었다 — 텔레포테이션의 q2 가 (+0.356, +0.707, 0) 이 됐다(정답 (+0.707, +0.707, 0), Aer 실측).
 * 그 밖에는 예전 글자 그대로다: 조건이 없으면 레지스터 하나가 Qiskit counts 키를 '000' 으로 남기고(1비트 레지스터면 '0 0 0'), 비트가
 * 하나면 `if (c==1)` 이 이미 정확하다(아래 condition 의 `1 << k` 는 그때 k = 0 이다).
 */
function classicalLayout(clbitCount, conditional) {
  const perBit = conditional && clbitCount > 1;
  return {
    declarations: clbitCount === 0 ? []
      : perBit ? Array.from({ length: clbitCount }, (_, k) => `creg c${k}[1];`)
        : [`creg c[${clbitCount}];`],
    bit: (k) => (perBit ? `c${k}[0]` : `c[${k}]`),
    condition: (k) => (perBit ? `if (c${k}==1)` : `if (c==${1 << k})`),
  };
}

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

/**
 * 표현 불가 표시 줄의 머리말. Apply 판정이 이 머리말로 "내보내기가 남긴 표시 줄이었던 줄" 을 알아본다.
 * "이 앱이 못 쓴다" 로 말한다 — 예전엔 "cannot be represented in OpenQASM 2.0" 이었는데, CS 처럼 엄격한 2.0 의 `cu1(pi/2)` 로 쓸 수
 * 있는 게이트도 이 줄이 됐다(docs/backlog.md QASM 호환).
 */
export const UNREPRESENTABLE_PREFIX = "// this app can't export to QASM:";

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
    warning: `${what} at column ${column} can't be exported to QASM by this app — that line is a comment, not a gate.`,
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
  const layout = classicalLayout(clbitCount, hasConditions(qubitCount, grid));
  const lines = ["OPENQASM 2.0;", 'include "qelib1.inc";', `qreg q[${qubitCount}];`, ...layout.declarations, ""];

  const q = (i) => `q[${i}]`;
  const push = (stmt, params) =>
    lines.push(params?.cif !== undefined ? `${layout.condition(params.cif)} ${stmt}` : stmt);

  eachCell(qubitCount, grid, (cell, col, row) => {
    const { gate, targets, controls = [], params = {} } = cell;

    const lost = unrepresentable(cell, clbitCount, origin[col][row] + 1);
    if (lost) {
      lines.push(lost.marker);
      warnings.push(lost.warning);
      return;
    }
    // 측정·리셋의 조건도 push 를 탄다 — 예전엔 조건을 조용히 빼고 썼다. 컨트롤러는 그런 셀을 갖지 않지만(canCondition) 이 함수는 순수
    // 함수라 받은 그리드를 그대로 쓴다. 배리어는 조건을 쓰지 않는다 — OpenQASM 2.0 의 if 뒤에는 qop 만 오고, 배리어는 상태를 바꾸지 않는다.
    if (gate === "MEASURE") {
      push(`measure ${q(targets[0])} -> ${layout.bit(params.cbit ?? targets[0])};`, params);
      return;
    }
    if (gate === "RESET") { push(`reset ${q(targets[0])};`, params); return; }
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
    "",
  ];

  // 조건은 if_test 블록이다. 예전의 `.c_if(qc.cregs[0], 2^k)` 는 Qiskit 2.0 에서 없어져 실행되지 않았고(AttributeError, 실측),
  // 그 전에도 레지스터 전체 비교였다. if_test 는 고전 비트 하나를 받으므로 앱의 조건이 그대로 들어간다 — 레지스터는 하나로 둔다.
  const push = (stmt, params) => {
    if (params?.cif === undefined) { lines.push(stmt); return; }
    lines.push(`with qc.if_test((qc.clbits[${params.cif}], 1)):`, `    ${stmt}`);
  };

  eachCell(qubitCount, grid, (cell) => {
    const { gate, targets, controls = [], params = {} } = cell;

    // 측정·리셋의 조건도 잃지 않는다(toQASM 과 같은 이유). 배리어는 상태를 바꾸지 않아 조건을 쓰지 않는다.
    if (gate === "MEASURE") {
      const cb = params.cbit ?? targets[0];
      if (clbitCount > 0 && cb < clbitCount) push(`qc.measure(${targets[0]}, ${cb})`, params);
      return;
    }
    if (gate === "RESET") { push(`qc.reset(${targets[0]})`, params); return; }
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
