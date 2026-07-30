// 고전 레지스터 + 지연 측정(deferred measurement) 변환 검증.
//
// 이 앱은 상태벡터 시뮬레이터라 중간 측정을 진짜로 수행할 수 없다. 대신 조건부 연산을 양자 제어로
// 바꾸는 지연 측정 변환을 쓴다 — 최종 측정 통계는 동일하다. 이 테스트는 (a) 그 변환이 실제로
// 교과서 프로토콜을 재현하는지, (b) 변환이 성립하지 않는 회로를 **조용히 통과시키지 않는지**,
// (c) 측정이 없는 기존 회로의 결과가 **진폭 단위로 불변**인지를 고정한다.
// 실행: node --test test/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCircuitController, simulate, MAX_COLUMNS } from "../js/circuit.js";
import { resolveDeferred, hasMeasurement } from "../js/classical.js";
import { reducedDensityInfo } from "../js/density.js";
import { decodeCircuit, encodeCircuit, toQASM, toQiskit } from "../js/export.js";
import { PRESETS } from "../js/presets.js";

const mk = () => createCircuitController({ onChange: () => {}, onAnimateStep: async () => {} });
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;
const emptyGrid = (n) => Array.from({ length: MAX_COLUMNS }, () => new Array(n).fill(null));
const cell = (gate, targets, controls = [], params = {}) => ({ gate, targets, controls, params });
const cellAt = (c, col, row) => c.getSnapshot().grid[col][row];
const S = Math.SQRT1_2;

// ---------- [6] 회귀: 측정이 없는 회로는 진폭까지 완전히 동일해야 한다 ----------

test("[6] 기존 프리셋의 상태벡터가 이 작업 전과 진폭(실수부/허수부)까지 동일", () => {
  const baseline = JSON.parse(readFileSync(new URL("./fixtures-baseline.json", import.meta.url), "utf8"));
  for (const p of PRESETS) {
    const expected = baseline[p.name];
    if (!expected) continue; // 이번에 새로 바뀐 프리셋은 아래 전용 테스트가 검증한다
    const dec = decodeCircuit(p.circuit);
    const st = simulate(dec.qubitCount, dec.grid);
    assert.equal(st.length, expected.length, `${p.name} 길이`);
    for (let i = 0; i < st.length; i++) {
      assert.ok(near(st[i].re, expected[i][0]) && near(st[i].im, expected[i][1]),
        `${p.name} idx ${i}: (${st[i].re},${st[i].im}) ≠ (${expected[i][0]},${expected[i][1]})`);
    }
  }
});

test("[6] 조건부 연산이 없으면 resolveDeferred가 그리드를 그대로 돌려준다(동일 참조)", () => {
  const g = emptyGrid(3);
  g[0][0] = cell("H", [0]);
  g[1][1] = cell("X", [1], [0]);
  const res = resolveDeferred(3, 3, g);
  assert.equal(res.error, null);
  assert.equal(res.grid, g); // 새 객체를 만들지 않는다 → 결과가 비트 단위로 불변
});

// ---------- 지연 측정 변환 ----------

test("조건부 연산이 측정한 큐비트를 제어로 삼는 게이트로 변환된다", () => {
  const g = emptyGrid(3);
  g[0][0] = cell("MEASURE", [0], [], { cbit: 0 });
  g[1][2] = cell("X", [2], [], { cif: 0 }); // if c0 → X(q2)
  const { grid, error } = resolveDeferred(3, 3, g);
  assert.equal(error, null);
  assert.deepEqual(grid[1][2].controls, [0]); // q0가 제어로 승격
  assert.equal(g[1][2].controls.length, 0);   // 원본은 변형되지 않는다
});

test("텔레포테이션: 측정 기반 회로가 q0의 상태를 q2로 옮긴다 (여러 입력)", () => {
  // 입력 상태별 기대 Bloch 벡터
  const inputs = [
    { name: "|0>", gates: [], bloch: { x: 0, y: 0, z: 1 } },
    { name: "|1>", gates: [["X", {}]], bloch: { x: 0, y: 0, z: -1 } },
    { name: "|+>", gates: [["H", {}]], bloch: { x: 1, y: 0, z: 0 } },
    { name: "T|+>", gates: [["H", {}], ["T", {}]], bloch: { x: S, y: S, z: 0 } },
  ];
  for (const inp of inputs) {
    const g = emptyGrid(3);
    let col = 0;
    for (const [gate, params] of inp.gates) g[col++][0] = cell(gate, [0], [], params);
    // Bell 쌍 (q1,q2)
    g[col][1] = cell("H", [1]);
    col++;
    g[col][2] = cell("X", [2], [1]);
    col++;
    // Bell 측정 (q0,q1)
    g[col][1] = cell("X", [1], [0]);
    col++;
    g[col][0] = cell("H", [0]);
    col++;
    g[col][0] = cell("MEASURE", [0], [], { cbit: 0 });
    g[col][1] = cell("MEASURE", [1], [], { cbit: 1 });
    col++;
    // 조건부 보정: if c1 → X(q2), if c0 → Z(q2)
    g[col][2] = cell("X", [2], [], { cif: 1 });
    col++;
    g[col][2] = cell("Z", [2], [], { cif: 0 });

    const st = simulate(3, g, undefined, 3);
    const info = reducedDensityInfo(st, 2);
    assert.ok(near(info.bloch.x, inp.bloch.x, 1e-6) && near(info.bloch.y, inp.bloch.y, 1e-6) && near(info.bloch.z, inp.bloch.z, 1e-6),
      `${inp.name}: q2 bloch=(${info.bloch.x.toFixed(3)},${info.bloch.y.toFixed(3)},${info.bloch.z.toFixed(3)})`);
    assert.ok(near(info.purity, 1, 1e-6), `${inp.name}: purity=${info.purity}`);
  }
});

test("초고밀도 부호화: 4가지 메시지가 각각 확정된 기저 상태로 구분된다", () => {
  // 인코딩: b0 → X, b1 → Z 를 q0(앨리스)에 적용. 디코딩: CNOT(q0→q1), H(q0).
  // 디코드 후 q0에는 Z비트(b1)가, q1에는 X비트(b0)가 실린다 → index = q0 + 2·q1 = b1 + 2·b0.
  const seen = new Set();
  for (let msg = 0; msg < 4; msg++) {
    const g = emptyGrid(2);
    g[0][0] = cell("H", [0]);
    g[1][1] = cell("X", [1], [0]);       // Bell 쌍
    if (msg & 1) g[2][0] = cell("X", [0]);
    if (msg & 2) g[3][0] = cell("Z", [0]);
    g[4][1] = cell("X", [1], [0]);        // 디코드
    g[5][0] = cell("H", [0]);
    g[6][0] = cell("MEASURE", [0], [], { cbit: 0 });
    g[6][1] = cell("MEASURE", [1], [], { cbit: 1 });
    const st = simulate(2, g, undefined, 2);
    const probs = st.map((z) => z.re * z.re + z.im * z.im);
    const winner = probs.findIndex((p) => p > 0.999);
    const expected = ((msg >> 1) & 1) + 2 * (msg & 1); // q0=b1, q1=b0
    assert.equal(winner, expected, `msg ${msg}: 확정 기저 ${winner}, probs=${probs.map((p) => p.toFixed(3))}`);
    seen.add(winner);
  }
  assert.equal(seen.size, 4, "4가지 메시지가 서로 다른 기저 상태로 구분되어야 한다");
});

test("허용: 측정된 큐비트를 이후 '제어'로만 쓰는 건 정상 동작한다(변환의 전제)", () => {
  const g = emptyGrid(2);
  g[0][0] = cell("H", [0]);
  g[1][0] = cell("MEASURE", [0], [], { cbit: 0 });
  g[2][1] = cell("X", [1], [0]); // 측정된 q0를 제어로 사용 — Z기저 측정과 교환되므로 허용
  const { error } = resolveDeferred(2, 2, g);
  assert.equal(error, null);
  const st = simulate(2, g, undefined, 2);
  const probs = st.map((z) => z.re * z.re + z.im * z.im);
  assert.ok(near(probs[0], 0.5, 1e-9) && near(probs[3], 0.5, 1e-9), JSON.stringify(probs));
});

// ---------- [4] 거부 ----------

test("거부: 측정된 큐비트를 이후 타깃으로 조작하면 사유와 함께 거부", () => {
  const g = emptyGrid(2);
  g[0][0] = cell("MEASURE", [0], [], { cbit: 0 });
  g[1][0] = cell("H", [0]); // 측정 후 타깃 조작
  const { grid, error } = resolveDeferred(2, 2, g);
  assert.equal(grid, null);
  assert.match(error, /q\[0\] is measured/);
  assert.match(error, /column 2/);
  assert.throws(() => simulate(2, g, undefined, 2), /is measured/); // 조용히 틀린 상태를 내지 않는다
});

test("거부: 측정된 큐비트를 RESET하면 거부(지연 측정 변환이 성립하지 않음)", () => {
  const g = emptyGrid(2);
  g[0][1] = cell("MEASURE", [1], [], { cbit: 1 });
  g[1][1] = cell("RESET", [1]);
  const { error } = resolveDeferred(2, 2, g);
  assert.match(error, /RESET|Reset|\|0⟩/);
});

test("거부: 기록되지 않은 고전 비트를 조건으로 쓰면 거부", () => {
  const g = emptyGrid(2);
  g[0][0] = cell("X", [0], [], { cif: 1 }); // c1에 아무도 기록하지 않았다
  const { grid, error } = resolveDeferred(2, 2, g);
  assert.equal(grid, null);
  assert.match(error, /c\[1\]/);
  assert.match(error, /nothing has measured/);
});

test("거부: 조건 비트가 측정보다 앞 열이면(아직 기록 전) 거부", () => {
  const g = emptyGrid(2);
  g[0][0] = cell("X", [0], [], { cif: 1 }); // 조건이 먼저
  g[1][1] = cell("MEASURE", [1], [], { cbit: 1 }); // 기록은 나중
  assert.match(resolveDeferred(2, 2, g).error, /nothing has measured into c\[1\]/);
});

test("거부: 레지스터 밖 고전 비트를 조건으로 쓰면 거부", () => {
  const g = emptyGrid(2);
  g[0][0] = cell("X", [0], [], { cif: 5 });
  assert.match(resolveDeferred(2, 2, g).error, /outside the classical register/);
});

test("컨트롤러: 거부 회로는 deferredError를 올리고 상태를 결과로 제시하지 않는다", () => {
  const c = mk();
  c.placeGate(0, 0, "MEASURE");
  c.placeGate(1, 0, "H"); // 측정 후 조작 → 거부
  const snap = c.getSnapshot();
  assert.ok(snap.deferredError, "deferredError가 있어야 한다");
  assert.match(snap.deferredError, /is measured/);
});

// ---------- 고전 레지스터 상태 ----------

test("clbitCount: 기본은 큐비트 수, 0으로 줄이면 cbit/cif 참조가 정리된다", () => {
  const c = mk();
  assert.equal(c.getSnapshot().clbitCount, 4);
  c.placeGate(0, 2, "MEASURE");
  assert.equal(c.getSnapshot().grid[0][2].params.cbit, 2); // q2 → c2 기본값
  c.setClbitCount(0);
  const snap = c.getSnapshot();
  assert.equal(snap.clbitCount, 0);
  assert.equal(snap.grid[0][2].params.cbit, undefined); // 범위 밖 참조 제거
  c.undo();
  assert.equal(c.getSnapshot().clbitCount, 4); // undo로 복원
});

test("setCondition / setClassicalBit + undo", () => {
  const c = mk();
  c.placeGate(0, 0, "MEASURE");
  c.placeGate(1, 1, "X");
  assert.equal(c.setCondition(1, 1, 0).ok, true);
  assert.equal(c.getSnapshot().grid[1][1].params.cif, 0);
  assert.equal(c.setClassicalBit(0, 0, 3).ok, true);
  assert.equal(c.getSnapshot().grid[0][0].params.cbit, 3);
  c.undo();
  assert.equal(c.getSnapshot().grid[0][0].params.cbit, 0);
  // 조건 해제
  assert.equal(c.setCondition(1, 1, null).ok, true);
  assert.equal(c.getSnapshot().grid[1][1].params.cif, undefined);
});

test("hasMeasurement", () => {
  const g = emptyGrid(2);
  assert.equal(hasMeasurement(2, g), false);
  g[0][0] = cell("MEASURE", [0], [], { cbit: 0 });
  assert.equal(hasMeasurement(2, g), true);
});

// ---------- [6] 직렬화 / QASM ----------

test("[6] 고전 비트 정보가 없는 기존 URL이 그대로 열린다(clbitCount = 큐비트 수)", () => {
  for (const p of PRESETS) {
    const dec = decodeCircuit(p.circuit);
    assert.ok(dec, `${p.name} 디코드`);
    assert.equal(dec.clbitCount, dec.qubitCount, `${p.name}: 기본 clbitCount`);
  }
});

test("직렬화 왕복: clbitCount와 cbit/cif가 보존된다", () => {
  const g = emptyGrid(3);
  g[0][0] = cell("MEASURE", [0], [], { cbit: 2 });
  g[1][1] = cell("X", [1], [], { cif: 2 });
  const enc = encodeCircuit(3, g, 1);
  const dec = decodeCircuit(enc);
  assert.equal(dec.clbitCount, 1);
  assert.equal(dec.grid[0][0].params.cbit, 2);
  assert.equal(dec.grid[1][1].params.cif, 2);
});

test("직렬화: clbitCount가 큐비트 수와 같으면 기존 URL 문자열과 동일하다", () => {
  const g = emptyGrid(2);
  g[0][0] = cell("H", [0]);
  assert.equal(encodeCircuit(2, g, 2), encodeCircuit(2, g)); // 새 필드가 붙지 않는다
});

test("QASM: creg + 지정된 고전 비트로의 measure + 조건부 if", () => {
  const g = emptyGrid(3);
  g[0][2] = cell("MEASURE", [2], [], { cbit: 1 });
  g[1][2] = cell("X", [2], [], { cif: 1 });
  const qasm = toQASM(3, g, 3);
  assert.match(qasm, /creg c\[3\];/);
  assert.match(qasm, /measure q\[2\] -> c\[1\];/);
  assert.match(qasm, /if \(c==2\) x q\[2\];/);
});

test("QASM: 고전 비트가 0이면 creg도 measure도 나오지 않는다", () => {
  const g = emptyGrid(2);
  g[0][0] = cell("H", [0]);
  g[1][0] = cell("MEASURE", [0], [], {});
  const qasm = toQASM(2, g, 0);
  assert.ok(!/creg/.test(qasm), qasm);
  assert.ok(!/measure/.test(qasm), qasm);
  assert.match(qasm, /h q\[0\];/);
});

test("Qiskit: c_if와 measure 대상 비트", () => {
  const g = emptyGrid(3);
  g[0][2] = cell("MEASURE", [2], [], { cbit: 1 });
  g[1][2] = cell("X", [2], [], { cif: 1 });
  const code = toQiskit(3, g, 3);
  assert.match(code, /QuantumCircuit\(3, 3\)/);
  assert.match(code, /qc\.measure\(2, 1\)/);
  assert.match(code, /qc\.x\(2\)\.c_if\(qc\.cregs\[0\], 2\)/);
});

// ---------- 재생 루프 예외 격리 (앱이 멈추던 버그) ----------
// 유효하지 않은 회로에서 재생을 누르면 루프가 예외로 빠져나가며 isPlaying/isAnimating이
// true로 고정돼 앱 전체가 조작 불가가 됐다. 어떤 경우에도 플래그가 풀려야 한다.

function invalidController() {
  const c = mk();
  c.placeGate(0, 1, "X");
  c.setCondition(0, 1, 0); // c[0]에 아무도 기록하지 않은 조건 → 시뮬레이션 불가
  return c;
}

test("유효하지 않은 회로: play() 후에도 isPlaying/isAnimating이 풀려 있다", async () => {
  const c = invalidController();
  assert.ok(c.getSnapshot().deferredError, "전제: 검증 실패 상태");
  await c.play();
  const s = c.getSnapshot();
  assert.equal(s.isPlaying, false, "isPlaying이 고정되면 앱이 멈춘다");
  assert.equal(s.isAnimating, false, "isAnimating이 고정되면 앱이 멈춘다");
});

test("유효하지 않은 회로: stepForward/stepBackward 후에도 플래그가 풀려 있다", async () => {
  const c = invalidController();
  await c.stepForward();
  await c.stepBackward();
  const s = c.getSnapshot();
  assert.equal(s.isPlaying, false);
  assert.equal(s.isAnimating, false);
});

test("재생 실패 후에도 배치/삭제/undo가 정상 동작한다", async () => {
  const c = invalidController();
  await c.play();
  c.placeGate(2, 0, "H");
  assert.ok(cellAt(c, 2, 0), "재생 실패 후 게이트를 놓을 수 있어야 한다");
  c.removeGate(2, 0);
  assert.equal(cellAt(c, 2, 0), null);
  c.undo();
  assert.ok(cellAt(c, 2, 0), "undo도 동작해야 한다");
});

test("onAnimateStep이 예외를 던져도 복구된다(예상치 못한 예외 안전망)", async () => {
  const c = createCircuitController({
    onChange: () => {},
    onAnimateStep: async () => { throw new Error("boom"); },
  });
  c.placeGate(0, 0, "H"); // 유효한 회로
  await c.play();
  const s = c.getSnapshot();
  assert.equal(s.isPlaying, false);
  assert.equal(s.isAnimating, false);
  assert.match(s.deferredError ?? "", /boom/); // 사유가 사용자에게 전달된다
  c.placeGate(1, 1, "X");
  assert.ok(cellAt(c, 1, 1), "예외 후에도 조작 가능해야 한다");
});

test("onChange(렌더)가 예외를 던져도 컨트롤러가 죽지 않는다", () => {
  let boom = true;
  const c = createCircuitController({
    onChange: () => { if (boom) throw new Error("render exploded"); },
    onAnimateStep: async () => {},
  });
  c.placeGate(0, 0, "H"); // notify에서 예외 → 삼켜져야 한다
  boom = false;
  assert.ok(c.getSnapshot().grid[0][0], "회로 변경은 반영되어야 한다");
});

test("validate(): 조건을 지우거나 Measure를 추가하면 즉시 유효해진다", () => {
  const c = invalidController();
  const bad = c.validate();
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /nothing has measured into c\[0\]/);

  c.setCondition(0, 1, null); // 조건 제거
  assert.equal(c.validate().ok, true);

  c.setCondition(0, 1, 0);    // 다시 유효하지 않게
  assert.equal(c.validate().ok, false);
  c.placeGate(0, 0, "MEASURE"); // 같은 열이라 아직 기록 전 → 여전히 무효
  assert.equal(c.validate().ok, false);
  c.removeGate(0, 0);
  c.placeGate(0, 0, "MEASURE");
  c.setCondition(0, 1, null);
  c.placeGate(1, 1, "X");
  c.setCondition(1, 1, 0);    // 앞 열에서 기록한 c[0] 조건 → 유효
  assert.equal(c.validate().ok, true);
});

test("정상 회로의 재생은 예전과 동일하게 끝까지 진행된다", async () => {
  const c = mk();
  c.placeGate(0, 0, "H");
  c.placeGate(1, 1, "X");
  c.reset();
  assert.equal(c.getSnapshot().stepIndex, 0);
  await c.play();
  const s = c.getSnapshot();
  assert.equal(s.stepIndex, s.totalSteps, "끝까지 재생");
  assert.equal(s.isPlaying, false);
  assert.equal(s.isAnimating, false);
  assert.equal(s.deferredError, null);
});
