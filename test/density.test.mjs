// 축소 밀도행렬/순도 검증 ([4]의 명시된 케이스). 실행: node --test test/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { reducedDensityMatrix, purityFromRho, reducedDensityInfo } from "../js/density.js";

function st(...amps) {
  return amps.map((a) => (Array.isArray(a) ? { re: a[0], im: a[1] } : { re: a, im: 0 }));
}
const S = Math.SQRT1_2;
const approx = (a, b, e = 1e-9) => Math.abs(a - b) < e;
// rho ≈ diag(d0, d1) 이고 off-diagonal 0 인지
function assertDiag(rho, d0, d1) {
  assert.ok(approx(rho[0][0].re, d0) && approx(rho[0][0].im, 0), `rho00`);
  assert.ok(approx(rho[1][1].re, d1) && approx(rho[1][1].im, 0), `rho11`);
  assert.ok(approx(rho[0][1].re, 0) && approx(rho[0][1].im, 0), `rho01=0`);
  assert.ok(approx(rho[1][0].re, 0) && approx(rho[1][0].im, 0), `rho10=0`);
}

test("|00>: q0,q1 모두 rho=diag(1,0), Purity=1", () => {
  const s = st(1, 0, 0, 0);
  for (const q of [0, 1]) {
    assertDiag(reducedDensityMatrix(s, q), 1, 0);
    assert.ok(approx(purityFromRho(reducedDensityMatrix(s, q)), 1));
  }
});

test("Bell (|00>+|11>)/√2: q0,q1 모두 rho=diag(0.5,0.5), Purity=0.5", () => {
  const s = st(S, 0, 0, S);
  for (const q of [0, 1]) {
    assertDiag(reducedDensityMatrix(s, q), 0.5, 0.5);
    assert.ok(approx(purityFromRho(reducedDensityMatrix(s, q)), 0.5));
  }
});

test("(|00>+|01>)/√2: 곱상태 → q0,q1 모두 Purity=1", () => {
  const s = st(S, S, 0, 0);
  for (const q of [0, 1]) assert.ok(approx(purityFromRho(reducedDensityMatrix(s, q)), 1), `q${q}`);
});

test("GHZ 3큐비트 (|000>+|111>)/√2: 세 큐비트 모두 Purity=0.5", () => {
  const s = st(S, 0, 0, 0, 0, 0, 0, S);
  for (let q = 0; q < 3; q++) assert.ok(approx(purityFromRho(reducedDensityMatrix(s, q)), 0.5), `q${q}`);
});

test("|+i> = (|0>+i|1>)/√2: rho01 = -0.5i, r=(0,1,0)", () => {
  const s = st([S, 0], [0, S]);
  const info = reducedDensityInfo(s, 0);
  assert.ok(approx(info.rho[0][1].re, 0) && approx(info.rho[0][1].im, -0.5), "rho01=-0.5i");
  assert.ok(approx(info.rho[1][0].re, 0) && approx(info.rho[1][0].im, 0.5), "rho10=conj=+0.5i");
  assert.ok(approx(info.bloch.x, 0) && approx(info.bloch.y, 1) && approx(info.bloch.z, 0), "r=(0,1,0)");
  assert.ok(approx(info.purity, 1));
});

test("reducedDensityInfo: mixedness = 2(1−purity), Bell이면 100%", () => {
  const bell = reducedDensityInfo(st(S, 0, 0, S), 0);
  assert.ok(approx(bell.purity, 0.5));
  assert.ok(approx(bell.mixedness, 1)); // 2*(1-0.5)=1 → 100%
  assert.ok(approx(bell.r, 0));
  const pure = reducedDensityInfo(st(1, 0, 0, 0), 0);
  assert.ok(approx(pure.mixedness, 0)); // 2*(1-1)=0
});

test("모든 경우 0.5 ≤ Purity ≤ 1 (임의 상태 포함)", () => {
  const rng = (() => { let s = 999; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
  for (let t = 0; t < 30; t++) {
    const n = 2 + (t % 3);
    const dim = 1 << n;
    const raw = Array.from({ length: dim }, () => ({ re: rng() * 2 - 1, im: rng() * 2 - 1 }));
    const norm = Math.sqrt(raw.reduce((a, c) => a + c.re * c.re + c.im * c.im, 0));
    const s = raw.map((c) => ({ re: c.re / norm, im: c.im / norm }));
    for (let q = 0; q < n; q++) {
      const p = purityFromRho(reducedDensityMatrix(s, q));
      assert.ok(p >= 0.5 - 1e-9 && p <= 1 + 1e-9, `t${t} q${q} purity=${p}`);
    }
  }
});
