// 측정 샘플링(sampleCounts) 유닛 테스트 — 순수 함수라 DOM 없이 검증.
// rng를 주입해 결정론적으로 확인한다. 실행: node --test test/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { sampleCounts } from "../js/quantum.js";

// 확률(퍼센트, 0~100)만 사용. index/label은 렌더용.
function mkProbs(percents) {
  return percents.map((p, i) => ({ index: i, label: String(i), re: 0, im: 0, probability: p }));
}
// 결정론적 PRNG (mulberry32)
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const sum = (a) => a.reduce((s, x) => s + x, 0);

test("counts 합 === shots", () => {
  const c = sampleCounts(mkProbs([50, 50]), 1000, mulberry32(1));
  assert.equal(sum(c), 1000);
});

test("[4] 확률 0인 상태는 절대 샘플링되지 않는다", () => {
  const c = sampleCounts(mkProbs([50, 0, 50, 0]), 5000, mulberry32(7));
  assert.equal(c[1], 0);
  assert.equal(c[3], 0);
  assert.equal(c[0] + c[2], 5000);
});

test("[4] shots=1 → 정확히 한 기저만 1, 나머지 0", () => {
  const c = sampleCounts(mkProbs([30, 70]), 1, mulberry32(3));
  assert.equal(sum(c), 1);
  assert.equal(c.filter((x) => x === 1).length, 1);
  assert.equal(c.filter((x) => x === 0).length, 1);
});

test("[2] 정규화: 확률 합이 100이 아니어도(부동소수점 오차) 동작", () => {
  // 합 50 (정규화 필요). 두 상태 모두 관측되고 합은 shots.
  const c = sampleCounts(mkProbs([25, 25]), 2000, mulberry32(9));
  assert.equal(sum(c), 2000);
  assert.ok(c[0] > 0 && c[1] > 0);
});

test("[4] H q0 (50/50) 1024 shots ≈ 각 50% 근처, 정확히 512는 아님", () => {
  const c = sampleCounts(mkProbs([50, 50]), 1024, mulberry32(42));
  assert.equal(sum(c), 1024);
  assert.ok(c[0] > 0 && c[1] > 0);
  // 50% 근처(넉넉한 밴드), 그러나 결정론적 512는 아님(실제 표본 변동)
  assert.ok(c[0] > 430 && c[0] < 594, `c[0]=${c[0]}`);
  assert.notEqual(c[0], 512);
});

test("표본 변동성: 서로 다른 seed는 다른 결과(무작위성 확인)", () => {
  const a = sampleCounts(mkProbs([50, 50]), 1024, mulberry32(1));
  const b = sampleCounts(mkProbs([50, 50]), 1024, mulberry32(2));
  assert.notDeepEqual(a, b);
});

test("결정론: 같은 seed → 동일 결과", () => {
  const a = sampleCounts(mkProbs([40, 35, 25]), 3000, mulberry32(5));
  const b = sampleCounts(mkProbs([40, 35, 25]), 3000, mulberry32(5));
  assert.deepEqual(a, b);
});

test("치우친 분포: 큰 확률 상태가 더 많이 관측된다", () => {
  const c = sampleCounts(mkProbs([90, 10]), 10000, mulberry32(11));
  assert.ok(c[0] > c[1]);
  assert.ok(c[0] > 8500 && c[0] < 9500, `c[0]=${c[0]}`);
});
