// "•"(control) 배치 UI의 컨트롤러 레벨 검증.
// 게이트 위 드롭 = controlOptions(후보 조회, 부작용 없음) → 팝오버 선택 → addControlToGate(확정),
// 빈 칸 드롭 = addControl(같은 열 최근접 게이트에 부착, 기존 동작).
// 핵심 불변식: 두 배치 경로가 같은 큐비트를 가리키면 **결과 셀이 완전히 동일**해야 한다.
// 실행: node --test test/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createCircuitController, simulate } from "../js/circuit.js";
import { toQASM, encodeCircuit } from "../js/export.js";

function mk() {
  return createCircuitController({ onChange: () => {}, onAnimateStep: async () => {} });
}
const cellAt = (c, col, row) => c.getSnapshot().grid[col][row];

test("3큐비트 q1의 Y 위에 • 드롭 → 후보 [0,2], q2를 고르면 CY(q2 제어)", () => {
  const c = mk();
  c.setQubitCount(3);
  c.placeGate(0, 1, "Y");
  const opt = c.controlOptions(0, 1);
  assert.equal(opt.ok, true);
  assert.deepEqual(opt.candidates, [0, 2]); // 오름차순, 열의 빈 와이어 전부
  assert.equal(c.addControlToGate(0, 1, 2).ok, true);
  const cell = cellAt(c, 0, 1);
  assert.deepEqual(cell.controls, [2]);
  assert.deepEqual(cell.targets, [1]);
  const s = c.getSnapshot();
  assert.match(toQASM(s.qubitCount, s.grid), /cy q\[2\],q\[1\];/);
});

test("2큐비트 q1의 Y 위에 • 드롭 → 후보가 q0 하나뿐(UI는 팝오버 없이 즉시 배치)", () => {
  const c = mk();
  c.setQubitCount(2);
  c.placeGate(0, 1, "Y");
  const opt = c.controlOptions(0, 1);
  assert.deepEqual(opt.candidates, [0]);
  assert.equal(c.addControlToGate(0, 1, 0).ok, true);
  assert.deepEqual(cellAt(c, 0, 1).controls, [0]);
});

test("후보가 0개면 팝오버 없이 거부 + 사유 문구", () => {
  const c = mk();
  c.setQubitCount(2);
  c.placeGate(0, 0, "Y");
  c.addControl(0, 1); // q1은 이미 제어점 → 빈 와이어 없음
  const opt = c.controlOptions(0, 0);
  assert.equal(opt.ok, false);
  assert.equal(opt.reason, "No free wire in this column for a control");
  assert.deepEqual(cellAt(c, 0, 0).controls, [1]); // 회로 불변
});

test("취소(팝오버를 띄우기만 함)는 회로도 undo 스택도 건드리지 않는다", () => {
  const c = mk();
  c.placeGate(0, 1, "Y");
  const before = JSON.stringify(c.getSnapshot().grid);
  const opt = c.controlOptions(0, 1); // 팝오버를 여는 데 필요한 조회
  assert.equal(opt.ok, true);
  assert.equal(JSON.stringify(c.getSnapshot().grid), before); // 회로 불변
  // undo 깊이도 그대로 (배치 1단계뿐)
  let n = 0;
  while (c.getSnapshot().canUndo && n < 50) { c.undo(); n++; }
  assert.equal(n, 1);
});

test("고를 수 없는 큐비트로 확정하면 거부된다", () => {
  const c = mk();
  c.placeGate(0, 1, "Y");
  const res = c.addControlToGate(0, 1, 1); // 자기 자신(게이트가 쓰는 와이어)
  assert.equal(res.ok, false);
  assert.deepEqual(cellAt(c, 0, 1).controls, []);
});

test("[2] 팝오버 선택과 빈 칸 드롭의 결과 셀·직렬화가 완전히 동일", () => {
  const a = mk(); // (a) 게이트 위에 드롭 → 팝오버에서 q0 선택
  a.placeGate(0, 1, "Y");
  a.addControlToGate(0, 1, 0);

  const b = mk(); // (b) 빈 칸(q0)에 직접 드롭
  b.placeGate(0, 1, "Y");
  b.addControl(0, 0);

  const sa = a.getSnapshot(), sb = b.getSnapshot();
  assert.deepEqual(cellAt(a, 0, 1), cellAt(b, 0, 1));
  assert.equal(encodeCircuit(sa.qubitCount, sa.grid), encodeCircuit(sb.qubitCount, sb.grid));
});

test("제어는 누적된다 — 기존 제어를 덮어쓰지 않는다", () => {
  const c = mk(); // 4큐비트: q2에 X, 제어 q1 → 다시 드롭해 q0를 고르면 추가된다
  c.placeGate(0, 2, "X");
  c.addControl(0, 1);
  assert.deepEqual(c.controlOptions(0, 2).candidates, [0, 3]); // q1(제어)·q2(타깃)는 제외
  assert.equal(c.addControlToGate(0, 2, 0).ok, true);
  assert.deepEqual(cellAt(c, 0, 2).controls, [1, 0]); // 기존 [1] 보존 + 신규 0
});

test("거부: Measure/Reset/Barrier + 순수 CTRL 셀 (팝오버 전 단계에서)", () => {
  for (const g of ["MEASURE", "RESET", "BARRIER"]) {
    const c = mk();
    c.placeGate(0, 1, g);
    const opt = c.controlOptions(0, 1);
    assert.equal(opt.ok, false);
    assert.equal(opt.reason, `${g} cannot be controlled`);
  }
  const c = mk(); // 대상 게이트 없이 놓인 순수 CTRL 점
  c.placeGate(0, 1, "CTRL");
  const opt = c.controlOptions(0, 1);
  assert.equal(opt.ok, false);
  assert.equal(opt.reason, "A control cannot be controlled");
});

test("CZ의 두 점(타깃/제어) 어느 쪽에 드롭해도 후보·결과 셀이 동일", () => {
  // CZ는 •—• 로 그려져 두 점이 화면상 구별 불가능하다 → 동작도 같아야 한다.
  const mkCZ = () => { const c = mk(); c.placeGate(0, 2, "Z"); c.addControl(0, 1); return c; };
  const onTarget = mkCZ(); // 타깃(q2) 쪽 점에 드롭
  const onControl = mkCZ(); // 제어(q1) 쪽 점에 드롭
  assert.deepEqual(onTarget.controlOptions(0, 2).candidates, onControl.controlOptions(0, 1).candidates);
  assert.equal(onTarget.addControlToGate(0, 2, 0).ok, true);
  assert.equal(onControl.addControlToGate(0, 1, 0).ok, true);
  assert.deepEqual(cellAt(onTarget, 0, 2), cellAt(onControl, 0, 2));
  assert.deepEqual(cellAt(onTarget, 0, 2).controls, [1, 0]); // 둘 다 같은 CCZ
});

test("고른 제어가 실제 시뮬레이션에 반영된다", () => {
  // q0만 |1>로 만든 뒤 CX(q0→q3): 제어 q0면 q3가 뒤집혀 |1001>(idx 9),
  // 제어를 q2(=|0>)로 고르면 뒤집히지 않아 idx 1이어야 한다.
  const probOf = (c) => {
    const s = c.getSnapshot();
    return simulate(s.qubitCount, s.grid).map((z) => z.re * z.re + z.im * z.im);
  };
  const withQ0 = mk();
  withQ0.placeGate(0, 0, "X");
  withQ0.placeGate(1, 3, "X");
  withQ0.addControlToGate(1, 3, 0);
  assert.ok(probOf(withQ0)[9] > 0.999);

  const withQ2 = mk();
  withQ2.placeGate(0, 0, "X");
  withQ2.placeGate(1, 3, "X");
  withQ2.addControlToGate(1, 3, 2);
  assert.ok(probOf(withQ2)[1] > 0.999);
});

test("회귀: 빈 칸 드롭은 최근접 게이트에 붙는다(기존 동작 유지)", () => {
  const c = mk(); // 한 열에 게이트 둘: q0의 H, q3의 X. 빈 칸 q2에 드롭 → q3(더 가까움)에 부착
  c.placeGate(0, 0, "H");
  c.placeGate(0, 3, "X");
  assert.equal(c.addControl(0, 2).ok, true);
  assert.deepEqual(cellAt(c, 0, 3).controls, [2]);
  assert.deepEqual(cellAt(c, 0, 0).controls, []); // 먼 쪽은 그대로

  const c2 = mk(); // 빈 칸 q1에 드롭 → q0(더 가까움)에 부착
  c2.placeGate(0, 0, "H");
  c2.placeGate(0, 3, "X");
  assert.equal(c2.addControl(0, 1).ok, true);
  assert.deepEqual(cellAt(c2, 0, 0).controls, [1]);
  assert.deepEqual(cellAt(c2, 0, 3).controls, []);
});

test("[4] 세 동작(게이트 위 드롭/빈 칸 드롭/제거)이 각각 undo 한 단계씩", () => {
  const c = mk();
  c.placeGate(0, 2, "X");            // 1
  c.addControlToGate(0, 2, 1);       // 2: 팝오버에서 q1 선택
  const afterPick = JSON.stringify(c.getSnapshot().grid);
  c.addControl(0, 0);                // 3: 빈 칸 q0에 제어 추가
  const afterManual = JSON.stringify(c.getSnapshot().grid);
  c.removeControl(0, 1);             // 4: 제어 제거
  assert.notEqual(JSON.stringify(c.getSnapshot().grid), afterManual);

  c.undo(); // 제거 취소
  assert.equal(JSON.stringify(c.getSnapshot().grid), afterManual);
  c.undo(); // 빈 칸 드롭 취소
  assert.equal(JSON.stringify(c.getSnapshot().grid), afterPick);
  c.undo(); // 게이트 위 드롭 취소
  assert.deepEqual(cellAt(c, 0, 2).controls, []);
  c.undo(); // 배치 취소
  assert.equal(cellAt(c, 0, 2), null);
});
