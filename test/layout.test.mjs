// 상단 행 우선순위 체인(layout.js 의 순수 함수) 테스트. 실행: node --test
// 입력값은 실측에서 가져온 대표값이다 — 확률 크롬 103~117, 3열 최대 448 등.
import test from "node:test";
import assert from "node:assert/strict";
import { rowPlan, rowTopPx, rowOffsetFor } from "../js/layout.js";

// 확률 크롬(툴바·푸터·패딩) 실측값에 차트 최소 96 / 최대 260 을 더한 형태로 만든다.
function rows({ available, circuitNeeded, circuitChrome = 129, probChrome = 103, sphereSquare = 448 }) {
  return {
    available,
    circuitNeeded,
    circuitMin: circuitChrome + 66,
    probMin: probChrome + 96,
    probMax: probChrome + 260,
    sphereSquare,
  };
}

test("layout.js 는 DOM 없이 불러와진다 — 최상위에서 document 를 건드리지 않는다", async () => {
  const mod = await import("../js/layout.js");
  assert.equal(typeof mod.initResizableLayout, "function");
  assert.equal(typeof globalThis.document, "undefined");
});

test("좁은 화면에서는 1부와 같은 값이다 — 회로 필요량이 확률 바닥에서 잘린다 (1366×640)", () => {
  // 두 행 540, 확률 크롬 103 → 상단 최대 540 − 199 = 341. 회로는 427 을 원한다.
  const plan = rowPlan(rows({ available: 540, circuitNeeded: 427 }));
  assert.equal(plan.chain, 341);
  assert.equal(plan.max, 341);
});

test("회로가 다 들어가면 회로 필요 높이에서 멈춘다 — 구 항이 끼어들지 않는다 (1536×740)", () => {
  // 두 행 640. 구 항 = min(448, 640 − 363) = 277 < 427 → 회로 항이 이긴다.
  const plan = rowPlan(rows({ available: 640, circuitNeeded: 427 }));
  assert.equal(plan.chain, 427);
  assert.equal(plan.max, 441);
});

test("확률이 쓸모 있는 최대를 받기 전에는 구가 한 픽셀도 가져가지 못한다", () => {
  // A − 확률 최대 = 700 − 363 = 337. 구는 448 을 원하지만 337 까지만, 회로 300 보다 크므로 337.
  const plan = rowPlan(rows({ available: 700, circuitNeeded: 300 }));
  assert.equal(plan.chain, 337);
  assert.equal(700 - plan.chain, 363, "하단(확률)은 정확히 쓸모 있는 최대를 받는다");
});

test("큰 화면에서 구는 정사각까지만 받고 나머지는 하단으로 간다 (3840×2000)", () => {
  const plan = rowPlan(rows({ available: 1900, circuitNeeded: 427 }));
  assert.equal(plan.chain, 448, "구가 정사각이 되는 높이에서 멈춘다");
  assert.ok(1900 - plan.chain > 363, "하단은 확률 최대보다 많이 받는다 — 남는 몫의 흡수처");
});

test("회로 필요량이 구 정사각보다 크면 회로가 이긴다 — 순위가 높은 쪽이 먼저다", () => {
  const plan = rowPlan(rows({ available: 1900, circuitNeeded: 543 }));
  assert.equal(plan.chain, 543);
});

test("회로가 아무리 커도 확률 바닥(크롬 + 차트 최소)을 뚫지 못한다", () => {
  const plan = rowPlan(rows({ available: 900, circuitNeeded: 5000 }));
  assert.equal(plan.chain, 900 - 199);
  assert.equal(rowTopPx(plan, 0), 900 - 199);
});

test("드래그 범위의 하한은 회로 필요량이 아니라 회로 최소(크롬 + 한 줄)다 — 기본값 아래로도 줄일 수 있다", () => {
  const plan = rowPlan(rows({ available: 640, circuitNeeded: 427 }));
  assert.equal(plan.min, 129 + 66);
  assert.ok(plan.min < plan.chain, "기본값이 하한이면 스플리터가 위로 못 움직인다");
  assert.equal(rowTopPx(plan, -100), 327);
  assert.equal(rowTopPx(plan, -10000), plan.min, "끝까지 끌어도 회로 최소에서 멈춘다");
  assert.equal(rowTopPx(plan, 10000), plan.max, "반대로 끌어도 확률 바닥에서 멈춘다");
});

test("오프셋은 px 라 화면이 바뀌어도 같은 양이 옮겨 간다 — 비율처럼 불어나지 않는다", () => {
  // 1920×950: 두 행 850, 기본값 448(구 정사각), 상한 651 → +80 이 범위 안에 든다.
  const small = rowPlan(rows({ available: 850, circuitNeeded: 427 }));
  const offset = rowOffsetFor(small, small.chain + 80);
  assert.equal(offset, 80);
  const big = rowPlan(rows({ available: 1900, circuitNeeded: 427 }));
  assert.equal(rowTopPx(big, offset) - big.chain, 80);
});

test("범위 밖으로 끈 만큼은 저장되지 않는다 — 되돌려 끌 때 핸들이 바로 따라온다", () => {
  const plan = rowPlan(rows({ available: 850, circuitNeeded: 427 }));
  const offset = rowOffsetFor(plan, plan.max + 300);
  assert.equal(offset, plan.max - plan.chain);
  assert.equal(rowTopPx(plan, offset), plan.max);
});

test("오프셋 0 은 체인 기본값 그대로다 — 더블클릭 복귀가 기본 배치와 같은 높이를 준다", () => {
  const plan = rowPlan(rows({ available: 1190, circuitNeeded: 427 }));
  assert.equal(rowTopPx(plan, 0), plan.chain);
  assert.equal(rowOffsetFor(plan, plan.chain), 0);
});

test("아주 낮은 화면에서 범위가 뒤집히면 확률 바닥이 회로 최소보다 우선한다", () => {
  // A − 확률 최소 = 350 − 199 = 151 < 회로 최소 195
  const plan = rowPlan(rows({ available: 350, circuitNeeded: 427 }));
  assert.ok(plan.max < plan.min);
  assert.equal(rowTopPx(plan, 0), plan.max);
  assert.equal(rowTopPx(plan, -500), plan.max);
});

test("상단 높이는 음수가 되지 않는다 — 음수 px 는 grid-template-rows 선언 전체를 무효로 만든다", () => {
  const plan = rowPlan(rows({ available: 120, circuitNeeded: 427 }));
  assert.ok(plan.max < 0);
  assert.equal(rowTopPx(plan, 0), 0);
});
