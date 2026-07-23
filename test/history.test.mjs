// Undo/Redo(히스토리) 유닛 테스트 — 컨트롤러 공개 API로 검증.
// createCircuitController는 DOM을 만지지 않고 localStorage 접근은 try/catch로 감싸져 node에서 동작.
// 실행: node --test test/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createCircuitController, MAX_COLUMNS } from "../js/circuit.js";

function mk() {
  return createCircuitController({ onChange: () => {}, onAnimateStep: async () => {} });
}
function countCells(grid) {
  let n = 0;
  for (const col of grid) for (const cell of col) if (cell) n++;
  return n;
}

test("초기 상태: canUndo/canRedo 모두 false", () => {
  const c = mk();
  const s = c.getSnapshot();
  assert.equal(s.canUndo, false);
  assert.equal(s.canRedo, false);
});

test("게이트 배치 → undo로 되돌리고 redo로 복원", () => {
  const c = mk();
  c.placeGate(0, 0, "H");
  assert.equal(countCells(c.getSnapshot().grid), 1);
  assert.equal(c.getSnapshot().canUndo, true);
  assert.equal(c.getSnapshot().canRedo, false);

  c.undo();
  assert.equal(countCells(c.getSnapshot().grid), 0); // 빈 회로로 복원
  assert.equal(c.getSnapshot().canRedo, true);

  c.redo();
  assert.equal(countCells(c.getSnapshot().grid), 1); // 다시 배치됨
  assert.equal(c.getSnapshot().grid[0][0].gate, "H");
});

test("[4] Clear all은 undo로 되돌릴 수 있다 (주 목적)", () => {
  const c = mk();
  c.placeGate(0, 0, "H");
  c.placeGate(1, 1, "X");
  assert.equal(countCells(c.getSnapshot().grid), 2);

  c.clear();
  assert.equal(countCells(c.getSnapshot().grid), 0);

  c.undo();
  assert.equal(countCells(c.getSnapshot().grid), 2); // Clear 되돌려짐
});

test("게이트 제거도 undo 대상", () => {
  const c = mk();
  c.placeGate(0, 0, "H");
  c.removeGate(0, 0);
  assert.equal(countCells(c.getSnapshot().grid), 0);
  c.undo();
  assert.equal(countCells(c.getSnapshot().grid), 1);
});

test("큐비트 수 변경도 undo 대상", () => {
  const c = mk();
  assert.equal(c.getSnapshot().qubitCount, 4);
  c.setQubitCount(3);
  assert.equal(c.getSnapshot().qubitCount, 3);
  c.undo();
  assert.equal(c.getSnapshot().qubitCount, 4);
  c.redo();
  assert.equal(c.getSnapshot().qubitCount, 3);
});

test("제어 추가/제거 undo", () => {
  const c = mk();
  c.placeGate(0, 0, "Z");
  c.addControl(0, 1); // Z에 컨트롤 부착 → CZ
  assert.deepEqual(c.getSnapshot().grid[0][0].controls, [1]);
  c.undo();
  assert.deepEqual(c.getSnapshot().grid[0][0].controls, []); // 컨트롤 제거됨
});

test("새 변경을 하면 redo 스택이 비워진다", () => {
  const c = mk();
  c.placeGate(0, 0, "H");
  c.undo();
  assert.equal(c.getSnapshot().canRedo, true);
  c.placeGate(1, 1, "X"); // 새 변경
  assert.equal(c.getSnapshot().canRedo, false);
});

test("비변경 동작(selectQubit/reset)은 히스토리에 쌓이지 않는다", () => {
  const c = mk();
  c.placeGate(0, 0, "H");
  c.selectQubit(2);
  c.reset();
  c.undo(); // 배치 하나만 되돌려야 함
  assert.equal(countCells(c.getSnapshot().grid), 0);
  assert.equal(c.getSnapshot().canUndo, false);
});

test("빈 스택에서 undo/redo는 무해(no-op)", () => {
  const c = mk();
  c.undo();
  c.redo();
  assert.equal(countCells(c.getSnapshot().grid), 0);
  assert.equal(c.getSnapshot().canUndo, false);
});

test("[2] 히스토리는 최대 50단계로 제한된다", () => {
  const c = mk();
  c.setQubitCount(6); // push 1
  let placed = 0;
  outer: for (let col = 0; col < MAX_COLUMNS; col++) {
    for (let row = 0; row < 6; row++) {
      if (placed >= 55) break outer;
      c.placeGate(col, row, "H"); // push 55 → 총 56, 50으로 제한
      placed++;
    }
  }
  let undos = 0;
  while (c.getSnapshot().canUndo && undos < 200) {
    c.undo();
    undos++;
  }
  assert.equal(undos, 50); // 오래된 것부터 버려 정확히 50번만 되돌릴 수 있음
});

test("undo/redo가 저장 스냅샷을 이후 변경으로 오염시키지 않는다", () => {
  const c = mk();
  c.placeGate(0, 0, "H");
  c.undo();               // 빈 회로 저장(redo에), 배치 전 상태(undo에)
  c.placeGate(0, 0, "X"); // 같은 자리에 다른 게이트
  c.undo();               // 다시 빈 회로
  assert.equal(countCells(c.getSnapshot().grid), 0);
});
