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
export const GATE_INFO = {
  H: { label: "H", kind: "fixed", group: "hadamard", ready: true },
  X: { label: "X", kind: "fixed", group: "pauli", ready: true },
  Y: { label: "Y", kind: "fixed", group: "pauli", ready: true },
  Z: { label: "Z", kind: "fixed", group: "pauli", ready: true },
  S: { label: "S", kind: "fixed", group: "phase", ready: true },
  Sdg: { label: "S†", kind: "fixed", group: "phase", ready: true },
  T: { label: "T", kind: "fixed", group: "phase", ready: true },
  Tdg: { label: "T†", kind: "fixed", group: "phase", ready: true },
  I: { label: "I", kind: "fixed", group: "pauli", ready: true },
  SX: { label: "√X", kind: "fixed", group: "rotation", ready: true },
  SXdg: { label: "√X†", kind: "fixed", group: "rotation", ready: true },
  RX: { label: "RX", kind: "param", group: "rotation", ready: true, defaultTheta: Math.PI / 2 },
  RY: { label: "RY", kind: "param", group: "rotation", ready: true, defaultTheta: Math.PI / 2 },
  RZ: { label: "RZ", kind: "param", group: "rotation", ready: true, defaultTheta: Math.PI / 2 },
  P: { label: "P", kind: "param", group: "phase", ready: true, defaultTheta: Math.PI / 2 },
  // 2/3/4큐비트 및 구조 게이트: 팔레트에 노출되지만 Phase 1에서는 배치 불가.
  CNOT: { label: "⊕", kind: "multi", group: "control", ready: false, qubits: 2 },
  CZ: { label: "CZ", kind: "multi", group: "control", ready: false, qubits: 2 },
  SWAP: { label: "SWAP", kind: "multi", group: "control", ready: false, qubits: 2 },
  RXX: { label: "RXX", kind: "multi", group: "rotation", ready: false, qubits: 2 },
  RZZ: { label: "RZZ", kind: "multi", group: "rotation", ready: false, qubits: 2 },
  CTRL: { label: "•", kind: "modifier", group: "control", ready: false, qubits: 1 },
  RCCX: { label: "RCCX", kind: "multi", group: "rotation", ready: false, qubits: 3 },
  RC3X: { label: "RC3X", kind: "multi", group: "rotation", ready: false, qubits: 4 },
  U: { label: "U", kind: "param3", group: "rotation", ready: false, qubits: 1 },
  BARRIER: { label: "⋮", kind: "structural", group: "structural", ready: false, qubits: 1 },
  MEASURE: { label: "📏", kind: "structural", group: "structural", ready: false, qubits: 1 },
  RESET: { label: "|0⟩", kind: "structural", group: "structural", ready: false, qubits: 1 },
};

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
