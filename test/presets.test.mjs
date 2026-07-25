// [4] 프리셋 검증: 각 프리셋 문자열을 디코드→simulate 해 상태벡터가 기대값과 일치하는지.
// 프리셋 회로가 잘못 인코딩되면 조용히 틀린 상태가 나오므로 반드시 자동 검증한다.
// 실행: node --test test/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { PRESETS } from "../js/presets.js";
import { decodeCircuit } from "../js/export.js";
import { simulate } from "../js/circuit.js";

const byName = (n) => PRESETS.find((p) => p.name === n);
const mag2 = (z) => z.re * z.re + z.im * z.im;
const near = (a, b, e = 1e-4) => Math.abs(a - b) < e;
function loadState(preset) {
  const dec = decodeCircuit(preset.circuit);
  assert.ok(dec, `${preset.name}: decode 실패`);
  return { dec, st: simulate(dec.qubitCount, dec.grid) };
}
// 지정한 index만 값 amp(복소), 나머지 0
function assertOnly(st, expected) {
  const set = new Map(expected.map((e) => [e.i, e]));
  for (let i = 0; i < st.length; i++) {
    const e = set.get(i);
    if (e) assert.ok(near(st[i].re, e.re) && near(st[i].im, e.im ?? 0), `${i}: (${st[i].re.toFixed(4)},${st[i].im.toFixed(4)})`);
    else assert.ok(near(mag2(st[i]), 0), `idx ${i} 비영: ${mag2(st[i]).toFixed(6)}`);
  }
}
const S = Math.SQRT1_2;
const inv3 = 1 / Math.sqrt(3);

test("모든 프리셋: 정규화(합=1) + 큐비트수 필드 일치", () => {
  for (const p of PRESETS) {
    const { dec, st } = loadState(p);
    assert.equal(dec.qubitCount, p.qubits, `${p.name} qubits`);
    const total = st.reduce((a, z) => a + mag2(z), 0);
    assert.ok(near(total, 1, 1e-6), `${p.name} norm=${total}`);
  }
});

test("Bell (Φ+): (|00⟩+|11⟩)/√2", () => {
  const { st, dec } = loadState(byName("Bell state (Φ+)"));
  assert.equal(dec.qubitCount, 2);
  assertOnly(st, [{ i: 0, re: S }, { i: 3, re: S }]);
});

test("GHZ: (|000⟩+|111⟩)/√2", () => {
  const { st } = loadState(byName("GHZ state"));
  assertOnly(st, [{ i: 0, re: S }, { i: 7, re: S }]);
});

test("W: (|001⟩+|010⟩+|100⟩)/√3 (idx 1,2,4 각 1/√3)", () => {
  const { st } = loadState(byName("W state"));
  assertOnly(st, [{ i: 1, re: inv3 }, { i: 2, re: inv3 }, { i: 4, re: inv3 }]);
});

test("Phase kickback: (|00⟩−|01⟩−|10⟩+|11⟩)/2 (q0가 |+⟩→|−⟩)", () => {
  const { st } = loadState(byName("Phase kickback"));
  assertOnly(st, [{ i: 0, re: 0.5 }, { i: 1, re: -0.5 }, { i: 2, re: -0.5 }, { i: 3, re: 0.5 }]);
});

test("Deutsch–Jozsa (balanced): 입력 q0,q1이 |11⟩로 확정", () => {
  const { st } = loadState(byName("Deutsch–Jozsa"));
  let pIn11 = 0, pOther = 0;
  for (let i = 0; i < st.length; i++) {
    const q0 = i & 1, q1 = (i >> 1) & 1;
    if (q0 === 1 && q1 === 1) pIn11 += mag2(st[i]); else pOther += mag2(st[i]);
  }
  assert.ok(near(pIn11, 1, 1e-6), `pIn11=${pIn11}`);
  assert.ok(near(pOther, 0, 1e-6), `pOther=${pOther}`);
});

test("QFT: QFT|000⟩ = 균등 중첩(8개 모두 1/√8 실수)", () => {
  const { st } = loadState(byName("Quantum Fourier Transform"));
  const u = 1 / Math.sqrt(8);
  for (let k = 0; k < 8; k++) {
    assert.ok(near(st[k].re, u) && near(st[k].im, 0), `k=${k}: (${st[k].re.toFixed(4)},${st[k].im.toFixed(4)})`);
  }
});
