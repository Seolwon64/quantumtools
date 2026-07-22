// 회로 데이터 모델 리팩터링 유닛/회귀 테스트. 코드 수정 전에 먼저 작성 (TDD).
// 실행: node --test test/
import test from "node:test";
import assert from "node:assert/strict";

import {
  initialState,
  applyPlacement,
  applyUnitary,
  matrixFor,
} from "../js/quantum.js";
import { simulate, migrateCell, involvedQubits } from "../js/circuit.js";
import { encodeCircuit, decodeCircuit, toQASM, toQiskit } from "../js/export.js";

// ---------- 헬퍼 ----------
// |index> 기저 상태 (n 큐비트, little-endian: q0 = bit 0)
function basis(n, index) {
  const s = initialState(n);
  for (let i = 0; i < s.length; i++) s[i] = { re: 0, im: 0 };
  s[index] = { re: 1, im: 0 };
  return s;
}
function approx(a, b, eps = 1e-9) {
  return Math.abs(a - b) < eps;
}
function statesEqual(a, b, eps = 1e-9) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!approx(a[i].re, b[i].re, eps) || !approx(a[i].im, b[i].im, eps)) return false;
  }
  return true;
}
// 진폭이 1인 유일한 기저 인덱스를 반환 (순수 기저 상태 확인용)
function soleIndex(state) {
  let found = -1;
  for (let i = 0; i < state.length; i++) {
    const mag = state[i].re * state[i].re + state[i].im * state[i].im;
    if (approx(mag, 1)) found = i;
    else if (!approx(mag, 0)) return -2; // 순수 기저가 아님
  }
  return found;
}
// grid 헬퍼: 특정 열/셀만 채운 12열 그리드
function gridWith(qubitCount, placements) {
  const MAX = 12;
  const g = Array.from({ length: MAX }, () => new Array(qubitCount).fill(null));
  for (const { col, row, cell } of placements) g[col][row] = cell;
  return g;
}

// ---------- [5] 명시된 테스트들 ----------

test("X, controls [0] : |q0=1,target=0> → target flips (CNOT 일치)", () => {
  // 2큐비트, target q1, control q0. q0=1(index 1) → q1 flip → index 3
  const cell = { gate: "X", targets: [1], controls: [0], params: {} };
  const out = applyPlacement(basis(2, 0b01), cell);
  assert.equal(soleIndex(out), 0b11);
});

test("X, controls [0,1] : |110>→|111> (CCX 일치)", () => {
  // 3큐비트, target q2, controls q0,q1. q0=q1=1(index 0b011) → q2 flip → 0b111
  const cell = { gate: "X", targets: [2], controls: [0, 1], params: {} };
  const out = applyPlacement(basis(3, 0b011), cell);
  assert.equal(soleIndex(out), 0b111);
});

test("Z, controls [0] : |11>의 진폭 부호만 반전, 나머지 불변", () => {
  // 균등 중첩 2큐비트에서 CZ(control q0, target q1)는 |11>(index 3)만 부호 반전
  const n = 2;
  const s = initialState(n).map(() => ({ re: 0.5, im: 0 }));
  const cell = { gate: "Z", targets: [1], controls: [0], params: {} };
  const out = applyPlacement(s, cell);
  for (let i = 0; i < 4; i++) {
    const expected = i === 0b11 ? -0.5 : 0.5;
    assert.ok(approx(out[i].re, expected), `index ${i} re=${out[i].re}`);
    assert.ok(approx(out[i].im, 0));
  }
});

test("control 조건 불만족이면 상태 완전 불변", () => {
  const cell = { gate: "X", targets: [1], controls: [0], params: {} };
  const input = basis(2, 0b00); // q0=0 → control 불만족
  const out = applyPlacement(input, cell);
  assert.ok(statesEqual(out, input));
});

test("회귀: 마이그레이션된 CNOT/CCX 회로가 기존 controlled-X 결과와 동일", () => {
  // 오라클: 검증된 저수준 applyUnitary(controlled-X)
  const X = matrixFor("X");
  // CNOT: 3큐비트, H q0 후 CNOT(control q0 → target q1)
  const H = matrixFor("H");
  let ref = initialState(3);
  ref = applyUnitary(ref, 0, H, []);
  ref = applyUnitary(ref, 1, X, [0]);

  // 구버전 셀로 구성한 그리드를 마이그레이션 후 simulate
  const oldGrid = gridWith(3, [
    { col: 0, row: 0, cell: { gate: "H" } },
    { col: 1, row: 1, cell: { gate: "CNOT", controls: [0] } },
  ]);
  const migrated = migrateGridForTest(oldGrid, 3);
  const out = simulate(3, migrated);
  assert.ok(statesEqual(out, ref), "CNOT 회귀 불일치");

  // CCX 회귀
  let ref2 = initialState(3);
  ref2 = applyUnitary(ref2, 0, X, []);
  ref2 = applyUnitary(ref2, 1, X, []);
  ref2 = applyUnitary(ref2, 2, X, [0, 1]);
  const oldGrid2 = gridWith(3, [
    { col: 0, row: 0, cell: { gate: "X" } },
    { col: 0, row: 1, cell: { gate: "X" } },
    { col: 1, row: 2, cell: { gate: "CCX", controls: [0, 1] } },
  ]);
  const out2 = simulate(3, migrateGridForTest(oldGrid2, 3));
  assert.ok(statesEqual(out2, ref2), "CCX 회귀 불일치");
});

test("구 URL(v1) 인코딩 회로가 동일하게 복원되어 시뮬레이션됨", () => {
  // 구버전 포맷(JSON v:1, g:'CNOT', x:[0])을 그대로 base64url 인코딩 (배포된 링크 재현)
  const oldJson = JSON.stringify({ v: 1, n: 2, p: [{ c: 0, q: 1, g: "CNOT", x: [0] }] });
  const oldEncoded = btoa(oldJson).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const decoded = decodeCircuit(oldEncoded);
  assert.ok(decoded, "구 URL 디코드 실패");
  assert.equal(decoded.qubitCount, 2);

  // control q0=1이면 target q1 flip
  const out = simulate(2, decoded.grid);
  // 초기 |00>에선 control 불만족 → 불변
  assert.equal(soleIndex(out), 0b00);
  // control을 만족시키는 상태에서 CNOT 동작 확인
  const cnotCell = decoded.grid[0][1];
  const out2 = applyPlacement(basis(2, 0b01), cnotCell);
  assert.equal(soleIndex(out2), 0b11);
});

test("[4] Measure/Reset/Barrier에 컨트롤을 붙이면 명확한 에러", () => {
  for (const gate of ["MEASURE", "RESET", "BARRIER"]) {
    assert.throws(
      () => applyPlacement(initialState(2), { gate, targets: [0], controls: [1], params: {} }),
      /cannot be controlled/i,
      `${gate} 컨트롤 허용됨(에러 안 남)`
    );
  }
});

// ---------- 추가: 새 인코딩 라운드트립 & involvedQubits ----------

test("새 인코딩(v2) 라운드트립: canonical 셀 보존", () => {
  const grid = gridWith(3, [
    { col: 0, row: 2, cell: { gate: "X", targets: [2], controls: [0, 1], params: {} } },
  ]);
  const enc = encodeCircuit(3, grid);
  const dec = decodeCircuit(enc);
  const cell = dec.grid[0][2]; // 열 0, 홈 행 2(targets[0])
  assert.equal(cell.gate, "X");
  assert.deepEqual(cell.targets, [2]);
  assert.deepEqual(cell.controls, [0, 1]);
});

test("involvedQubits = targets ∪ controls", () => {
  const cell = { gate: "SWAP", targets: [0, 2], controls: [3], params: {} };
  assert.deepEqual(involvedQubits(cell).sort(), [0, 2, 3]);
});

test("[3] export 역매핑: X+1→cx, Z+1→cz, X+2→ccx", () => {
  const grid = gridWith(3, [
    { col: 0, row: 1, cell: { gate: "X", targets: [1], controls: [0], params: {} } },  // cx
    { col: 1, row: 1, cell: { gate: "Z", targets: [1], controls: [0], params: {} } },  // cz
    { col: 2, row: 2, cell: { gate: "X", targets: [2], controls: [0, 1], params: {} } }, // ccx
  ]);
  const qasm = toQASM(3, grid);
  assert.match(qasm, /^cx q\[0\],q\[1\];$/m);
  assert.match(qasm, /^cz q\[0\],q\[1\];$/m);
  assert.match(qasm, /^ccx q\[0\],q\[1\],q\[2\];$/m);
  const qiskit = toQiskit(3, grid);
  assert.match(qiskit, /qc\.cx\(0, 1\)/);
  assert.match(qiskit, /qc\.cz\(0, 1\)/);
  assert.match(qiskit, /qc\.ccx\(0, 1, 2\)/);
});

// ---------- RCCX / RC3X 고유 게이트 ----------

// 순수 기저 입력이 amp*|outIdx>로만 매핑되는지 검증
function assertBasisMap(cell, n, inIdx, outIdx, amp) {
  const out = applyPlacement(basis(n, inIdx), cell);
  for (let i = 0; i < out.length; i++) {
    const e = i === outIdx ? amp : { re: 0, im: 0 };
    assert.ok(approx(out[i].re, e.re) && approx(out[i].im, e.im),
      `in=${inIdx} idx ${i}: got (${out[i].re.toFixed(3)},${out[i].im.toFixed(3)}) want (${e.re},${e.im})`);
  }
}
const RE = (r) => ({ re: r, im: 0 });
const IM = (m) => ({ re: 0, im: m });
const rccx = { gate: "RCCX", targets: [0, 1, 2], controls: [], params: {} }; // ctrl q0,q1 / target q2

test("RCCX 기저 매핑 정확값 (controls q0,q1 / target q2)", () => {
  assertBasisMap(rccx, 3, 0b000, 0b000, RE(1));
  assertBasisMap(rccx, 3, 0b001, 0b001, RE(1));
  assertBasisMap(rccx, 3, 0b010, 0b010, RE(1));
  assertBasisMap(rccx, 3, 0b011, 0b111, IM(1));   // +i|111>
  assertBasisMap(rccx, 3, 0b100, 0b100, RE(1));
  assertBasisMap(rccx, 3, 0b101, 0b101, RE(-1));  // -1|101>
  assertBasisMap(rccx, 3, 0b110, 0b110, RE(1));
  assertBasisMap(rccx, 3, 0b111, 0b011, IM(-1));  // -i|011>
});

test("RC3X 기저 매핑 정확값 (controls q0,q1,q2 / target q3)", () => {
  const g = { gate: "RC3X", targets: [0, 1, 2, 3], controls: [], params: {} };
  const special = new Map([[0b0011, [0b0011, IM(1)]], [0b0111, [0b1111, RE(-1)]], [0b1011, [0b1011, IM(-1)]], [0b1111, [0b0111, RE(1)]]]);
  for (let i = 0; i < 16; i++) {
    const [outIdx, amp] = special.get(i) ?? [i, RE(1)];
    assertBasisMap(g, 4, i, outIdx, amp);
  }
});

test("RCCX 유니터리성: U†U = I", () => {
  // 열 = 각 기저에 RCCX 적용
  const U = [];
  for (let j = 0; j < 8; j++) U.push(applyPlacement(basis(3, j), rccx));
  // (U†U)_{jk} = Σ_i conj(U[i][j]) U[i][k]  (U[col][row])
  for (let j = 0; j < 8; j++) {
    for (let k = 0; k < 8; k++) {
      let re = 0, im = 0;
      for (let i = 0; i < 8; i++) {
        const a = U[j][i], b = U[k][i]; // conj(a)*b
        re += a.re * b.re + a.im * b.im;
        im += a.re * b.im - a.im * b.re;
      }
      assert.ok(approx(re, j === k ? 1 : 0) && approx(im, 0), `U†U[${j}][${k}]=(${re},${im})`);
    }
  }
});

test("RCCX ≠ CCX (회귀 방지)", () => {
  const ccx = { gate: "X", targets: [2], controls: [0, 1], params: {} };
  const a = applyPlacement(basis(3, 0b011), rccx); // +i|111>
  const b = applyPlacement(basis(3, 0b011), ccx);  // +1|111>
  assert.ok(!statesEqual(a, b), "RCCX가 CCX와 동일하게 동작함");
});

test("H⊗H⊗H 후 RCCX: 3개 진폭 위상이 π/2, π, 3π/2", () => {
  const H = matrixFor("H");
  let s = initialState(3);
  for (let q = 0; q < 3; q++) s = applyUnitary(s, q, H, []);
  s = applyPlacement(s, rccx);
  const phases = [];
  for (const amp of s) {
    if (approx(Math.hypot(amp.re, amp.im), 0)) continue;
    let p = Math.atan2(amp.im, amp.re);
    if (p < -1e-9) p += 2 * Math.PI; // 0..2π
    phases.push(p);
  }
  const near = (arr, v) => arr.filter((p) => approx(p, v)).length;
  assert.equal(near(phases, Math.PI / 2), 1);
  assert.equal(near(phases, Math.PI), 1);
  assert.equal(near(phases, 3 * Math.PI / 2), 1);
  assert.equal(near(phases, 0), 5); // 나머지 5개 위상 0
});

test("[6] 구 v1 URL의 RCCX가 고유 게이트로 복원 (ccx 아님)", () => {
  const oldJson = JSON.stringify({ v: 1, n: 3, p: [{ c: 0, q: 2, g: "RCCX", x: [0, 1] }] });
  const enc = btoa(oldJson).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const dec = decodeCircuit(enc);
  assert.ok(dec);
  const cell = dec.grid[0][0]; // home = targets[0] = control-a = q0
  assert.equal(cell.gate, "RCCX");
  assert.deepEqual(cell.targets, [0, 1, 2]);
  assert.deepEqual(cell.controls, []);
  // |011> 입력에서 RCCX 결과(+i|111>)가 CCX(+1|111>)와 달라야 함
  const out = applyPlacement(basis(3, 0b011), cell);
  assert.ok(approx(out[0b111].re, 0) && approx(out[0b111].im, 1));
});

test("[4] export: RCCX → rccx (ccx 아님)", () => {
  const grid = gridWith(3, [{ col: 0, row: 0, cell: { gate: "RCCX", targets: [0, 1, 2], controls: [], params: {} } }]);
  const qasm = toQASM(3, grid);
  assert.match(qasm, /^rccx q\[0\],q\[1\],q\[2\];$/m);
  assert.ok(!/ccx/.test(qasm.replace(/rccx/g, "")), "ccx로 잘못 출력됨");
  const qiskit = toQiskit(3, grid);
  assert.match(qiskit, /qc\.rccx\(0, 1, 2\)/);
});

// migrateGridForTest: 테스트 로컬 헬퍼 (circuit.js의 migrateCell을 그리드에 적용)
function migrateGridForTest(grid, n) {
  const MAX = grid.length;
  const out = Array.from({ length: MAX }, () => new Array(n).fill(null));
  for (let col = 0; col < MAX; col++) {
    for (let row = 0; row < n; row++) {
      const cell = grid[col][row];
      if (cell) out[col][row] = migrateCell(cell, row);
    }
  }
  return out;
}
