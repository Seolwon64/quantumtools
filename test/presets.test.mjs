// [4] 프리셋 검증: 각 프리셋 문자열을 디코드→simulate 해 상태벡터가 기대값과 일치하는지.
// 프리셋 회로가 잘못 인코딩되면 조용히 틀린 상태가 나오므로 반드시 자동 검증한다.
// 실행: node --test test/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { PRESETS, PRESET_CATEGORIES } from "../js/presets.js";
import { decodeCircuit } from "../js/export.js";
import { simulate } from "../js/circuit.js";
import { reducedDensityInfo } from "../js/density.js";

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

// 입력 레지스터 비트 조건이 확정(prob 1)인지 검사 (측정 대상 큐비트가 정해진 값)
function assertInputRegister(st, bits) {
  let pMatch = 0, pOther = 0;
  for (let i = 0; i < st.length; i++) {
    const ok = Object.entries(bits).every(([q, v]) => ((i >> Number(q)) & 1) === v);
    (ok ? (pMatch += mag2(st[i])) : (pOther += mag2(st[i])));
  }
  assert.ok(near(pMatch, 1, 1e-6) && near(pOther, 0, 1e-6), `match=${pMatch.toFixed(4)} other=${pOther.toFixed(4)}`);
}

test("Deutsch–Jozsa (balanced): 입력 q0,q1이 |11⟩로 확정", () => {
  assertInputRegister(loadState(byName("Deutsch–Jozsa (balanced)")).st, { 0: 1, 1: 1 });
});

test("Deutsch–Jozsa (constant): 입력 q0,q1이 |00⟩로 확정", () => {
  assertInputRegister(loadState(byName("Deutsch–Jozsa (constant)")).st, { 0: 0, 1: 0 });
});

test("Bernstein–Vazirani: 비밀 s=101 → 입력 q0=1,q1=0,q2=1 확정", () => {
  const { dec, st } = loadState(byName("Bernstein–Vazirani"));
  assert.equal(dec.qubitCount, 4);
  assertInputRegister(st, { 0: 1, 1: 0, 2: 1 });
});

test("Grover search (2q): |11⟩ 진폭이 −1 (부호까지)", () => {
  // 확률만 보면 위상이 틀려도 통과한다. 실제로 이 회로의 진폭은 **음수**(위상 π)다 —
  // 오라클의 부호 반전 + 확산 연산자의 결과이므로 부호가 곧 알고리즘의 증거다.
  const { st } = loadState(byName("Grover search"));
  assertOnly(st, [{ i: 3, re: -1 }]);
});

test("Superdense coding (11): 디코드 결과 |11⟩ 확정(+1)", () => {
  const { st } = loadState(byName("Superdense coding"));
  assertOnly(st, [{ i: 3, re: 1 }]);
});

test("Quantum teleportation: q0의 상태가 q2로 이동(coherent)", () => {
  // q0 = T·H|0> = (|0>+e^{iπ/4}|1>)/√2 → bloch (√2/2, √2/2, 0), 순수
  const { st } = loadState(byName("Quantum teleportation"));
  const info = reducedDensityInfo(st, 2);
  assert.ok(near(info.bloch.x, S) && near(info.bloch.y, S) && near(info.bloch.z, 0), `q2 bloch=(${info.bloch.x.toFixed(3)},${info.bloch.y.toFixed(3)},${info.bloch.z.toFixed(3)})`);
  // 세 큐비트가 모두 순수해야 한다 — 하나라도 섞여 있으면 얽힘이 남았다는 뜻이고,
  // 그건 텔레포테이션이 끝나지 않았다(보정이 빠졌다)는 신호다.
  for (const q of [0, 1, 2]) {
    assert.ok(near(reducedDensityInfo(st, q).purity, 1), `q${q} purity=${reducedDensityInfo(st, q).purity}`);
  }
});

test("모든 프리셋 category가 PRESET_CATEGORIES에 속함", () => {
  for (const p of PRESETS) assert.ok(PRESET_CATEGORIES.includes(p.category), `${p.name}: ${p.category}`);
});

test("QFT|001⟩: 크기는 모두 1/√8, 위상은 k·π/4 로 균등 증가", () => {
  // QFT|j⟩ = (1/√8) Σ_k e^{2πijk/8}|k⟩ 이므로 j=1 이면 위상이 k·π/4 씩 돈다.
  // |000⟩ 입력이면 위상이 전부 0이라 H⊗H⊗H 와 구별되지 않는다 — QFT 의 핵심이 안 보인다.
  // 그래서 프리셋이 앞에 X 를 두어 |001⟩ 을 넣는다. 이 테스트가 그 전제를 고정한다.
  const { st } = loadState(byName("Quantum Fourier Transform"));
  const u = 1 / Math.sqrt(8);
  for (let k = 0; k < 8; k++) {
    const mag = Math.sqrt(mag2(st[k]));
    assert.ok(near(mag, u), `k=${k}: |a|=${mag.toFixed(4)} (기대 ${u.toFixed(4)})`);
    // 위상은 2π 주기이고 atan2 는 −π 와 π 를 같은 점으로 보지 않는다(k=4 가 그 경계다).
    // 그래서 값을 접지 말고 **차이**를 (−π, π] 로 접어 0 에 가까운지 본다.
    const got = Math.atan2(st[k].im, st[k].re);
    let diff = (got - (k * Math.PI) / 4) % (2 * Math.PI);
    if (diff > Math.PI) diff -= 2 * Math.PI;
    if (diff < -Math.PI) diff += 2 * Math.PI;
    assert.ok(near(diff, 0), `k=${k}: arg=${(got / Math.PI).toFixed(3)}π (기대 ${(k / 4).toFixed(2)}π, 차이 ${(diff / Math.PI).toFixed(4)}π)`);
  }
});

test("W state: 첫 RY 각도가 2·arccos(1/√3) — 어림값(90°·120°)이면 33.3%가 안 나온다", () => {
  // 두 번째 RY 가 π/2(90°)인 것은 어림값이 아니라 설계상 정확한 값이다:
  //   RY(2·arccos(1/√3)) 이 √(1/3) : √(2/3) 으로 가르고,
  //   이어지는 controlled-RY(π/2) 가 남은 2/3 을 정확히 반씩 나눈다.
  // 진폭이 정확히 1/√3 씩 나오는 것으로 확인된다(위 테스트).
  const dec = decodeCircuit(byName("W state").circuit);
  const rys = dec.grid.flat().filter((c) => c && c.gate === "RY");
  assert.equal(rys.length, 2, `RY 가 ${rys.length}개 — 구성이 바뀌었다`);
  const want = 2 * Math.acos(1 / Math.sqrt(3));
  assert.ok(Math.abs(rys[0].params.theta - want) < 1e-5,
    `첫 RY=${rys[0].params.theta} (기대 ${want.toFixed(6)}, 109.47°)`);
  assert.ok(Math.abs(rys[1].params.theta - Math.PI / 2) < 1e-5,
    `둘째 RY=${rys[1].params.theta} (기대 π/2)`);
});

test("Superdense coding: 네 메시지가 각각 다른 기저 상태 100%", () => {
  // 프리셋은 메시지 하나("11")만 담는다. 프로토콜의 핵심은 **네 메시지가 구분된다**는 것이므로
  // 인코딩 게이트만 바꿔 네 회로를 만들어 확인한다(프리셋 목록은 그대로 둔다).
  const dec = decodeCircuit(byName("Superdense coding").circuit);
  // 프리셋 회로: H q0 · CX(q0→q1) · [X q0] · [Z q0] · CX(q0→q1) · H q0
  // 가운데 두 열이 인코딩이다. 그 자리에 I/X/Z/XZ 를 넣어 본다.
  const encodeCols = dec.grid
    .map((col, i) => ({ i, cell: col[0] }))
    .filter(({ cell }) => cell && (cell.gate === "X" || cell.gate === "Z") && !(cell.controls ?? []).length)
    .map(({ i }) => i);
  assert.equal(encodeCols.length, 2, `인코딩 열이 ${encodeCols.length}개 — 회로 구성이 바뀌었다`);

  // 어느 파울리가 어느 비트열로 읽히는지는 표기 규약(엔디언·측정 순서)에 달렸다.
  // 규약을 테스트에 박아 넣지 않고, 프로토콜이 실제로 주장하는 것만 검사한다:
  // **네 인코딩이 서로 다른 기저 상태에 100% 로 떨어진다.**
  const outcomes = new Map();
  for (const gates of [[], ["X"], ["Z"], ["X", "Z"]]) {
    const label = gates.length ? gates.join("·") : "I";
    const grid = dec.grid.map((col) => [...col]);
    encodeCols.forEach((col, k) => {
      grid[col][0] = gates[k]
        ? { gate: gates[k], targets: [0], controls: [], params: {} }
        : null;
    });
    const st = simulate(dec.qubitCount, grid);
    const hits = st.map((z, i) => ({ i, p: mag2(z) })).filter((x) => x.p > 1e-9);
    assert.equal(hits.length, 1, `${label}: 확정 상태가 아니다 (비영 ${hits.length}개)`);
    assert.ok(near(hits[0].p, 1, 1e-6), `${label}: 확률 ${hits[0].p.toFixed(4)}`);
    outcomes.set(label, hits[0].i);
  }
  assert.equal(
    new Set(outcomes.values()).size,
    4,
    `네 메시지가 겹친다: ${[...outcomes].map(([k, v]) => `${k}→|${v.toString(2).padStart(2, "0")}⟩`).join(", ")}`
  );
});
