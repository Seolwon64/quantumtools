// 궤적 실행 — 측정이 실제로 상태를 붕괴시키는 경로의 검증.
//
// 여기서 못 박는 것은 두 가지다:
//   1) **붕괴가 실제로 일어난다** — 지연 측정 경로와 결과가 달라야 한다(같으면 구현이 안 된 것).
//   2) **되감기가 결정론적이다** — 같은 시드면 같은 스텝에서 반드시 같은 상태.
//      이게 깨지면 스텝 재생이 성립하지 않는다.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  runTrajectory, makeRng, needsTrajectorySampling,
  aggregateTrajectories, marginalClassical,
} from "../js/trajectory.js";
import { simulate, MAX_COLUMNS } from "../js/circuit.js";
import { reducedDensityInfo } from "../js/density.js";
import { PRESETS } from "../js/presets.js";
import { decodeCircuit } from "../js/export.js";

const cell = (gate, targets, controls = [], params = {}) => ({ gate, targets, controls, params });

function build(qubitCount, placements) {
  const grid = Array.from({ length: MAX_COLUMNS }, () => new Array(qubitCount).fill(null));
  for (const { col, cell: c } of placements) grid[col][c.targets[0]] = c;
  return grid;
}

/** 0 이 아닌 진폭의 개수 — 붕괴 여부를 세는 가장 직접적인 지표. */
const support = (st) => st.filter((z) => z.re * z.re + z.im * z.im > 1e-12).length;

/** [6] 핵심 회로: h q0 · measure q0→c0 · h q0 · measure q0→c0 */
function coreCircuit() {
  return build(1 + 1, [
    { col: 0, cell: cell("H", [0]) },
    { col: 1, cell: cell("MEASURE", [0], [], { cbit: 0 }) },
    { col: 2, cell: cell("H", [0]) },
    { col: 3, cell: cell("MEASURE", [0], [], { cbit: 0 }) },
  ]);
}

test("측정이 상태를 붕괴시킨다 — 이후 H 가 다시 중첩을 만든다", () => {
  const grid = coreCircuit();

  // H 직후: 중첩(진폭 2개)
  assert.equal(support(runTrajectory(2, 2, grid, 1, makeRng(1)).state), 2, "H 뒤에 중첩이 아니다");
  // 측정 직후: 붕괴(진폭 1개) — 지연 측정 경로라면 여전히 2개다
  assert.equal(support(runTrajectory(2, 2, grid, 2, makeRng(1)).state), 1, "측정 뒤에 붕괴하지 않았다");
  // 두 번째 H 뒤: 다시 중첩
  assert.equal(support(runTrajectory(2, 2, grid, 3, makeRng(1)).state), 2, "두 번째 H 뒤에 중첩이 아니다");
  // 두 번째 측정 뒤: 다시 붕괴
  assert.equal(support(runTrajectory(2, 2, grid, 4, makeRng(1)).state), 1);

  // 대조군: 지연 경로는 이 회로를 **아예 거부한다**(측정된 큐비트를 뒤에서 조작하므로).
  // 그게 [4] 가 완화하려는 제약이고, 궤적 경로가 위에서 정확히 처리한 그 회로다.
  assert.throws(
    () => simulate(2, grid, undefined, 2),
    /measured at column 2, then modified/,
    "지연 경로가 이 회로를 거부하지 않는다 — 대조 전제를 재검토하라"
  );
});

test("측정 뒤 조작이 없는 회로는 지연 경로도 돌지만 붕괴는 하지 않는다", () => {
  // 두 경로의 차이를 가장 단순하게 보여주는 대조: 같은 회로, 다른 상태.
  const grid = build(2, [
    { col: 0, cell: cell("H", [0]) },
    { col: 1, cell: cell("MEASURE", [0], [], { cbit: 0 }) },
  ]);
  assert.equal(support(simulate(2, grid, undefined, 2)), 2, "지연 경로가 붕괴했다");
  assert.equal(support(runTrajectory(2, 2, grid, undefined, makeRng(1)).state), 1, "궤적 경로가 붕괴하지 않았다");
});

test("같은 시드면 어느 순서로 불러도 같은 스텝은 같은 상태 (되감기 결정론)", () => {
  const grid = coreCircuit();
  const at = (step) => runTrajectory(2, 2, grid, step, makeRng(12345)).state.map((z) => [z.re, z.im]);

  const forward = [0, 1, 2, 3, 4].map(at);
  // 되감고 다시 진행하는 순서로 훑어도 같아야 한다.
  for (const step of [4, 2, 0, 3, 1, 4, 2]) {
    assert.deepEqual(at(step), forward[step], `step ${step} 에서 상태가 달라졌다`);
  }
});

test("시드가 다르면 다른 궤적이 나온다 (Resample 이 의미를 가진다)", () => {
  const grid = coreCircuit();
  const outcomes = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    outcomes.add(runTrajectory(2, 2, grid, 2, makeRng(seed)).clbits[0]);
  }
  assert.equal(outcomes.size, 2, "40개 시드에서 결과가 한쪽으로만 나왔다");
});

test("첫 측정 결과가 대략 50/50 (지연 방식이면 한쪽으로 쏠린다)", () => {
  const grid = coreCircuit();
  let ones = 0;
  const N = 2000;
  for (let seed = 1; seed <= N; seed++) {
    if (runTrajectory(2, 2, grid, 2, makeRng(seed * 2654435761)).clbits[0] === 1) ones++;
  }
  const ratio = ones / N;
  assert.ok(ratio > 0.45 && ratio < 0.55, `1 비율 ${(ratio * 100).toFixed(1)}% — 50% 근처가 아니다`);
});

test("RESET 이 사후선택이 아니라 진짜 리셋이다", () => {
  // 0.6|00⟩ + 0.8|11⟩ 을 만들고 q0 을 리셋한다.
  // 기본 경로의 applyReset 은 |0⟩ 성분만 남겨 **q1 까지 0 으로 확정**해 버린다.
  // 진짜 리셋이면 q1 은 0.36 : 0.64 로 갈린다.
  const theta = 2 * Math.acos(0.6); // RY(theta)|0⟩ = 0.6|0⟩ + 0.8|1⟩
  const grid = build(2, [
    { col: 0, cell: cell("RY", [1], [], { theta }) },
    { col: 1, cell: cell("X", [0], [1]) }, // CX(q1→q0) → 0.6|00⟩ + 0.8|11⟩
    { col: 2, cell: cell("RESET", [0]) },
  ]);

  // 전제 확인: 리셋 직전 상태가 0.6|00⟩ + 0.8|11⟩ 인가
  const beforeReset = runTrajectory(2, 0, grid, 2, makeRng(7)).state;
  assert.ok(Math.abs(beforeReset[0].re - 0.6) < 1e-6, `|00⟩ 진폭 ${beforeReset[0].re}`);
  assert.ok(Math.abs(beforeReset[3].re - 0.8) < 1e-6, `|11⟩ 진폭 ${beforeReset[3].re}`);

  let q1one = 0;
  const N = 3000;
  for (let seed = 1; seed <= N; seed++) {
    const { state } = runTrajectory(2, 0, grid, 3, makeRng(seed * 2654435761));
    assert.equal(support(state), 1, "리셋 후 상태가 확정이 아니다");
    // q0 은 항상 0 이어야 한다(리셋이므로)
    const idx = state.findIndex((z) => z.re * z.re + z.im * z.im > 1e-12);
    assert.equal(idx & 1, 0, `q0 이 리셋되지 않았다 (idx ${idx})`);
    if ((idx >> 1) & 1) q1one++;
  }
  const ratio = q1one / N;
  assert.ok(ratio > 0.60 && ratio < 0.68, `q1=1 비율 ${(ratio * 100).toFixed(1)}% — 0.64 근처가 아니다`);

  // 대조군: 기본 경로는 q1 이 0 으로 확정된다(사후선택).
  const legacy = simulate(2, grid, 3, 0);
  assert.ok(legacy[0].re * legacy[0].re > 0.999, "기본 경로의 사후선택 동작이 바뀌었다 — 이 대조군을 재검토하라");
});

test("조건부 연산이 기록된 고전 비트를 그대로 읽는다", () => {
  // q0 을 |1⟩ 로 만들고 측정 → c[0]=1 → 조건부 X 가 q1 에 적용된다.
  const on = build(2, [
    { col: 0, cell: cell("X", [0]) },
    { col: 1, cell: cell("MEASURE", [0], [], { cbit: 0 }) },
    { col: 2, cell: cell("X", [1], [], { cif: 0 }) },
  ]);
  const r1 = runTrajectory(2, 2, on, undefined, makeRng(1));
  assert.equal(r1.clbits[0], 1);
  assert.ok(r1.state[3].re * r1.state[3].re > 0.999, "c[0]=1 인데 조건부 X 가 적용되지 않았다");

  // q0 이 |0⟩ 이면 c[0]=0 → 적용되지 않는다.
  const off = build(2, [
    { col: 1, cell: cell("MEASURE", [0], [], { cbit: 0 }) },
    { col: 2, cell: cell("X", [1], [], { cif: 0 }) },
  ]);
  const r0 = runTrajectory(2, 2, off, undefined, makeRng(1));
  assert.equal(r0.clbits[0], 0);
  assert.ok(r0.state[0].re * r0.state[0].re > 0.999, "c[0]=0 인데 조건부 X 가 적용됐다");
});

test("기록된 적 없는 고전 비트의 조건은 거짓이다 (레지스터는 0으로 초기화된다)", () => {
  // 지연 경로는 이 회로를 **에러**로 막는다(기록이 없어 제어로 승격할 수 없으므로).
  // 궤적 경로는 c[1]==0 이므로 그냥 적용하지 않는다 — 이게 고전 레지스터의 정확한 의미다.
  const grid = build(2, [{ col: 0, cell: cell("X", [1], [], { cif: 1 }) }]);
  const r = runTrajectory(2, 2, grid, undefined, makeRng(1));
  assert.ok(r.state[0].re * r.state[0].re > 0.999, "기록 없는 조건이 참으로 처리됐다");
});

test("측정이 없는 회로는 두 경로의 결과가 진폭까지 같다", () => {
  for (const preset of PRESETS) {
    const dec = decodeCircuit(preset.circuit);
    const hasCollapse = dec.grid.flat().some((c) => c && (c.gate === "MEASURE" || c.gate === "RESET"));
    if (hasCollapse) continue;
    const legacy = simulate(dec.qubitCount, dec.grid, undefined, dec.clbitCount);
    const traj = runTrajectory(dec.qubitCount, dec.clbitCount, dec.grid, undefined, makeRng(1)).state;
    for (let i = 0; i < legacy.length; i++) {
      assert.ok(
        Math.abs(legacy[i].re - traj[i].re) < 1e-9 && Math.abs(legacy[i].im - traj[i].im) < 1e-9,
        `${preset.name} idx ${i}: (${legacy[i].re},${legacy[i].im}) ≠ (${traj[i].re},${traj[i].im})`
      );
    }
  }
});

test("텔레포테이션: 네 가지 측정 결과 모두에서 q2 가 원래 상태를 갖는다", () => {
  const dec = decodeCircuit(PRESETS.find((p) => p.name === "Quantum teleportation").circuit);
  const S = Math.SQRT1_2;
  const seen = new Map();

  for (let seed = 1; seed <= 400 && seen.size < 4; seed++) {
    const r = runTrajectory(dec.qubitCount, dec.clbitCount, dec.grid, undefined, makeRng(seed * 2654435761));
    const key = r.measurements.map((m) => m.outcome).join("");
    if (!seen.has(key)) seen.set(key, r);
  }
  assert.equal(seen.size, 4, `측정 결과 조합이 ${seen.size}가지만 나왔다: ${[...seen.keys()].join(", ")}`);

  for (const [key, r] of seen) {
    const info = reducedDensityInfo(r.state, 2);
    // q0 = T·H|0⟩ → 블로흐 (√2/2, √2/2, 0), 순수
    assert.ok(
      Math.abs(info.bloch.x - S) < 1e-6 && Math.abs(info.bloch.y - S) < 1e-6 && Math.abs(info.bloch.z) < 1e-6,
      `결과 ${key}: q2 bloch=(${info.bloch.x.toFixed(4)},${info.bloch.y.toFixed(4)},${info.bloch.z.toFixed(4)})`
    );
    assert.ok(Math.abs(info.purity - 1) < 1e-6, `결과 ${key}: q2 purity=${info.purity}`);
  }
});

test("빠른 경로 판정: 중간 붕괴가 있을 때만 궤적 샘플링이 필요하다", () => {
  const plain = build(2, [{ col: 0, cell: cell("H", [0]) }]);
  assert.equal(needsTrajectorySampling(2, plain), false, "측정이 없는데 궤적을 요구한다");

  // 마지막에만 측정 → 최종 상태벡터 샘플링이 정확하다
  const tail = build(2, [
    { col: 0, cell: cell("H", [0]) },
    { col: 1, cell: cell("MEASURE", [0], [], { cbit: 0 }) },
  ]);
  assert.equal(needsTrajectorySampling(2, tail), false, "끝단 측정인데 궤적을 요구한다");

  // 측정 뒤에 연산이 남아 있다 → 궤적이 필요하다
  assert.equal(needsTrajectorySampling(2, coreCircuit()), true, "중간 측정인데 빠른 경로를 쓴다");

  // 조건부는 측정 결과에 의존한다
  const cond = build(2, [
    { col: 0, cell: cell("MEASURE", [0], [], { cbit: 0 }) },
    { col: 1, cell: cell("X", [1], [], { cif: 0 }) },
  ]);
  assert.equal(needsTrajectorySampling(2, cond), true, "조건부인데 빠른 경로를 쓴다");
});

// ---------------------------------------------------------------- 집계

/** 고정 시드열 — 통계 테스트를 결정론적으로 만든다(±범위 대신 정확한 값을 assert 한다). */
function seedSource(start) {
  let n = start >>> 0;
  return () => { n = (n + 0x9e3779b9) >>> 0; return n; };
}
const pct = (x) => +(x * 100).toFixed(1);

/** [5] 핵심 회로: h q0 · measure→c0 · h q0 · measure→c1 */
function twoBitCircuit() {
  return build(2, [
    { col: 0, cell: cell("H", [0]) },
    { col: 1, cell: cell("MEASURE", [0], [], { cbit: 0 }) },
    { col: 2, cell: cell("H", [0]) },
    { col: 3, cell: cell("MEASURE", [0], [], { cbit: 1 }) },
  ]);
}

test("[5] 고전 비트 네 결과가 각각 25% 근처다 (지연 계산이면 한쪽 100%)", () => {
  const grid = twoBitCircuit();
  const { classical } = aggregateTrajectories(2, 2, grid, 2000, seedSource(12345));
  const shown = classical.map(pct);
  // 고정 시드라 값이 결정론적이다 — 회귀로 못 박는다.
  assert.deepEqual(shown, [24.6, 26.6, 25.7, 23.2], `실제 분포: ${shown.join(", ")}`);
  for (const [i, v] of shown.entries()) {
    assert.ok(v > 20 && v < 30, `c=${i.toString(2).padStart(2, "0")} 가 ${v}% — 25% 근처가 아니다`);
  }
});

test("[5] 같은 회로의 큐비트 기저는 50/50 두 개다 (고전 분포와 다른 것이 정상)", () => {
  const { qubitProbs } = aggregateTrajectories(2, 2, twoBitCircuit(), 2000, seedSource(12345));
  const shown = qubitProbs.map(pct);
  assert.deepEqual(shown, [51.2, 48.8, 0, 0], `실제 분포: ${shown.join(", ")}`);
});

test("Qubits 모드는 평균이지 샘플링이 아니다 — 분산이 더 작다", () => {
  // 마지막에 측정이 없어 각 궤적의 최종 상태가 중첩인 회로.
  // 평균은 각 궤적의 확률 벡터를 그대로 더하고, 샘플링은 기저 하나만 뽑아 버린다.
  const grid = build(2, [
    { col: 0, cell: cell("H", [0]) },
    { col: 1, cell: cell("MEASURE", [0], [], { cbit: 0 }) },
    { col: 2, cell: cell("H", [0]) },
  ]);
  const truth = [0.25, 0.25, 0, 0].map((v, i) => (i < 2 ? 0.5 : 0)); // q0 은 50/50, q1 은 0
  const N = 200;
  const err = (probs) => Math.hypot(...probs.map((p, i) => p - truth[i]));

  let avgErr = 0, sampErr = 0;
  for (let trial = 0; trial < 20; trial++) {
    const seeds = seedSource(1000 + trial);
    const { qubitProbs } = aggregateTrajectories(2, 2, grid, N, seeds);
    avgErr += err(qubitProbs);

    // 대조: 같은 궤적 수로 "기저 하나 샘플링" 방식을 흉내낸다.
    const s2 = seedSource(1000 + trial);
    const counts = new Array(4).fill(0);
    for (let i = 0; i < N; i++) {
      const rng = makeRng(s2());
      const { state } = runTrajectory(2, 2, grid, undefined, rng);
      let r = rng(), idx = state.length - 1;
      for (let k = 0; k < state.length; k++) {
        r -= state[k].re * state[k].re + state[k].im * state[k].im;
        if (r <= 0) { idx = k; break; }
      }
      counts[idx]++;
    }
    sampErr += err(counts.map((c) => c / N));
  }
  assert.ok(avgErr < sampErr, `평균 오차 ${avgErr.toFixed(4)} 가 샘플링 ${sampErr.toFixed(4)} 보다 크다`);
  // 실측: 평균 쪽이 대략 절반 이하여야 의미가 있다.
  assert.ok(avgErr < sampErr * 0.7, `평균의 이점이 작다 (평균 ${avgErr.toFixed(4)} vs 샘플 ${sampErr.toFixed(4)})`);
});

test("측정 없는 회로에서 평균은 이론값과 정확히 같다", () => {
  for (const preset of PRESETS) {
    const dec = decodeCircuit(preset.circuit);
    if (dec.grid.flat().some((c) => c && (c.gate === "MEASURE" || c.gate === "RESET"))) continue;
    const theory = simulate(dec.qubitCount, dec.grid, undefined, dec.clbitCount)
      .map((z) => z.re * z.re + z.im * z.im);
    const { qubitProbs } = aggregateTrajectories(dec.qubitCount, dec.clbitCount, dec.grid, 4, seedSource(7));
    for (let i = 0; i < theory.length; i++) {
      assert.ok(Math.abs(theory[i] - qubitProbs[i]) < 1e-12,
        `${preset.name} idx ${i}: ${theory[i]} ≠ ${qubitProbs[i]}`);
    }
  }
});

test("끝단 측정만 있는 회로: 이론 주변화 == 궤적 집계", () => {
  // 붕괴가 이후에 영향을 주지 않으므로 궤적을 돌리지 않고도 정확히 계산된다.
  const grid = build(2, [
    { col: 0, cell: cell("H", [0]) },
    { col: 1, cell: cell("X", [1], [0]) },
    { col: 2, cell: cell("MEASURE", [0], [], { cbit: 0 }) },
    { col: 2, cell: cell("MEASURE", [1], [], { cbit: 1 }) },
  ]);
  assert.equal(needsTrajectorySampling(2, grid), false, "이 회로는 빠른 경로여야 한다");

  const theory = simulate(2, grid, undefined, 2).map((z) => z.re * z.re + z.im * z.im);
  const marginal = marginalClassical(2, 2, grid, theory).map(pct);
  const { classical } = aggregateTrajectories(2, 2, grid, 4000, seedSource(99));
  for (let i = 0; i < marginal.length; i++) {
    assert.ok(Math.abs(marginal[i] - pct(classical[i])) < 3,
      `c=${i.toString(2).padStart(2, "0")}: 주변화 ${marginal[i]}% vs 궤적 ${pct(classical[i])}%`);
  }
  // Bell 상태라 00 과 11 만 50% 씩
  assert.deepEqual(marginal, [50, 0, 0, 50], `주변화 결과: ${marginal.join(", ")}`);
});

test("집계는 시드에 둔감하다 (Resample 로 확률이 크게 안 변한다)", () => {
  const grid = twoBitCircuit();
  const runs = [1, 2, 3, 4].map((seed) =>
    aggregateTrajectories(2, 2, grid, 2000, seedSource(seed)).classical.map(pct)
  );
  for (let i = 0; i < 4; i++) {
    const vals = runs.map((r) => r[i]);
    const spread = Math.max(...vals) - Math.min(...vals);
    assert.ok(spread < 4, `c=${i.toString(2).padStart(2, "0")} 편차 ${spread.toFixed(1)}%p: ${vals.join(", ")}`);
  }
});
