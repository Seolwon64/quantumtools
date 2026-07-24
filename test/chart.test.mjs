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
