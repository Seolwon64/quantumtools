// 코드 밴드의 충돌 줄("Circuit changed" + Reload / Keep) 판정.
//
// main.js render 는 렌더마다 codePanel.onCircuitChanged() 를 부른다 — 큐비트 선택·재생 스텝·Inspect 도 렌더다.
// 예전엔 편집 중이면 그 렌더마다 충돌로 봐서, 회로가 그대로인데 "Circuit changed" 가 떴고 그 거짓 문구가 편집을 버리는
// Reload 를 누르게 했다. 판정은 편집의 바탕이 된 회로와 지금 회로의 **서명**(공유 URL 인코딩)을 비교한다.
// DOM 은 쓰지 않는다 — 실제 컨트롤러를 돌려 렌더마다 판정을 본다.
import test from "node:test";
import assert from "node:assert/strict";

import { codeConflict } from "../js/codepanel.js";
import { circuitSignature } from "../js/export.js";
import { createCircuitController, MAX_COLUMNS } from "../js/circuit.js";

const cell = (gate, targets, controls = [], params = {}) => ({ gate, targets, controls, params });

/** 측정 뒤에 연산이 있는 궤적 회로 + 파라미터 게이트·조건부·측정 비트 — 편집의 종류를 모두 시험할 수 있다. */
function fixtureGrid() {
  const g = Array.from({ length: MAX_COLUMNS }, () => [null, null]);
  g[0][0] = cell("H", [0]);
  g[1][0] = cell("MEASURE", [0], [], { cbit: 0 });
  g[2][0] = cell("H", [0]);
  g[2][1] = cell("RX", [1], [], { theta: 0.5 });
  g[3][1] = cell("X", [1], [], { cif: 0 });
  return g;
}

/** 렌더(onChange)마다 스냅샷을 모으는 컨트롤러. 렌더가 곧 onCircuitChanged 호출이다. */
function session() {
  const renders = [];
  const c = createCircuitController({
    onChange: (s) => renders.push(s),
    onAnimateStep: async () => {},
    initial: { qubitCount: 2, clbitCount: 2, grid: fixtureGrid() },
  });
  renders.length = 0; // 생성 때의 렌더는 편집 전이다
  return { c, renders, base: circuitSignature(c.getSnapshot()) };
}

const conflictAt = (snapshot, baseSignature) => codeConflict({ modified: true, baseSignature, snapshot });

test("편집 중에 회로를 바꾸지 않는 조작은 충돌 줄을 띄우지 않는다 — 큐비트 선택·재생·스텝·Inspect·Resample·보기 전환", async () => {
  const { c, renders, base } = session();
  c.selectQubit(1);
  c.reset(); // To start
  await c.stepForward();
  await c.stepBackward();
  await c.play();
  c.pause();
  c.setInspectMode(true);
  c.setInspectMode(false);
  c.resample(); // 궤적 회로라 실제로 알린다
  // 컨트롤러를 거치지 않는 렌더(main.js 의 Classical↔Qubits, probview.js 의 샘플링 Run)는 같은 스냅샷을 다시 그린다.
  renders.push(c.getSnapshot());

  // 조작이 렌더를 안 일으켜 통과하는 일을 막는다 — 위 조작들은 실측으로 열 번 넘게 렌더한다.
  assert.ok(renders.length > 10, `렌더가 ${renders.length}번뿐이다 — 이 테스트의 전제가 깨졌다`);
  renders.forEach((s, i) => {
    assert.equal(conflictAt(s, base), false, `${i}번째 렌더에서 회로가 그대로인데 충돌 줄이 뜬다`);
  });
});

test("편집 중에 게이트를 놓으면 충돌 줄이 뜬다 — Keep 뒤로는 다음 진짜 변경까지 다시 뜨지 않는다", () => {
  const { c, base } = session();
  c.placeGate(5, 1, "H");
  assert.equal(conflictAt(c.getSnapshot(), base), true, "게이트를 놓았는데 충돌 줄이 안 뜬다");

  // Keep my edits — 편집을 지금 회로에 맞서 남기겠다는 선택이다. 코드 밴드는 바탕을 지금 회로로 옮긴다.
  // 예전엔 숨기기만 해서 다음 렌더(무엇이든)가 다시 띄웠다.
  const kept = circuitSignature(c.getSnapshot());
  c.selectQubit(1);
  assert.equal(conflictAt(c.getSnapshot(), kept), false, "Keep 뒤 회로를 안 바꾸는 렌더가 충돌 줄을 다시 띄운다");
  c.placeGate(6, 1, "X");
  assert.equal(conflictAt(c.getSnapshot(), kept), true, "Keep 뒤의 진짜 변경이 충돌 줄을 띄우지 않는다");

  assert.equal(codeConflict({ modified: false, baseSignature: base, snapshot: c.getSnapshot() }), false,
    "편집이 없는데 충돌 줄이 뜬다");
});

// 이 테스트는 옛 판정(렌더마다 충돌)에서도 통과해 옛 코드가 대조군이 되지 못한다. 서명에서 필드를 하나 빼는 변이로
// 대조군을 돌린다 — 그 필드의 경우만 실패해야 한다.
//   대조군 확인(수동): node scripts/mutation-control.mjs --file js/export.js \
//     --find "snapshot.grid, snapshot.clbitCount)" --replace "snapshot.grid)" test/codepanel.test.mjs
//   → CAUGHT, 「고전 비트 수 변경」 에서 실패해야 한다
test("편집의 종류마다 진짜 변경은 충돌 줄을 띄운다 — 서명이 회로 필드를 빠뜨리지 않는다", () => {
  // 서명이 어떤 필드를 빠뜨리면 그 변경은 충돌로 안 잡히고, Apply 가 그 변경을 소리 없이 덮어쓴다(데이터 손실).
  // 조작마다 회로가 실제로 바뀌었는지는 서명과 무관하게 스냅샷 필드로 따로 확인한다 — 거부된 조작으로 통과하지 않게.
  const edits = [
    ["게이트 놓기", (c) => c.placeGate(5, 1, "H"), (s) => s.grid[5][1]?.gate === "H"],
    ["파라미터 변경", (c) => c.setParams(2, 1, { theta: 0.9 }), (s) => s.grid[2][1].params.theta === 0.9],
    ["조건 붙이기", (c) => c.setCondition(2, 0, 0), (s) => s.grid[2][0].params.cif === 0],
    ["Measure 의 고전 비트 변경", (c) => c.setClassicalBit(1, 0, 1), (s) => s.grid[1][0].params.cbit === 1],
    ["큐비트 수 변경", (c) => c.setQubitCount(3), (s) => s.qubitCount === 3],
    ["고전 비트 수 변경", (c) => c.setClbitCount(1), (s) => s.clbitCount === 1],
  ];
  for (const [name, edit, changed] of edits) {
    const { c, base } = session();
    edit(c);
    const s = c.getSnapshot();
    assert.ok(changed(s), `${name}: 조작이 회로를 바꾸지 않았다 — 이 테스트의 전제가 깨졌다`);
    assert.equal(conflictAt(s, base), true, `${name}: 회로가 바뀌었는데 충돌 줄이 안 뜬다 — 서명이 이 필드를 빠뜨린다`);
  }
});

test("Undo 로 되돌아온 회로는 바탕 서명과 글자까지 같다 — 바탕으로 돌아오면 충돌 줄이 내려간다", () => {
  // Undo 는 복제한 셀을 되살린다. 서명이 셀의 키 순서나 붙은 값에 흔들리면 여기서 바탕과 달라진다.
  const { c, base } = session();
  c.placeGate(5, 1, "H");
  c.setParams(2, 1, { theta: 0.9 });
  c.setCondition(3, 1, null);
  c.setClassicalBit(1, 0, 1);
  assert.notEqual(circuitSignature(c.getSnapshot()), base, "편집이 회로를 바꾸지 않았다 — 이 테스트의 전제가 깨졌다");
  for (let i = 0; i < 4; i++) c.undo();
  assert.equal(circuitSignature(c.getSnapshot()), base, "Undo 로 돌아온 회로의 서명이 바탕과 다르다");
  assert.equal(conflictAt(c.getSnapshot(), base), false, "바탕으로 돌아왔는데 충돌 줄이 남는다");
});
