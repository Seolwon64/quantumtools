// 배치된 셀 하나의 유니터리 행렬을 구하는 **읽기 전용** 모듈. 시뮬레이션 경로와 분리돼 있고
// 회로/상태를 절대 수정하지 않는다.
//
// 핵심: 게이트별 2^n 행렬을 새로 유도하지 않는다. 관여 큐비트를 로컬 인덱스로 리맵한 뒤
// **엔진(applyPlacement)에 기저 벡터 e_j를 통과시켜 j번째 열**을 얻는다 → SWAP·RXX·RCCX 같은
// "행렬이 코드에 없는" 게이트도 자동으로 정확하고, 분해를 두 번 적을 일이 없다.
//
// 로컬 비트 순서: **타깃이 최하위 비트**(로컬 q0), 그 위로 컨트롤. 표시 켓은 |c…t⟩ 로 q0이 오른쪽
// 끝이라 앱의 |q2 q1 q0⟩ 표기와 방향이 같고, X+control 1개가 교과서 CNOT 행렬로 나온다.
import { applyPlacement, initialState, GATE_INFO, decompositionOf } from "./quantum.js";

export const MAX_DISPLAY_QUBITS = 3; // 8x8까지만 렌더링(제어 2개). 그 이상은 안내 문구로 대체.

// 로컬 자리 이름: 컨트롤은 c(여럿이면 c₁c₂…), 타깃은 t(둘 이상이면 t₁t₂…).
const SUB = ["₁", "₂", "₃", "₄"];

// 관여 큐비트의 로컬 배치. **실제 큐비트 번호 오름차순**으로 놓고, 왼쪽(작은 번호)이 높은 비트다
// → 캡션이 `local |c t⟩ = |q0 q1⟩` 처럼 왼→오 = q 오름차순으로 읽힌다.
// 역할 순이 아니라 큐비트 순으로 놓는 이유: 역할 순으로 고정하면 RCCX(a,b)와 RCCX(b,a)가
// **같은 행렬**이 되어(같은 연산자를 같은 로컬 축에 쓴 것뿐) 두 배치의 차이가 드러나지 않는다.
// 큐비트 순으로 놓으면 CZ/CCX는 컨트롤이 대칭이라 그대로지만, a·b에 비대칭인 RCCX는 달라진다.
function localLayout(cell) {
  const targets = cell.targets ?? [];
  const controls = cell.controls ?? [];
  const roleOf = new Map();
  if (GATE_INFO[cell.gate]?.kind === "decomposed") {
    // RCCX/RC3X: targets=[a,b,(c),t] — 마지막이 타깃, 앞은 전부 컨트롤
    const nc = targets.length - 1;
    targets.forEach((q, i) => {
      roleOf.set(q, i === nc ? "t" : nc > 1 ? `c${SUB[i]}` : "c");
    });
  } else {
    controls.forEach((q, i) => roleOf.set(q, controls.length > 1 ? `c${SUB[i]}` : "c"));
    targets.forEach((q, i) => roleOf.set(q, targets.length > 1 ? `t${SUB[i]}` : "t"));
  }
  const order = [...roleOf.keys()].sort((a, b) => a - b);
  return { order, roles: order.map((q) => roleOf.get(q)) };
}

// 로컬 인덱스로 리맵한 셀. order[k] = 실제 큐비트 → 로컬 큐비트 번호는 (n-1-k)
// (order의 앞쪽이 높은 비트 = 켓의 왼쪽).
function remapCell(cell, order) {
  const n = order.length;
  const toLocal = (q) => n - 1 - order.indexOf(q);
  return {
    gate: cell.gate,
    targets: (cell.targets ?? []).map(toLocal),
    controls: (cell.controls ?? []).map(toLocal),
    params: { ...(cell.params ?? {}) },
  };
}

// |b_{n-1} … b_0⟩ 형태의 기저 라벨 (인덱스 = 행/열 번호)
function basisLabelsFor(n) {
  const size = 1 << n;
  const labels = new Array(size);
  for (let i = 0; i < size; i++) labels[i] = `|${i.toString(2).padStart(n, "0")}⟩`;
  return labels;
}

/**
 * 셀의 유니터리 행렬. 반환:
 *   { ok:true, n, size, rows, basisLabels, localOrder, roles, qubits }
 *   { ok:false, tooLarge:true, n, size, ... }  — 8x8 초과
 *   { ok:false, reason }                        — 유니터리가 아닌 것(Measure/Barrier/Reset 등)
 * rows[r][c] = { re, im } (행 r, 열 c). U|col⟩ 의 성분.
 */
export function gateMatrix(cell) {
  const info = GATE_INFO[cell.gate];
  if (!info) return { ok: false, reason: `Unknown gate: ${cell.gate}` };
  if (info.kind === "noop" || info.kind === "reset" || info.kind === "dot") {
    return { ok: false, reason: `${info.label ?? cell.gate} is not a unitary gate` };
  }
  const { order, roles } = localLayout(cell);
  const n = order.length;
  const size = 1 << n;
  const localOrder = `local |${roles.join(" ")}⟩ = |${order.map((q) => `q${q}`).join(" ")}⟩`;
  if (n > MAX_DISPLAY_QUBITS) {
    return { ok: false, tooLarge: true, n, size, roles, localOrder, qubits: order };
  }

  // 열 단위 구성: e_col 에 게이트를 적용한 결과가 col번째 열.
  const local = remapCell(cell, order);
  const rows = Array.from({ length: size }, () => new Array(size));
  for (let col = 0; col < size; col++) {
    const basis = initialState(n);
    basis[0] = { re: 0, im: 0 };
    basis[col] = { re: 1, im: 0 };
    const out = applyPlacement(basis, local, []);
    for (let r = 0; r < size; r++) rows[r][col] = { re: out[r].re, im: out[r].im };
  }
  return { ok: true, n, size, rows, basisLabels: basisLabelsFor(n), localOrder, roles, qubits: order };
}

// ---------- 표기 ----------

const EPS = 5e-4;
// 알려진 값의 기호 표기(있을 때만 병기). 부호는 호출부에서 처리한다.
const SYMBOLS = [
  { v: 1, s: "1" },
  { v: Math.SQRT1_2, s: "1/√2" },
  { v: 0.5, s: "1/2" },
  { v: Math.sqrt(3) / 2, s: "√3/2" },
];
function symbolFor(x) {
  const a = Math.abs(x);
  const hit = SYMBOLS.find((e) => Math.abs(a - e.v) < EPS);
  if (!hit) return null;
  return (x < 0 ? "−" : "") + hit.s;
}

// -0 을 0으로 정규화하고 소수점 3자리로.
function fixed3(x) {
  const v = Math.abs(x) < EPS ? 0 : x;
  return (Object.is(v, -0) ? 0 : v).toFixed(3);
}

/** 복소수를 "0.707 − 0.707i" 형태로. 순실수/순허수는 짧게 쓴다. */
export function formatComplex(z) {
  const re = Math.abs(z.re) < EPS ? 0 : z.re;
  const im = Math.abs(z.im) < EPS ? 0 : z.im;
  if (re === 0 && im === 0) return "0";
  if (im === 0) return fixed3(re);
  const imPart = `${fixed3(Math.abs(im))}i`;
  if (re === 0) return im < 0 ? `−${imPart}` : imPart;
  return `${fixed3(re)} ${im < 0 ? "−" : "+"} ${imPart}`;
}

/** 알려진 값이면 기호 표기(예: "1/√2"), 아니면 null. 수치 옆에 병기하는 용도. */
export function symbolicComplex(z) {
  const re = Math.abs(z.re) < EPS ? 0 : z.re;
  const im = Math.abs(z.im) < EPS ? 0 : z.im;
  if (re === 0 && im === 0) return null;
  if (im === 0) return symbolFor(re);
  if (re === 0) {
    const s = symbolFor(im);
    return s === null ? null : (s.startsWith("−") ? `−${s.slice(1)}i` : `${s}i`);
  }
  const sr = symbolFor(re), si = symbolFor(im);
  if (sr === null || si === null) return null;
  const imAbs = si.startsWith("−") ? si.slice(1) : si;
  return `${sr} ${im < 0 ? "−" : "+"} ${imAbs}i`;
}

/** 한 줄 동작 설명. 제어가 붙으면 조건을 문장에 반영한다. */
export function gateDescription(cell) {
  const info = GATE_INFO[cell.gate];
  const nc = (cell.controls ?? []).length;
  const base = info?.desc ?? cell.gate;
  if (nc === 0) return base;
  const cond = nc === 1 ? "the control is |1⟩" : `all ${nc} controls are |1⟩`;
  if (cell.gate === "X") return `Flips the target when ${cond}`;
  if (cell.gate === "Z") return `Flips the phase of the target when ${cond}`;
  if (cell.gate === "SWAP") return `Swaps the two targets when ${cond}`;
  return `${base} — applied only when ${cond}`;
}

/** "Expand definition"용: 분해가 있으면 사람이 읽는 스텝 목록, 없으면 null. */
export function decompositionSteps(cell) {
  const steps = decompositionOf(cell.gate);
  if (!steps) return null;
  const targets = cell.targets ?? [];
  // 스텝의 on/control은 targets 인덱스이므로, 역할 이름도 targets 순서로 만든다.
  const { order, roles: sorted } = localLayout(cell);
  const roles = targets.map((q) => sorted[order.indexOf(q)]);
  return steps.map((s) => ({
    gate: s.gate,
    // 표시용: "H(t)", "CX(b,t)" 처럼 역할 기호로. 실제 큐비트도 함께 준다.
    text: s.control === undefined
      ? `${s.gate}(${roles[s.on]})`
      : `C${s.gate}(${roles[s.control]},${roles[s.on]})`,
    target: targets[s.on],
    control: s.control === undefined ? null : targets[s.control],
  }));
}
