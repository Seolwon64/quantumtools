// n큐비트 상태벡터 엔진: 게이트 적용, 부분상태(축약밀도행렬) Bloch 벡터, 계산기저 확률.

const SQRT1_2 = Math.SQRT1_2;

function c(re, im = 0) {
  return { re, im };
}
function cAdd(a, b) {
  return c(a.re + b.re, a.im + b.im);
}
function cMul(a, b) {
  return c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
}
function cConj(a) {
  return c(a.re, -a.im);
}

// 파라미터 없는 고정 게이트 행렬
const FIXED_MATRICES = {
  H: [
    [c(SQRT1_2), c(SQRT1_2)],
    [c(SQRT1_2), c(-SQRT1_2)],
  ],
  X: [
    [c(0), c(1)],
    [c(1), c(0)],
  ],
  Y: [
    [c(0), c(0, -1)],
    [c(0, 1), c(0)],
  ],
  Z: [
    [c(1), c(0)],
    [c(0), c(-1)],
  ],
  S: [
    [c(1), c(0)],
    [c(0), c(0, 1)],
  ],
  Sdg: [
    [c(1), c(0)],
    [c(0), c(0, -1)],
  ],
  T: [
    [c(1), c(0)],
    [c(0), c(SQRT1_2, SQRT1_2)],
  ],
  Tdg: [
    [c(1), c(0)],
    [c(0), c(SQRT1_2, -SQRT1_2)],
  ],
  I: [
    [c(1), c(0)],
    [c(0), c(1)],
  ],
  SX: [
    [c(0.5, 0.5), c(0.5, -0.5)],
    [c(0.5, -0.5), c(0.5, 0.5)],
  ],
  SXdg: [
    [c(0.5, -0.5), c(0.5, 0.5)],
    [c(0.5, 0.5), c(0.5, -0.5)],
  ],
};

// theta(라디안)를 받는 파라미터 게이트
const PARAM_MATRIX_BUILDERS = {
  RX: (theta) => {
    const cos = Math.cos(theta / 2);
    const sin = Math.sin(theta / 2);
    return [
      [c(cos), c(0, -sin)],
      [c(0, -sin), c(cos)],
    ];
  },
  RY: (theta) => {
    const cos = Math.cos(theta / 2);
    const sin = Math.sin(theta / 2);
    return [
      [c(cos), c(-sin)],
      [c(sin), c(cos)],
    ];
  },
  RZ: (theta) => [
    [c(Math.cos(theta / 2), -Math.sin(theta / 2)), c(0)],
    [c(0), c(Math.cos(theta / 2), Math.sin(theta / 2))],
  ],
  P: (theta) => [
    [c(1), c(0)],
    [c(0), c(Math.cos(theta), Math.sin(theta))],
  ],
};

// 팔레트/UI 메타데이터. group은 색상 분류용.
// kind: fixed(고정 1큐비트) | param(각도 1개) | param3(U: θ,φ,λ) |
//       controlled(base 게이트 + 컨트롤 N개) | swap(파트너 1개) |
//       pair-param(파트너 1개 + 각도) | dot(칼럼 컨트롤 점) |
//       reset(|0⟩ 사영) | noop(상태 불변)
// minQubits: 배치에 필요한 최소 큐비트 수 (팔레트 비활성 판단용)
export const GATE_INFO = {
  H: { label: "H", kind: "fixed", group: "hadamard", ready: true, desc: "Hadamard — creates superposition" },
  X: { label: "X", targetLabel: "⊕", kind: "fixed", group: "pauli", ready: true, desc: "Pauli-X (NOT)" },
  Y: { label: "Y", kind: "fixed", group: "rotation", ready: true, desc: "Pauli-Y" },
  Z: { label: "Z", kind: "fixed", group: "phase", ready: true, desc: "Pauli-Z" },
  S: { label: "S", kind: "fixed", group: "phase", ready: true, desc: "S — π/2 phase" },
  Sdg: { label: "S†", kind: "fixed", group: "phase", ready: true, desc: "S† — −π/2 phase" },
  T: { label: "T", kind: "fixed", group: "phase", ready: true, desc: "T — π/4 phase" },
  Tdg: { label: "T†", kind: "fixed", group: "phase", ready: true, desc: "T† — −π/4 phase" },
  I: { label: "I", kind: "fixed", group: "pauli", ready: true, desc: "Identity" },
  SX: { label: "√X", kind: "fixed", group: "rotation", ready: true, desc: "√X — square root of X" },
  SXdg: { label: "√X†", kind: "fixed", group: "rotation", ready: true, desc: "√X† — inverse of √X" },
  RX: { label: "RX", kind: "param", group: "rotation", ready: true, defaultTheta: Math.PI / 2, desc: "RX — rotation around X axis" },
  RY: { label: "RY", kind: "param", group: "rotation", ready: true, defaultTheta: Math.PI / 2, desc: "RY — rotation around Y axis" },
  RZ: { label: "RZ", kind: "param", group: "phase", ready: true, defaultTheta: Math.PI / 2, desc: "RZ — rotation around Z axis" },
  P: { label: "P", kind: "param", group: "phase", ready: true, defaultTheta: Math.PI / 2, desc: "Phase — phase rotation" },
  CNOT: { label: "CNOT", targetLabel: "⊕", kind: "controlled", base: "X", controls: 1, group: "pauli", ready: true, minQubits: 2, desc: "CNOT — controlled NOT" },
  CZ: { label: "CZ", targetLabel: "Z", kind: "controlled", base: "Z", controls: 1, group: "control", ready: true, minQubits: 2, desc: "CZ — controlled Z" },
  CCX: { label: "CCX", targetLabel: "⊕", kind: "controlled", base: "X", controls: 2, group: "pauli", ready: true, minQubits: 3, desc: "Toffoli (CCX) — double-controlled NOT" },
  SWAP: { label: "SWAP", targetLabel: "×", kind: "swap", group: "pauli", ready: true, minQubits: 2, desc: "SWAP — exchanges two qubits" },
  CSWAP: { label: "CSWAP", targetLabel: "×", kind: "cswap", controls: 1, group: "control", ready: true, minQubits: 3, desc: "CSWAP (Fredkin) — controlled swap of two qubits" },
  RXX: { label: "RXX", targetLabel: "RXX", kind: "pair-param", group: "rotation", ready: true, minQubits: 2, defaultTheta: Math.PI / 2, desc: "RXX — XX interaction rotation" },
  RYY: { label: "RYY", targetLabel: "RYY", kind: "pair-param", group: "rotation", ready: true, minQubits: 2, defaultTheta: Math.PI / 2, desc: "RYY — YY interaction rotation" },
  RZZ: { label: "RZZ", targetLabel: "RZZ", kind: "pair-param", group: "rotation", ready: true, minQubits: 2, defaultTheta: Math.PI / 2, desc: "RZZ — ZZ interaction rotation" },
  CTRL: { label: "•", kind: "dot", group: "structural", ready: true, desc: "Control — adds a control to gates in the same column" },
  RCCX: { label: "RCCX", targetLabel: "⊕", kind: "decomposed", qubits: 3, controls: 2, group: "advanced", ready: true, minQubits: 3, desc: "RCCX (Margolus) — Toffoli up to relative phase. Not equivalent to CCX. Safe only when the phase is uncomputed later." },
  RC3X: { label: "RC3X", targetLabel: "⊕", kind: "decomposed", qubits: 4, controls: 3, group: "advanced", ready: true, minQubits: 4, desc: "RC3X — relative-phase C3X. Not equivalent to C3X (CCCX). Safe only when the phase is uncomputed later." },
  U: { label: "U", kind: "param3", group: "rotation", ready: true, defaultTheta: Math.PI / 2, desc: "U — universal single-qubit rotation (θ, φ, λ)" },
  BARRIER: { label: "⋮", kind: "noop", group: "structural", ready: true, desc: "Barrier — visual separator (state unchanged)" },
  MEASURE: { label: "M", kind: "noop", group: "structural", ready: true, desc: "Measure — Z-basis measurement (fixes probabilities)" },
  RESET: { label: "|0⟩", kind: "reset", group: "structural", ready: true, desc: "Reset — initializes to |0⟩" },
  IF: { label: "if", kind: "noop", group: "structural", ready: false, desc: "If — classical conditional (unsupported: no measurement collapse)" },
};

function cPolar(r, angle) {
  return c(r * Math.cos(angle), r * Math.sin(angle));
}

// U(θ, φ, λ) 3-파라미터 범용 단일 큐비트 유니터리
export function uMatrix(theta, phi = 0, lambda = 0) {
  const cos = Math.cos(theta / 2);
  const sin = Math.sin(theta / 2);
  return [
    [c(cos), cPolar(-sin, lambda)],
    [cPolar(sin, phi), cPolar(cos, phi + lambda)],
  ];
}

export function matrixFor(gateName, theta) {
  if (FIXED_MATRICES[gateName]) return FIXED_MATRICES[gateName];
  if (PARAM_MATRIX_BUILDERS[gateName]) {
    const info = GATE_INFO[gateName];
    return PARAM_MATRIX_BUILDERS[gateName](theta ?? info.defaultTheta);
  }
  throw new Error(`구현되지 않은 게이트: ${gateName}`);
}

// 단일 타깃 2x2 유니터리로 시뮬레이션되는 base 게이트 목록 (U는 별도 처리).
const SINGLE_QUBIT_GATES = new Set([
  "H", "X", "Y", "Z", "S", "Sdg", "T", "Tdg", "I", "SX", "SXdg", "RX", "RY", "RZ", "P",
]);
// 컨트롤을 붙일 수 없는 비유니터리/마커. 위반 시 명확한 에러를 낸다. [4]
const NON_CONTROLLABLE = new Set(["MEASURE", "RESET", "BARRIER", "CTRL"]);

export function initialState(qubitCount) {
  const size = 1 << qubitCount;
  const state = new Array(size);
  for (let i = 0; i < size; i++) state[i] = c(0);
  state[0] = c(1);
  return state;
}

// targetQubit 1개에 2x2 유니터리를 적용. controlQubits가 있으면 해당 비트가 모두 1인 성분에만 적용된다.
export function applyUnitary(state, targetQubit, matrix, controlQubits = []) {
  const size = state.length;
  const targetBit = 1 << targetQubit;
  const controlMask = controlQubits.reduce((mask, q) => mask | (1 << q), 0);
  const next = state.slice();
  for (let i = 0; i < size; i++) {
    if ((i & targetBit) !== 0) continue;
    if ((i & controlMask) !== controlMask) continue;
    const j = i | targetBit;
    const amp0 = state[i];
    const amp1 = state[j];
    next[i] = cAdd(cMul(matrix[0][0], amp0), cMul(matrix[0][1], amp1));
    next[j] = cAdd(cMul(matrix[1][0], amp0), cMul(matrix[1][1], amp1));
  }
  return next;
}

export function applyGate(state, gateName, targetQubit, { theta, controlQubits = [] } = {}) {
  const matrix = matrixFor(gateName, theta);
  return applyUnitary(state, targetQubit, matrix, controlQubits);
}

function controlMaskOf(controlQubits) {
  return controlQubits.reduce((mask, q) => mask | (1 << q), 0);
}

// 두 큐비트의 값을 교환 (SWAP). controlQubits가 있으면 controlled-SWAP(Fredkin).
export function applySwap(state, a, b, controlQubits = []) {
  const maskA = 1 << a;
  const maskB = 1 << b;
  const cmask = controlMaskOf(controlQubits);
  const next = state.slice();
  for (let i = 0; i < state.length; i++) {
    if ((i & cmask) !== cmask) continue;
    if ((i & maskA) !== 0 && (i & maskB) === 0) {
      const j = (i & ~maskA) | maskB;
      next[i] = state[j];
      next[j] = state[i];
    }
  }
  return next;
}

// RXX(θ) = exp(-i θ/2 X⊗X): i와 i^(maskA|maskB) 성분을 섞는다. controlQubits면 controlled-RXX.
export function applyRXX(state, a, b, theta, controlQubits = []) {
  const both = (1 << a) | (1 << b);
  const cmask = controlMaskOf(controlQubits);
  const cos = Math.cos(theta / 2);
  const sin = Math.sin(theta / 2);
  const next = state.slice();
  const done = new Array(state.length).fill(false);
  for (let i = 0; i < state.length; i++) {
    if (done[i]) continue;
    const j = i ^ both;
    done[i] = done[j] = true;
    // 컨트롤 비트는 a,b와 겹치지 않으므로 i와 j의 컨트롤 비트는 동일 — i만 검사.
    if ((i & cmask) !== cmask) continue;
    const ai = state[i];
    const aj = state[j];
    // new = cos·a - i·sin·partner
    next[i] = c(cos * ai.re + sin * aj.im, cos * ai.im - sin * aj.re);
    next[j] = c(cos * aj.re + sin * ai.im, cos * aj.im - sin * ai.re);
  }
  return next;
}

// RYY(θ) = exp(-i θ/2 Y⊗Y): RXX와 같은 쌍 회전이나 Y⊗Y가 이중반전(코너쌍 |00>↔|11>)의
// 부호를 뒤집는다 → 코너쌍은 +i·sin, 중간쌍 |01>↔|10>은 −i·sin. controlQubits면 controlled-RYY.
export function applyRYY(state, a, b, theta, controlQubits = []) {
  const maskA = 1 << a;
  const maskB = 1 << b;
  const both = maskA | maskB;
  const cmask = controlMaskOf(controlQubits);
  const cos = Math.cos(theta / 2);
  const sin = Math.sin(theta / 2);
  const next = state.slice();
  const done = new Array(state.length).fill(false);
  for (let i = 0; i < state.length; i++) {
    if (done[i]) continue;
    const j = i ^ both;
    done[i] = done[j] = true;
    if ((i & cmask) !== cmask) continue;
    const ai = state[i];
    const aj = state[j];
    // s: 코너쌍(두 비트 동일)이면 −1, 중간쌍이면 +1. new = cos·self − i·sin·s·partner
    const s = ((i & maskA) !== 0) === ((i & maskB) !== 0) ? -1 : 1;
    next[i] = c(cos * ai.re + s * sin * aj.im, cos * ai.im - s * sin * aj.re);
    next[j] = c(cos * aj.re + s * sin * ai.im, cos * aj.im - s * sin * ai.re);
  }
  return next;
}

// RZZ(θ) = exp(-i θ/2 Z⊗Z): 대각 위상. 두 비트가 같으면 e^{-iθ/2}, 다르면 e^{+iθ/2}.
// controlQubits면 controlled-RZZ.
export function applyRZZ(state, a, b, theta, controlQubits = []) {
  const maskA = 1 << a;
  const maskB = 1 << b;
  const cmask = controlMaskOf(controlQubits);
  const half = theta / 2;
  return state.map((amp, i) => {
    if ((i & cmask) !== cmask) return amp;
    const same = ((i & maskA) !== 0) === ((i & maskB) !== 0);
    const angle = same ? -half : half;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return c(amp.re * cos - amp.im * sin, amp.re * sin + amp.im * cos);
  });
}

// RCCX (Margolus): 상대위상 Toffoli. CCX와 상대위상만큼 다르다(정확한 CCX가 아님).
// targets = [a, b, t]: a,b = 컨트롤, t = 타깃. 8x8 하드코딩 없이 H/T/Tdg/CX 분해로 구현.
// 분해: H(t),T(t),CX(b,t),Tdg(t),CX(a,t),T(t),CX(b,t),Tdg(t),H(t)
export function applyRCCX(state, a, b, t) {
  const H = matrixFor("H"), T = matrixFor("T"), Tdg = matrixFor("Tdg"), X = matrixFor("X");
  const cx = (s, ctrl) => applyUnitary(s, t, X, [ctrl]);
  let s = state;
  s = applyUnitary(s, t, H, []);
  s = applyUnitary(s, t, T, []);
  s = cx(s, b);
  s = applyUnitary(s, t, Tdg, []);
  s = cx(s, a);
  s = applyUnitary(s, t, T, []);
  s = cx(s, b);
  s = applyUnitary(s, t, Tdg, []);
  s = applyUnitary(s, t, H, []);
  return s;
}

// RC3X: 상대위상 C3X. targets = [a, b, c, t]. 18-op H/T/Tdg/CX 분해.
export function applyRC3X(state, a, b, c, t) {
  const H = matrixFor("H"), T = matrixFor("T"), Tdg = matrixFor("Tdg"), X = matrixFor("X");
  const cx = (s, ctrl) => applyUnitary(s, t, X, [ctrl]);
  let s = state;
  s = applyUnitary(s, t, H, []); s = applyUnitary(s, t, T, []);
  s = cx(s, c); s = applyUnitary(s, t, Tdg, []); s = applyUnitary(s, t, H, []);
  s = cx(s, a); s = applyUnitary(s, t, T, []); s = cx(s, b); s = applyUnitary(s, t, Tdg, []);
  s = cx(s, a); s = applyUnitary(s, t, T, []); s = cx(s, b); s = applyUnitary(s, t, Tdg, []);
  s = applyUnitary(s, t, H, []); s = applyUnitary(s, t, T, []);
  s = cx(s, c); s = applyUnitary(s, t, Tdg, []); s = applyUnitary(s, t, H, []);
  return s;
}

// ---------- 정규(canonical) placement 적용: { gate, targets, controls, params } ----------
// 모든 게이트를 일반적으로 처리한다(게이트별 컨트롤 특수 분기 없음).
// extraControls: 칼럼 CTRL(•) 점에서 온 추가 컨트롤.
export function applyPlacement(state, cell, extraControls = []) {
  const gate = cell.gate;
  const targets = cell.targets ?? [];
  const controls = cell.controls ?? [];
  const params = cell.params ?? {};

  if (NON_CONTROLLABLE.has(gate)) {
    if (controls.length > 0 || extraControls.length > 0) {
      throw new Error(`${gate} cannot be controlled`);
    }
    if (gate === "RESET") return applyReset(state, targets[0]);
    return state; // MEASURE, BARRIER, CTRL: 상태벡터 불변
  }

  // RCCX/RC3X: 상대위상 게이트. controls 경로를 타지 않고 분해로 적용(SINGLE_QUBIT_GATES보다 먼저).
  if (gate === "RCCX") return applyRCCX(state, targets[0], targets[1], targets[2]);
  if (gate === "RC3X") return applyRC3X(state, targets[0], targets[1], targets[2], targets[3]);

  const ctrl = controls.length || extraControls.length ? [...controls, ...extraControls] : [];
  if (gate === "SWAP") return applySwap(state, targets[0], targets[1], ctrl);
  if (gate === "RXX") return applyRXX(state, targets[0], targets[1], params.theta ?? Math.PI / 2, ctrl);
  if (gate === "RYY") return applyRYY(state, targets[0], targets[1], params.theta ?? Math.PI / 2, ctrl);
  if (gate === "RZZ") return applyRZZ(state, targets[0], targets[1], params.theta ?? Math.PI / 2, ctrl);
  if (gate === "U") return applyUnitary(state, targets[0], uMatrix(params.theta ?? 0, params.phi ?? 0, params.lambda ?? 0), ctrl);
  if (SINGLE_QUBIT_GATES.has(gate)) return applyUnitary(state, targets[0], matrixFor(gate, params.theta), ctrl);
  return state; // 알 수 없는 게이트: 무시
}

// Reset(|0⟩): 결정론적으로 |0⟩ 분기에 사영 후 재정규화.
// 해당 큐비트가 확정 |1⟩이면 1-분기 진폭을 0-분기로 옮긴다 (X 후 사영과 동일).
export function applyReset(state, q) {
  const mask = 1 << q;
  let norm0 = 0;
  for (let i = 0; i < state.length; i++) {
    if ((i & mask) === 0) norm0 += state[i].re * state[i].re + state[i].im * state[i].im;
  }
  if (norm0 < 1e-12) {
    const next = state.map(() => c(0));
    for (let i = 0; i < state.length; i++) {
      if (i & mask) next[i & ~mask] = c(state[i].re, state[i].im);
    }
    return next;
  }
  const scale = 1 / Math.sqrt(norm0);
  return state.map((amp, i) =>
    (i & mask) ? c(0) : c(amp.re * scale, amp.im * scale)
  );
}

// 큐비트 q의 2x2 축약밀도행렬 (다른 큐비트를 partial trace)
export function reducedDensityMatrix(state, q) {
  const bit = 1 << q;
  const rho = [
    [c(0), c(0)],
    [c(0), c(0)],
  ];
  for (let i = 0; i < state.length; i++) {
    if (i & bit) continue;
    const amp = [state[i], state[i | bit]];
    for (let a = 0; a < 2; a++) {
      for (let b = 0; b < 2; b++) {
        rho[a][b] = cAdd(rho[a][b], cMul(amp[a], cConj(amp[b])));
      }
    }
  }
  return rho;
}

export function blochVectorFromRho(rho) {
  return {
    x: 2 * rho[0][1].re,
    y: -2 * rho[0][1].im,
    z: rho[0][0].re - rho[1][1].re,
  };
}

export function qubitBlochVector(state, q) {
  return blochVectorFromRho(reducedDensityMatrix(state, q));
}

// 전역 상태의 밀도행렬 ρ = |ψ⟩⟨ψ| (rho[i][j] = amp_i * conj(amp_j)).
// Density Matrix Cityscape 시각화용 — 순수 상태이므로 대각원소는 basisProbabilities와 일치한다.
export function densityMatrix(state) {
  const n = state.length;
  const rho = Array.from({ length: n }, () => new Array(n));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      rho[i][j] = cMul(state[i], cConj(state[j]));
    }
  }
  return rho;
}

// 모든 계산기저에 대한 확률(%). label은 상위 큐비트가 왼쪽에 오는 이진 문자열.
export function basisProbabilities(state, qubitCount) {
  const results = [];
  for (let i = 0; i < state.length; i++) {
    const amp = state[i];
    let label = "";
    for (let q = qubitCount - 1; q >= 0; q--) label += (i >> q) & 1;
    results.push({
      index: i,
      label,
      re: amp.re,
      im: amp.im,
      probability: (amp.re * amp.re + amp.im * amp.im) * 100,
    });
  }
  return results;
}

// Probabilities 패널 표시용 필터. 순수 함수(입력 배열 불변).
//  - hideZero: 확률 ≤ threshold(기저 확률, 0~1 스케일)인 상태를 숨김
//  - qubitCount ≥ 6: threshold와 무관하게 상위 topN개만 두고 나머지는 cap(→ "Show all")
//  - observed(Set<index>): 샘플링에서 관측된 상태는 어떤 필터로도 숨기지 않음
// probability 필드는 퍼센트(0~100)라 threshold와 비교 시 /100로 맞춘다.
export function computeVisibleProbabilities(probabilities, options = {}) {
  const {
    hideZero = true,
    threshold = 1e-9,
    qubitCount = 0,
    topN = 32,
    showAll = false,
    observed = new Set(),
  } = options;
  const isObserved = (e) => observed.has(e.index);

  // 1) 영확률(임계값 이하) 숨김 — 관측 상태는 예외
  let kept = probabilities;
  const hiddenZero = [];
  if (hideZero) {
    kept = [];
    for (const e of probabilities) {
      if (e.probability / 100 <= threshold && !isObserved(e)) hiddenZero.push(e);
      else kept.push(e);
    }
  }

  // 2) 큐비트 수가 많으면 상위 topN만 (관측 상태는 항상 포함), 원래 index 순서 유지
  const capped = [];
  let capActive = false;
  if (qubitCount >= 6 && !showAll && kept.length > topN) {
    capActive = true;
    const byProb = [...kept].sort((a, b) => b.probability - a.probability || a.index - b.index);
    const keepSet = new Set();
    for (let i = 0; i < topN && i < byProb.length; i++) keepSet.add(byProb[i].index);
    for (const e of kept) if (isObserved(e)) keepSet.add(e.index);
    const visible = [];
    for (const e of kept) (keepSet.has(e.index) ? visible : capped).push(e);
    kept = visible;
  }

  return {
    visible: kept,
    hiddenZeroCount: hiddenZero.length,
    hiddenZeroProb: hiddenZero.reduce((s, e) => s + e.probability, 0),
    cappedCount: capped.length,
    capActive,
    totalCount: probabilities.length,
  };
}
