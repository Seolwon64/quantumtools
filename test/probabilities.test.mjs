// Probabilities 패널 필터링(computeVisibleProbabilities) 유닛 테스트. 순수 함수라 DOM 없이 검증.
// 실행: node --test test/
import test from "node:test";
import assert from "node:assert/strict";
import { computeVisibleProbabilities } from "../js/quantum.js";

// probability는 퍼센트(0~100). 필터 로직은 index/probability만 사용.
function mkProbs(percents) {
  return percents.map((p, i) => ({ index: i, label: String(i), re: 0, im: 0, probability: p }));
}

test("hideZero on: 임계값 이하 상태 제외 + 숨긴 개수/확률", () => {
  const probs = mkProbs([50, 0, 50, 0, 0]);
  const r = computeVisibleProbabilities(probs, { hideZero: true, qubitCount: 3 });
  assert.deepEqual(r.visible.map((e) => e.index), [0, 2]);
  assert.equal(r.hiddenZeroCount, 3);
  assert.ok(Math.abs(r.hiddenZeroProb) < 1e-6);
  assert.equal(r.totalCount, 5);
  assert.equal(r.capActive, false);
});

test("hideZero off: 아무것도 숨기지 않음", () => {
  const probs = mkProbs([50, 0, 50, 0]);
  const r = computeVisibleProbabilities(probs, { hideZero: false, qubitCount: 3 });
  assert.equal(r.visible.length, 4);
  assert.equal(r.hiddenZeroCount, 0);
});

test("임계값 경계(이하 hide): T=1e-9 → 1e-7% 이하 숨김, 초과 유지", () => {
  const T = 1e-9;
  const probs = mkProbs([90, T * 100, T * 100 * 1.5, 0]); // idx1=경계값(=T), idx2=경계 초과
  const r = computeVisibleProbabilities(probs, { hideZero: true, threshold: T, qubitCount: 3 });
  assert.deepEqual(r.visible.map((e) => e.index), [0, 2]); // idx1(경계=이하)·idx3(0) 숨김
  assert.equal(r.hiddenZeroCount, 2);
});

test("hiddenZeroProb: 숨긴 상태들의 확률 합(퍼센트)", () => {
  const probs = mkProbs([98, 1, 1]); // 1%,1% 상태는 임계값 위라 안 숨김
  const r = computeVisibleProbabilities(probs, { hideZero: true, qubitCount: 3 });
  assert.equal(r.hiddenZeroCount, 0);
  assert.equal(r.visible.length, 3);
});

test("6큐비트 이상: 임계값 무관 상위 N(32)개만, 나머지 capped", () => {
  const percents = new Array(64).fill(0);
  for (let i = 0; i < 40; i++) percents[i] = 2.5; // 40개 비영(합 100)
  const r = computeVisibleProbabilities(mkProbs(percents), { hideZero: true, qubitCount: 6, topN: 32 });
  assert.equal(r.capActive, true);
  assert.equal(r.visible.length, 32);
  assert.equal(r.cappedCount, 8); // 40 유지 - 32 표시
  assert.equal(r.hiddenZeroCount, 24); // 64-40
});

test("6큐비트 cap은 threshold와 무관 (hideZero off여도 적용)", () => {
  const percents = new Array(64).fill(100 / 64);
  const r = computeVisibleProbabilities(mkProbs(percents), { hideZero: false, qubitCount: 6, topN: 32 });
  assert.equal(r.capActive, true);
  assert.equal(r.visible.length, 32);
  assert.equal(r.cappedCount, 32);
});

test("showAll: 6큐비트여도 cap 해제(전체 표시)", () => {
  const percents = new Array(64).fill(100 / 64);
  const r = computeVisibleProbabilities(mkProbs(percents), { hideZero: false, qubitCount: 6, topN: 32, showAll: true });
  assert.equal(r.capActive, false);
  assert.equal(r.visible.length, 64);
  assert.equal(r.cappedCount, 0);
});

test("6큐비트 미만: 상태가 많아도 cap 없음", () => {
  const percents = new Array(32).fill(100 / 32); // 5큐비트
  const r = computeVisibleProbabilities(mkProbs(percents), { hideZero: false, qubitCount: 5, topN: 32 });
  assert.equal(r.capActive, false);
  assert.equal(r.visible.length, 32);
});

test("관측 상태(observed)는 zero 필터에서도 숨기지 않음", () => {
  const probs = mkProbs([50, 0, 50, 0]);
  const r = computeVisibleProbabilities(probs, { hideZero: true, qubitCount: 3, observed: new Set([1]) });
  assert.deepEqual(r.visible.map((e) => e.index).sort((a, b) => a - b), [0, 1, 2]); // idx1(0%지만 관측)은 유지
  assert.equal(r.hiddenZeroCount, 1); // idx3만 숨김
});

test("관측 상태는 top-N cap을 넘어도 항상 표시", () => {
  const percents = new Array(64).fill(0);
  for (let i = 0; i < 40; i++) percents[i] = 2.5;
  // idx63은 확률 0이지만 관측됨 → 상위32 밖이어도 표시돼야 함
  const r = computeVisibleProbabilities(mkProbs(percents), { hideZero: true, qubitCount: 6, topN: 32, observed: new Set([63]) });
  assert.ok(r.visible.some((e) => e.index === 63), "관측 상태 63이 표시되어야 함");
});

test("visible는 원래 index 순서를 보존한다", () => {
  const probs = mkProbs([10, 0, 30, 20, 0, 40]);
  const r = computeVisibleProbabilities(probs, { hideZero: true, qubitCount: 3 });
  assert.deepEqual(r.visible.map((e) => e.index), [0, 2, 3, 5]);
});
