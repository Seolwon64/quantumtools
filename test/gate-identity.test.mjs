// 게이트 동일성(isSameGate) — 게이트 정보 패널이 "무엇에 대한 정보인가"를 알아보는 기준.
//
// 예전엔 자리(column, home)로만 알아봐서, Undo·프리셋이 같은 자리에 다른 게이트를 놓으면 정보가
// 조용히 새 게이트의 것으로 바뀌었다. 지금은 바뀐 게이트면 정보를 닫고, 값만 고친 같은 게이트면
// 열린 채 갱신한다. 그 경계가 여기서 고정된다.
import test from "node:test";
import assert from "node:assert/strict";
import { isSameGate } from "../js/circuit.js";

test("같은 자리에 다른 종류의 게이트가 오면 다른 게이트다", () => {
  assert.equal(isSameGate({ gate: "H", targets: [0] }, { gate: "X", targets: [0] }), false);
});

test("파라미터만 바뀐 같은 게이트는 같은 게이트다 — 정보가 열린 채 값만 갱신된다", () => {
  const before = { gate: "U", targets: [1], params: { theta: 0.1, phi: 0.2, lambda: 0.3 } };
  const after = { gate: "U", targets: [1], params: { theta: 1.5, phi: 0.2, lambda: -2 } };
  assert.equal(isSameGate(before, after), true);
});

test("대상이 바뀌면 다른 게이트다", () => {
  assert.equal(isSameGate({ gate: "X", targets: [0] }, { gate: "X", targets: [1] }), false);
  // 큐비트 집합이 같아도 순서가 곧 역할인 게이트(RCCX — 마지막이 타깃)는 순서가 바뀌면 다르다
  assert.equal(isSameGate({ gate: "RCCX", targets: [0, 1, 2] }, { gate: "RCCX", targets: [2, 1, 0] }), false);
});

test("제어가 붙거나 떨어지면 다른 게이트다 — X 와 CNOT 은 같은 자리에서도 다른 게이트다", () => {
  assert.equal(isSameGate({ gate: "X", targets: [1] }, { gate: "X", targets: [1], controls: [0] }), false);
  assert.equal(isSameGate({ gate: "X", targets: [2], controls: [0, 1] }, { gate: "X", targets: [2], controls: [0] }), false);
  assert.equal(isSameGate({ gate: "X", targets: [2], controls: [0] }, { gate: "X", targets: [2], controls: [1] }), false);
});

test("제어는 집합으로 본다 — 같은 제어가 다른 순서로 저장돼도 같은 게이트다", () => {
  assert.equal(isSameGate({ gate: "X", targets: [3], controls: [2, 0] }, { gate: "X", targets: [3], controls: [0, 2] }), true);
});

test("controls 가 없는 셀과 빈 controls 셀은 같은 게이트다 — 저장 형태 차이로 정보가 닫히지 않는다", () => {
  assert.equal(isSameGate({ gate: "H", targets: [0] }, { gate: "H", targets: [0], controls: [] }), true);
});

test("게이트가 사라졌으면(빈 칸) 같은 게이트가 아니다", () => {
  assert.equal(isSameGate({ gate: "H", targets: [0] }, null), false);
  assert.equal(isSameGate(null, { gate: "H", targets: [0] }), false);
});
