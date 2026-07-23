// 축소 밀도행렬 기반 블로흐 벡터 검증. [2]의 명시된 케이스가 통과해야 구현이 옳다.
// 실행: node --test test/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { qubitBlochVector } from "../js/quantum.js";

// 진폭 리스트 → 상태벡터. 항목은 숫자(실수) 또는 [re, im].
function st(...amps) {
  return amps.map((a) => (Array.isArray(a) ? { re: a[0], im: a[1] } : { re: a, im: 0 }));
}
const rlen = (v) => Math.hypot(v.x, v.y, v.z);
function approxVec(v, x, y, z, eps = 1e-9) {
  assert.ok(Math.abs(v.x - x) < eps && Math.abs(v.y - y) < eps && Math.abs(v.z - z) < eps,
    `got (${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)}) want (${x}, ${y}, ${z})`);
}
const S = Math.SQRT1_2; // 1/√2

test("|00>: q0,q1 모두 r=(0,0,1), |r|=1", () => {
  const s = st(1, 0, 0, 0);
  approxVec(qubitBlochVector(s, 0), 0, 0, 1);
  approxVec(qubitBlochVector(s, 1), 0, 0, 1);
  assert.ok(Math.abs(rlen(qubitBlochVector(s, 0)) - 1) < 1e-9);
});

test("|+i> = (|0>+i|1>)/√2 : r=(0,1,0) (부호 규약)", () => {
  const s = st([S, 0], [0, S]); // 단일 큐비트
  approxVec(qubitBlochVector(s, 0), 0, 1, 0);
});

test("Bell (|00>+|11>)/√2 : q0,q1 모두 r=(0,0,0), |r|=0", () => {
  const s = st(S, 0, 0, S);
  approxVec(qubitBlochVector(s, 0), 0, 0, 0);
  approxVec(qubitBlochVector(s, 1), 0, 0, 0);
  assert.ok(rlen(qubitBlochVector(s, 0)) < 1e-9);
});

test("(|00>+|01>)/√2 : 곱상태 → q0,q1 모두 |r|=1", () => {
  const s = st(S, S, 0, 0);
  assert.ok(Math.abs(rlen(qubitBlochVector(s, 0)) - 1) < 1e-9);
  assert.ok(Math.abs(rlen(qubitBlochVector(s, 1)) - 1) < 1e-9);
});

test("cos(t)|00> + sin(t)|11> : 두 큐비트 모두 |r|=|cos(2t)|", () => {
  for (const t of [0, 0.3, Math.PI / 8, Math.PI / 4, 1.1]) {
    const s = st(Math.cos(t), 0, 0, Math.sin(t));
    const want = Math.abs(Math.cos(2 * t));
    assert.ok(Math.abs(rlen(qubitBlochVector(s, 0)) - want) < 1e-9, `t=${t} q0`);
    assert.ok(Math.abs(rlen(qubitBlochVector(s, 1)) - want) < 1e-9, `t=${t} q1`);
  }
});

test("GHZ 3큐비트 (|000>+|111>)/√2 : 세 큐비트 모두 |r|=0", () => {
  const s = st(S, 0, 0, 0, 0, 0, 0, S);
  for (let q = 0; q < 3; q++) assert.ok(rlen(qubitBlochVector(s, q)) < 1e-9, `q${q}`);
});

test("모든 경우 |r| <= 1 (임의 상태 포함)", () => {
  // 고정 + 무작위 정규화 상태에서 각 큐비트 |r| ≤ 1
  const rng = (() => { let s = 12345; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
  for (let trial = 0; trial < 30; trial++) {
    const n = 2 + (trial % 3); // 2~4 큐비트
    const dim = 1 << n;
    const raw = Array.from({ length: dim }, () => ({ re: rng() * 2 - 1, im: rng() * 2 - 1 }));
    const norm = Math.sqrt(raw.reduce((a, c) => a + c.re * c.re + c.im * c.im, 0));
    const s = raw.map((c) => ({ re: c.re / norm, im: c.im / norm }));
    for (let q = 0; q < n; q++) {
      assert.ok(rlen(qubitBlochVector(s, q)) <= 1 + 1e-9, `trial ${trial} q${q}`);
    }
  }
});
