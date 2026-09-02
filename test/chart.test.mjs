// 확률 차트 축/라벨 순수 로직 테스트. 실행: node --test test/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { pickLabelMode, niceTickStep, phaseInfo } from "../js/chart.js";

test("pickLabelMode: 상태 8개 이하 + 라벨 들어가면 가로", () => {
  assert.equal(pickLabelMode(4, 60, 24), "horizontal");
  assert.equal(pickLabelMode(8, 40, 24), "horizontal");
});

test("pickLabelMode: 가로인데 라벨이 밴드보다 넓으면 45도로 강등", () => {
  assert.equal(pickLabelMode(8, 20, 40), "rot45");
});

test("pickLabelMode: 9~16개는 45도", () => {
  assert.equal(pickLabelMode(12, 20, 24), "rot45");
  assert.equal(pickLabelMode(16, 18, 24), "rot45");
});

test("pickLabelMode: 17개 이상은 sparse", () => {
  assert.equal(pickLabelMode(20, 15, 24), "sparse");
  assert.equal(pickLabelMode(64, 6, 24), "sparse");
});

test("pickLabelMode: 45도인데 밴드가 너무 좁으면(<11px) sparse로 강등", () => {
  assert.equal(pickLabelMode(12, 8, 24), "sparse");
});

test("niceTickStep: 밴드폭에서 최소간격 확보하는 2의 거듭제곱 스텝", () => {
  assert.equal(niceTickStep(40, 40), 1); // 40*1=40 ≥ 40
  assert.equal(niceTickStep(10, 40), 4); // ceil(40/10)=4
  assert.equal(niceTickStep(5, 40), 8); // ceil(40/5)=8
  assert.equal(niceTickStep(3, 40), 16); // ceil(40/3)=14 → 16
  assert.equal(niceTickStep(100, 40), 1);
});

test("phaseInfo: 위상(도/라디안), 진폭 0이면 미정의", () => {
  const a = phaseInfo(0, 1);
  assert.ok(a.defined);
  assert.ok(Math.abs(a.deg - 90) < 1e-9);
  assert.ok(Math.abs(a.rad - Math.PI / 2) < 1e-9);

  const b = phaseInfo(1, 0);
  assert.ok(Math.abs(b.deg - 0) < 1e-9);

  const c = phaseInfo(-1, 0);
  assert.ok(Math.abs(Math.abs(c.deg) - 180) < 1e-9);

  const z = phaseInfo(0, 0);
  assert.equal(z.defined, false);
});

test("pickLabelMode: count 경계 8/9 에서 가로↔45도가 갈린다", () => {
  // 8은 가로 구간 상한, 9는 45도 구간 시작(밴드는 강등 안 나게 넉넉히)
  assert.equal(pickLabelMode(8, 60, 24), "horizontal");
  assert.equal(pickLabelMode(9, 60, 24), "rot45");
});

test("pickLabelMode: count 경계 16/17 에서 45도↔sparse가 갈린다", () => {
  // 16은 45도 구간 상한, 17은 sparse 구간 시작(밴드는 강등 안 나게 넉넉히)
  assert.equal(pickLabelMode(16, 60, 24), "rot45");
  assert.equal(pickLabelMode(17, 60, 24), "sparse");
});

test("pickLabelMode: 강등 임계는 strict > 라 labelPx+4 == bandWidth 면 가로 유지", () => {
  // labelPx+4 == bandWidth 는 겹치지 않는 것으로 보고 가로를 유지한다
  assert.equal(pickLabelMode(8, 44, 40), "horizontal");
  // 1px만 좁아지면 강등된다
  assert.equal(pickLabelMode(8, 43, 40), "rot45");
});

test("pickLabelMode: 45도→sparse 강등 임계는 밴드 11px 미만일 때만이다", () => {
  // 정확히 11px 는 45도 유지, 10px 는 sparse 로 강등
  assert.equal(pickLabelMode(12, 11, 24), "rot45");
  assert.equal(pickLabelMode(12, 10, 24), "sparse");
});

test("pickLabelMode: 소수 상태라도 밴드가 좁으면 가로→45도→sparse 로 연쇄 강등된다", () => {
  // count≤8 이라 가로에서 시작하지만 한 번의 호출로 두 단계 강등된다
  assert.equal(pickLabelMode(4, 8, 40), "sparse");
});

test("niceTickStep: 밴드폭 0 이어도 0나눗셈 없이 유한한 2의 거듭제곱을 낸다", () => {
  const step = niceTickStep(0, 40);
  assert.ok(Number.isFinite(step));
  // 0.001 가드로 raw=40000, 이를 덮는 2의 거듭제곱은 65536
  assert.equal(step, 65536);
});

test("niceTickStep: minGapPx 기본값(40)으로 동작한다", () => {
  // 인자 하나만 줘도 기본 최소간격 40 이 적용된다
  assert.equal(niceTickStep(40), 1); // ceil(40/40)=1
  assert.equal(niceTickStep(10), 4); // ceil(40/10)=4
});

test("niceTickStep: raw가 이미 2의 거듭제곱이면 그대로 쓴다", () => {
  // ceil(40/20)=2 는 이미 2의 거듭제곱이라 추가 올림 없다
  assert.equal(niceTickStep(20, 40), 2);
  // ceil(40/5)=8 도 정확한 거듭제곱
  assert.equal(niceTickStep(5, 40), 8);
});

test("niceTickStep: 결과는 항상 1 이상의 2의 거듭제곱이다", () => {
  for (const bw of [0, 0.5, 1, 3, 7, 40, 100, 1000]) {
    const step = niceTickStep(bw, 40);
    assert.ok(step >= 1, `${bw}: 1 이상`);
    // 2의 거듭제곱이면 (step & (step-1)) === 0
    assert.equal(step & (step - 1), 0, `${bw}: 2의 거듭제곱`);
  }
});

test("phaseInfo: 음의 허수부는 위상 부호가 음수다", () => {
  const a = phaseInfo(0, -1); // -90도
  assert.ok(a.defined);
  assert.ok(Math.abs(a.deg - -90) < 1e-9);
  assert.ok(Math.abs(a.rad - -Math.PI / 2) < 1e-9);

  const b = phaseInfo(-1, -1); // 3사분면 → -135도
  assert.ok(Math.abs(b.deg - -135) < 1e-9);
  assert.ok(b.rad < 0);
});

test("phaseInfo: 진폭 1e-9 경계 바로 아래는 미정의, 위는 정의된다", () => {
  // mag < 1e-9 이면 미정의: 1e-10 은 경계 미만
  assert.equal(phaseInfo(1e-10, 0).defined, false);
  // 2e-9 는 경계 이상이라 정의된다
  assert.equal(phaseInfo(2e-9, 0).defined, true);
});

test("phaseInfo: deg 는 rad 를 도로 환산한 값과 일치한다", () => {
  for (const [re, im] of [[1, 1], [-3, 2], [0.5, -0.5], [-1, -4]]) {
    const p = phaseInfo(re, im);
    assert.ok(Math.abs(p.deg - (p.rad * 180) / Math.PI) < 1e-9);
  }
});