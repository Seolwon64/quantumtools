// 궤적(trajectory) 실행 — 측정을 **실제로 수행해 상태를 붕괴시키는** 두 번째 실행 경로.
//
// 기본 경로(circuit.js 의 simulateResolved + classical.js 의 지연 측정)는 MEASURE 를 no-op 으로
// 두고 조건부 연산만 양자 제어로 바꾼다. 전역 상태가 순수하게 유지돼 Q-sphere·축소 밀도행렬이
// 성립하지만, **측정이 상태를 붕괴시키는 장면을 볼 수 없다.**
//
// 여기서는 반대로 한다: 회로를 처음부터 순차 실행하다가 MEASURE 를 만나면 난수로 결과를 뽑고
// 그 결과로 상태를 사영한다. 이후 게이트는 붕괴된 상태 위에서 적용된다.
// 두 경로는 서로 다른 것을 보여주며 **둘 다 옳다** — 하나가 다른 하나를 대체하지 않는다.
//
// 난수는 인자로 받는다(`nextRandom`). 시퀀스를 이 모듈이 소유하면 되감기마다 다른 결과가 나와
// 스텝 재생이 성립하지 않는다 — 호출부가 시드를 쥐고 같은 시퀀스를 다시 먹인다.

import { applyPlacement, initialState } from "./quantum.js";

/**
 * 32비트 시드 하나로 결정론적 난수열을 만든다(mulberry32).
 * 외부 의존성 없이 몇 줄이면 되고, 같은 시드는 언제나 같은 수열을 준다 —
 * 그게 이 기능의 전제다(되감기해도 같은 궤적).
 */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 세션마다 다른 시드. localStorage 에 저장하지 않는다 — 새로 열었는데 같은 궤적이면 더 혼란스럽다. */
export function randomSeed() {
  return (Math.random() * 0x100000000) >>> 0;
}

/** 큐비트 q 가 1 로 측정될 확률. */
function probabilityOfOne(state, q) {
  const mask = 1 << q;
  let p = 0;
  for (let i = 0; i < state.length; i++) {
    if (i & mask) p += state[i].re * state[i].re + state[i].im * state[i].im;
  }
  return p;
}

/**
 * 큐비트 q 가 `outcome` 이었다는 사실로 상태를 사영하고 정규화한다.
 * 이게 붕괴다 — 반대 결과의 진폭이 사라지고 남은 것이 다시 1로 정규화된다.
 */
function projectOnto(state, q, outcome) {
  const mask = 1 << q;
  let norm = 0;
  for (let i = 0; i < state.length; i++) {
    const bit = (i & mask) ? 1 : 0;
    if (bit === outcome) norm += state[i].re * state[i].re + state[i].im * state[i].im;
  }
  // 확률 0 인 결과는 뽑히지 않지만, 부동소수 누적 오차로 0 에 가까워질 수는 있다.
  if (norm < 1e-18) return state.map((_, i) => ({ re: i === 0 ? 1 : 0, im: 0 }));
  const scale = 1 / Math.sqrt(norm);
  return state.map((amp, i) => {
    const bit = (i & mask) ? 1 : 0;
    return bit === outcome ? { re: amp.re * scale, im: amp.im * scale } : { re: 0, im: 0 };
  });
}

/** 큐비트 q 의 0/1 진폭을 맞바꾼다(사영 뒤 |1⟩ → |0⟩ 으로 되돌릴 때 쓴다). */
function flip(state, q) {
  const mask = 1 << q;
  const out = new Array(state.length);
  for (let i = 0; i < state.length; i++) out[i] = state[i ^ mask];
  return out;
}

/** 게이트가 하나라도 있는 열의 개수. circuit.js 의 같은 이름 함수와 규칙이 같아야 한다. */
function usedColumnCount(grid) {
  let n = 0;
  for (let col = 0; col < grid.length; col++) {
    if (grid[col].some((cell) => cell)) n++;
  }
  return n;
}

/**
 * 회로를 순차 실행하며 측정에서 실제로 붕괴시킨다.
 *
 * @param nextRandom 0 이상 1 미만을 주는 함수. **k 번째 측정은 k 번째 값을 쓴다** —
 *   호출부가 같은 시퀀스를 다시 먹이면 같은 궤적이 재현된다(되감기 결정론).
 * @returns {{state, clbits: number[], measurements: Array<{column, qubit, cbit, outcome, p1}>}}
 */
export function runTrajectory(qubitCount, clbitCount, grid, steps, nextRandom) {
  const limit = steps === undefined ? usedColumnCount(grid) : steps;
  // 고전 레지스터는 0 으로 초기화된다 — 아직 기록되지 않은 비트의 조건은 자연히 거짓이 된다.
  const clbits = new Array(Math.max(0, clbitCount)).fill(0);
  const measurements = [];
  let state = initialState(qubitCount);

  for (let col = 0; col < limit; col++) {
    // 열의 CTRL(•) 점은 같은 열 게이트들에 추가 제어로 붙는다 — 기본 경로와 같은 규칙.
    const dotControls = [];
    for (let q = 0; q < qubitCount; q++) {
      if (grid[col][q]?.gate === "CTRL") dotControls.push(q);
    }

    for (let q = 0; q < qubitCount; q++) {
      const cell = grid[col][q];
      if (!cell || cell.gate === "CTRL") continue;

      // 조건부 연산: 지연 측정 변환을 타지 않고 **기록된 고전 비트를 그대로 읽는다.**
      const cif = cell.params?.cif;
      if (cif !== undefined && clbits[cif] !== 1) continue;

      if (cell.gate === "MEASURE") {
        const target = cell.targets[0];
        const p1 = probabilityOfOne(state, target);
        const outcome = nextRandom() < p1 ? 1 : 0;
        state = projectOnto(state, target, outcome);
        const cbit = cell.params?.cbit ?? target;
        if (cbit >= 0 && cbit < clbits.length) clbits[cbit] = outcome;
        measurements.push({ column: col, qubit: target, cbit, outcome, p1 });
        continue;
      }

      if (cell.gate === "RESET") {
        // 진짜 리셋: 측정한 뒤 1 이면 뒤집어 |0⟩ 으로 만든다.
        // 기본 경로의 applyReset 은 |0⟩ 성분만 남기는 **사후선택**이라, 얽힌 상대 큐비트의
        // 확률까지 바꿔 버린다(0.6|00⟩+0.8|11⟩ 에서 q0 리셋 → q1 이 0 으로 확정되는 문제).
        const target = cell.targets[0];
        const p1 = probabilityOfOne(state, target);
        const outcome = nextRandom() < p1 ? 1 : 0;
        state = projectOnto(state, target, outcome);
        if (outcome === 1) state = flip(state, target);
        measurements.push({ column: col, qubit: target, cbit: -1, outcome, p1, reset: true });
        continue;
      }

      state = applyPlacement(state, cell, dotControls);
    }
  }

  return { state, clbits, measurements };
}

/**
 * 회로가 최종 상태벡터 샘플링(빠른 경로)으로 정확한가.
 *
 * 측정이 아예 없거나, 있더라도 **그 뒤에 아무 연산이 없고 조건부도 없으면** 중간 붕괴가
 * 이후 결과에 영향을 주지 않으므로 최종 상태에서 뽑아도 통계가 같다.
 * 그 밖에는 shot 마다 궤적을 돌려야 한다.
 */
export function needsTrajectorySampling(qubitCount, grid) {
  // **첫** 붕괴를 기준으로 본다. 마지막 붕괴만 보면 "측정 → H → 측정" 처럼 중간 측정이
  // 있으면서 마지막 열도 측정인 회로를 빠른 경로로 잘못 분류한다(실제로 겪음).
  let firstCollapse = Infinity;
  let lastOperation = -1;
  let hasCondition = false;

  for (let col = 0; col < grid.length; col++) {
    for (let q = 0; q < qubitCount; q++) {
      const cell = grid[col][q];
      if (!cell) continue;
      if (cell.params?.cif !== undefined) hasCondition = true;
      if (cell.gate === "MEASURE" || cell.gate === "RESET") {
        firstCollapse = Math.min(firstCollapse, col);
      } else if (cell.gate !== "BARRIER" && cell.gate !== "CTRL") {
        lastOperation = Math.max(lastOperation, col);
      }
    }
  }
  if (firstCollapse === Infinity) return false; // 붕괴가 없다 → 기존 경로가 정확하다
  if (hasCondition) return true;                // 조건부는 측정 결과에 의존한다
  return lastOperation > firstCollapse;         // 붕괴 뒤에 연산이 남아 있다
}
