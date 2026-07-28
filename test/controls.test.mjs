// "•"(control) 배치 UI의 컨트롤러 레벨 검증.
// 게이트 위 드롭(addControlToGate) = 제어형 변환 + 제어 큐비트 자동 배치,
// 빈 칸 드롭(addControl) = 최근접 게이트에 부착(기존 동작), 제어점 드래그 이동(moveControl).
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
// canUndo가 false가 될 때까지 undo를 호출한 횟수 = 히스토리에 쌓인 단계 수
function undoDepth(c) {
  let n = 0;
  while (c.getSnapshot().canUndo && n < 200) { c.undo(); n++; }
  return n;
}

test("[1] q1의 Y 위에 • 드롭 → 제어가 q0에 자동 배치되고 CY가 된다", () => {
  const c = mk();
  c.placeGate(0, 1, "Y");
  const res = c.addControlToGate(0, 1);
  assert.equal(res.ok, true);
  const cell = cellAt(c, 0, 1);
  assert.deepEqual(cell.controls, [0]);
  assert.deepEqual(cell.targets, [1]);
  // QASM에서도 표준 CY로 나가야 한다
  const s = c.getSnapshot();
  assert.match(toQASM(s.qubitCount, s.grid), /cy q\[0\],q\[1\];/);
});

test("[1] q0(맨 위)의 Y 위에 • 드롭 → 위쪽이 없으므로 아래쪽 q1에 배치", () => {
  const c = mk();
  c.placeGate(0, 0, "Y");
  assert.equal(c.addControlToGate(0, 0).ok, true);
  assert.deepEqual(cellAt(c, 0, 0).controls, [1]);
});

test("[1] 빈 와이어가 없으면 거부 + 사유 문구", () => {
  const c = mk();
  c.setQubitCount(2);
  c.placeGate(0, 0, "Y");
  c.addControl(0, 1); // q1은 이미 제어점
  const res = c.addControlToGate(0, 0);
  assert.equal(res.ok, false);
  assert.equal(res.reason, "No free wire in this column for a control");
  assert.deepEqual(cellAt(c, 0, 0).controls, [1]); // 회로 불변
});

test("[2] 게이트 위 드롭과 빈 칸 드롭의 결과 셀·직렬화가 완전히 동일", () => {
  const a = mk(); // (a) 게이트 위에 드롭 → q0 자동 배치
  a.placeGate(0, 1, "Y");
  a.addControlToGate(0, 1);

  const b = mk(); // (b) 빈 칸(q0)에 직접 드롭
  b.placeGate(0, 1, "Y");
  b.addControl(0, 0);

  const sa = a.getSnapshot(), sb = b.getSnapshot();
  assert.deepEqual(cellAt(a, 0, 1), cellAt(b, 0, 1));
  assert.equal(encodeCircuit(sa.qubitCount, sa.grid), encodeCircuit(sb.qubitCount, sb.grid));
});

test("[1] 제어는 누적된다 — 기존 제어를 덮어쓰지 않는다", () => {
  const c = mk(); // 4큐비트: q2에 X, 제어 q1 → 다시 드롭하면 q0가 추가
  c.placeGate(0, 2, "X");
  c.addControl(0, 1);
  assert.equal(c.addControlToGate(0, 2).ok, true);
  assert.deepEqual(cellAt(c, 0, 2).controls, [1, 0]); // 기존 [1] 보존 + 신규 0
});

test("[1] 거부: Measure/Reset/Barrier + 순수 CTRL 셀", () => {
  for (const g of ["MEASURE", "RESET", "BARRIER"]) {
    const c = mk();
    c.placeGate(0, 1, g);
    const res = c.addControlToGate(0, 1);
    assert.equal(res.ok, false);
    assert.equal(res.reason, `${g} cannot be controlled`);
  }
  const c = mk(); // 대상 게이트 없이 놓인 순수 CTRL 점
  c.placeGate(0, 1, "CTRL");
  const res = c.addControlToGate(0, 1);
  assert.equal(res.ok, false);
  assert.equal(res.reason, "A control cannot be controlled");
});

test("[수정 1] CZ의 두 점(타깃/제어) 어느 쪽에 드롭해도 결과 셀이 동일", () => {
  // CZ는 •—• 로 그려져 두 점이 화면상 구별 불가능하다 → 동작도 같아야 한다.
  const mkCZ = () => { const c = mk(); c.placeGate(0, 2, "Z"); c.addControl(0, 1); return c; };
  const onTarget = mkCZ(); // 타깃(q2) 쪽 점에 드롭
  const onControl = mkCZ(); // 제어(q1) 쪽 점에 드롭
  assert.equal(onTarget.addControlToGate(0, 2).ok, true);
  assert.equal(onControl.addControlToGate(0, 1).ok, true);
  assert.deepEqual(cellAt(onTarget, 0, 2), cellAt(onControl, 0, 2));
  assert.deepEqual(cellAt(onTarget, 0, 2).controls, [1, 0]); // 둘 다 같은 CCZ
});

test("[3] moveControl: 제어를 옮기면 상태벡터가 그에 맞게 바뀐다", () => {
  // q0만 |1>로 만든 뒤 CX(q0→q3): 제어가 q0면 q3가 뒤집혀 |1001>(idx 9),
  // 제어를 q2(=|0>)로 옮기면 뒤집히지 않아 |1000>(idx 1)이 되어야 한다.
  const c = mk();
  c.placeGate(0, 0, "X");
  c.placeGate(1, 3, "X");
  c.addControl(1, 0);
  const probOf = (s) => {
    const st = simulate(s.qubitCount, s.grid);
    return st.map((z) => z.re * z.re + z.im * z.im);
  };
  const before = probOf(c.getSnapshot());
  assert.ok(before[9] > 0.999, `제어 q0: |1001> 기대, got idx9=${before[9]}`);

  assert.equal(c.moveControl(1, 0, 2), true);
  assert.deepEqual(cellAt(c, 1, 3).controls, [2]);
  const after = probOf(c.getSnapshot());
  assert.ok(after[1] > 0.999, `제어 q2: |1000> 기대, got idx1=${after[1]}`);
  assert.ok(after[9] < 1e-9);
});

test("[3] moveControl 거부: 게이트 와이어·다른 제어점 와이어·다른 열", () => {
  const c = mk(); // q3에 X, 제어 q0·q1
  c.placeGate(0, 3, "X");
  c.addControl(0, 0);
  c.addControl(0, 1);
  const before = JSON.stringify(c.getSnapshot().grid);
  assert.equal(c.moveControl(0, 0, 3), false); // 대상 게이트 와이어
  assert.equal(c.moveControl(0, 0, 1), false); // 이미 다른 제어점
  assert.equal(c.moveControl(1, 0, 2), false); // 다른 열엔 그 제어가 없다
  assert.equal(JSON.stringify(c.getSnapshot().grid), before); // 회로 불변
});

test("[수정 2] 제자리 이동(no-op)은 undo 스택에 쌓이지 않는다", () => {
  const c = mk();
  c.placeGate(0, 2, "X");
  c.addControl(0, 0); // 여기까지 2단계
  const depthBefore = undoDepth(c);
  // 같은 회로를 다시 만들어 no-op 이동만 추가
  const d = mk();
  d.placeGate(0, 2, "X");
  d.addControl(0, 0);
  assert.equal(d.moveControl(0, 0, 0), false); // 제자리 → 아무 일도 없음
  assert.equal(undoDepth(d), depthBefore); // 히스토리 깊이 동일
});

test("[수정 3] 회귀: 빈 칸 드롭은 최근접 게이트에 붙는다(기존 동작 유지)", () => {
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

test("[4] 네 동작(게이트 위 드롭/빈 칸 드롭/이동/제거)이 각각 undo 한 단계씩", () => {
  const c = mk();
  c.placeGate(0, 2, "X");          // 1
  c.addControlToGate(0, 2);        // 2: 제어 q1 자동 배치
  const afterAuto = JSON.stringify(c.getSnapshot().grid);
  c.addControl(0, 0);              // 3: 빈 칸 q0에 제어 추가
  const afterManual = JSON.stringify(c.getSnapshot().grid);
  c.moveControl(0, 0, 3);          // 4: q0 → q3 이동
  const afterMove = JSON.stringify(c.getSnapshot().grid);
  c.removeControl(0, 1);           // 5: 제어 제거
  assert.notEqual(JSON.stringify(c.getSnapshot().grid), afterMove);

  c.undo(); // 제거 취소
  assert.equal(JSON.stringify(c.getSnapshot().grid), afterMove);
  c.undo(); // 이동 취소
  assert.equal(JSON.stringify(c.getSnapshot().grid), afterManual);
  c.undo(); // 빈 칸 드롭 취소
  assert.equal(JSON.stringify(c.getSnapshot().grid), afterAuto);
  c.undo(); // 게이트 위 드롭 취소
  assert.deepEqual(cellAt(c, 0, 2).controls, []);
  c.undo(); // 배치 취소
  assert.equal(cellAt(c, 0, 2), null);
});
