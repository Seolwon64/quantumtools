// 단일 큐비트 상태(복소 진폭)와 게이트 연산.
// |psi> = a|0> + b|1>, a, b 는 {re, im} 복소수.

const SQRT1_2 = Math.SQRT1_2;

function c(re, im = 0) {
  return { re, im };
}

function cMulAdd(m00, a, m01, b) {
  // m00*a + m01*b (m00, m01 은 복소수, a, b 는 복소수)
  return c(
    m00.re * a.re - m00.im * a.im + m01.re * b.re - m01.im * b.im,
    m00.re * a.im + m00.im * a.re + m01.re * b.im + m01.im * b.re
  );
}

// 2x2 복소 유니터리 게이트 행렬 [[m00, m01], [m10, m11]]
export const GATES = {
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
  T: [
    [c(1), c(0)],
    [c(0), c(SQRT1_2, SQRT1_2)],
  ],
};

export function initialState() {
  return { a: c(1), b: c(0) };
}

export function applyGate(state, gateName) {
  const m = GATES[gateName];
  if (!m) throw new Error(`Unknown gate: ${gateName}`);
  return {
    a: cMulAdd(m[0][0], state.a, m[0][1], state.b),
    b: cMulAdd(m[1][0], state.a, m[1][1], state.b),
  };
}

// 상태 -> Bloch 벡터 (x, y, z)
export function blochVector(state) {
  const { a, b } = state;
  const x = 2 * (a.re * b.re + a.im * b.im);
  const y = 2 * (a.re * b.im - a.im * b.re);
  const z = a.re * a.re + a.im * a.im - (b.re * b.re + b.im * b.im);
  return { x, y, z };
}

// |0>, |1> 로 측정될 확률 (백분율)
export function probabilities(state) {
  const { a, b } = state;
  const p0 = a.re * a.re + a.im * a.im;
  const p1 = b.re * b.re + b.im * b.im;
  const total = p0 + p1 || 1;
  return {
    p0: (p0 / total) * 100,
    p1: (p1 / total) * 100,
  };
}

// 회로(게이트 이름 배열) -> 각 스텝의 상태 배열 (길이 = gates.length + 1, index 0 은 초기상태)
export function computeStates(gateNames) {
  const states = [initialState()];
  for (const gate of gateNames) {
    states.push(applyGate(states[states.length - 1], gate));
  }
  return states;
}
