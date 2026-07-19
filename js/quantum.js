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
  RXX: { label: "RXX", targetLabel: "RXX", kind: "pair-param", group: "rotation", ready: true, minQubits: 2, defaultTheta: Math.PI / 2, desc: "RXX — XX interaction rotation" },
  RZZ: { label: "RZZ", targetLabel: "RZZ", kind: "pair-param", group: "rotation", ready: true, minQubits: 2, defaultTheta: Math.PI / 2, desc: "RZZ — ZZ interaction rotation" },
  CTRL: { label: "•", kind: "dot", group: "structural", ready: true, desc: "Control — adds a control to gates in the same column" },
  RCCX: { label: "RCCX", targetLabel: "⊕", kind: "controlled", base: "X", controls: 2, group: "rotation", ready: true, minQubits: 3, desc: "RCCX — relative-phase Toffoli" },
  RC3X: { label: "RC3X", targetLabel: "⊕", kind: "controlled", base: "X", controls: 3, group: "rotation", ready: true, minQubits: 4, desc: "RC3X — relative-phase triple-controlled NOT" },
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

function matrixFor(gateName, theta) {
  if (FIXED_MATRICES[gateName]) return FIXED_MATRICES[gateName];
  if (PARAM_MATRIX_BUILDERS[gateName]) {
    const info = GATE_INFO[gateName];
    return PARAM_MATRIX_BUILDERS[gateName](theta ?? info.defaultTheta);
  }
  throw new Error(`구현되지 않은 게이트: ${gateName}`);
}

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

// 두 큐비트의 값을 교환 (SWAP)
export function applySwap(state, a, b) {
  const maskA = 1 << a;
  const maskB = 1 << b;
  const next = state.slice();
  for (let i = 0; i < state.length; i++) {
    if ((i & maskA) !== 0 && (i & maskB) === 0) {
      const j = (i & ~maskA) | maskB;
      next[i] = state[j];
      next[j] = state[i];
    }
  }
  return next;
}

// RXX(θ) = exp(-i θ/2 X⊗X): i와 i^(maskA|maskB) 성분을 섞는다.
export function applyRXX(state, a, b, theta) {
  const both = (1 << a) | (1 << b);
  const cos = Math.cos(theta / 2);
  const sin = Math.sin(theta / 2);
  const next = state.slice();
  const done = new Array(state.length).fill(false);
  for (let i = 0; i < state.length; i++) {
    if (done[i]) continue;
    const j = i ^ both;
    done[i] = done[j] = true;
    const ai = state[i];
    const aj = state[j];
    // new = cos·a - i·sin·partner
    next[i] = c(cos * ai.re + sin * aj.im, cos * ai.im - sin * aj.re);
    next[j] = c(cos * aj.re + sin * ai.im, cos * aj.im - sin * ai.re);
  }
  return next;
}

// RZZ(θ) = exp(-i θ/2 Z⊗Z): 대각 위상. 두 비트가 같으면 e^{-iθ/2}, 다르면 e^{+iθ/2}.
export function applyRZZ(state, a, b, theta) {
  const maskA = 1 << a;
  const maskB = 1 << b;
  const half = theta / 2;
  return state.map((amp, i) => {
    const same = ((i & maskA) !== 0) === ((i & maskB) !== 0);
    const angle = same ? -half : half;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return c(amp.re * cos - amp.im * sin, amp.re * sin + amp.im * cos);
  });
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
