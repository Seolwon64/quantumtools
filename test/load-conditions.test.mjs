// 저장 회로 · 공유 링크의 조건 붙은 측정 · 리셋이 적재 때 말없이 사라지지 않는다.
//
// 2026-08-07 ~ 2026-10-18 판의 QASM 가져오기는 아무 게이트에나 `if (c==1)` 을 받았고, 그 회로가 `bloch-composer-v1` 에 저장되거나
// 공유 링크(`ci`)로 나갔다. 2026-10-18 부터 조건 규칙(canCondition)이 측정 · 리셋을 막자, 그런 칸은 적재 때 말없이 빠졌고 생성 끝의
// notify 가 곧바로 저장해 원본까지 덮었다(데이터 손실). 공유 링크는 링크 전체가 거부됐다. 지금은 측정 · 리셋의 조건을 받고(궤적이
// 정확히 돌린다), 배리어 · RCCX/RC3X 의 조건은 떼고 알리며, 첫 편집까지 원본을 남긴다.
//
// 아래 STORED · LINK 는 그 판(a433fbf)의 코드 경로(parseQASM → loadCircuit → save, encodeCircuit)로 만든 실제 문자열이다.
import test from "node:test";
import assert from "node:assert/strict";

import { createCircuitController, normalizeLoaded, loadNoticeText, simulate, MAX_COLUMNS } from "../js/circuit.js";
import { parseShareHash, encodeCircuit, decodeCircuit, toQASM, toQiskit } from "../js/export.js";
import { parseQASM } from "../js/qasm.js";
import { resolveDeferred } from "../js/classical.js";
import { runTrajectory } from "../js/trajectory.js";

const STORAGE_KEY = "bloch-composer-v1";

// 예전 판이 저장한 값. 원문 QASM:
//   h q[0]; x q[1]; x q[2]; measure q[0] -> c[0];
//   if (c==1) reset q[1]; if (c==1) measure q[2] -> c[1]; if (c==1) barrier q[0]; if (c==1) rccx q[0],q[1],q[2];
const STORED = `{"qubitCount":3,"clbitCount":2,"grid":[[{"gate":"H","targets":[0],"controls":[],"params":{}},{"gate":"X","targets":[1],"controls":[],"params":{}},{"gate":"X","targets":[2],"controls":[],"params":{}}],[{"gate":"MEASURE","targets":[0],"controls":[],"params":{"cbit":0}},null,null],[{"gate":"BARRIER","targets":[0],"controls":[],"params":{"cif":0}},{"gate":"RESET","targets":[1],"controls":[],"params":{"cif":0}},{"gate":"MEASURE","targets":[2],"controls":[],"params":{"cbit":1,"cif":0}}],[{"gate":"RCCX","targets":[0,1,2],"controls":[],"params":{"cif":0}},null,null],[null,null,null],[null,null,null],[null,null,null],[null,null,null],[null,null,null],[null,null,null],[null,null,null],[null,null,null]]}`;

// 예전 판이 만든 공유 링크. 원문 QASM(qreg q[4]; creg c[1];):
//   x q[1]; h q[0]; measure q[0] -> c[0]; if (c==1) reset q[0]; if (c==1) measure q[1] -> c[0]; if (c==1) rc3x q[0],q[1],q[2],q[3];
const LINK = "#c=eyJ2IjoyLCJuIjo0LCJwIjpbeyJjIjowLCJnIjoiSCIsInRnIjpbMF19LHsiYyI6MCwiZyI6IlgiLCJ0ZyI6WzFdfSx7ImMiOjEsImciOiJNRUFTVVJFIiwidGciOlswXSwicCI6eyJjYiI6MH19LHsiYyI6MiwiZyI6IlJFU0VUIiwidGciOlswXSwicCI6eyJjaSI6MH19LHsiYyI6MiwiZyI6Ik1FQVNVUkUiLCJ0ZyI6WzFdLCJwIjp7ImNiIjowLCJjaSI6MH19LHsiYyI6MywiZyI6IlJDM1giLCJ0ZyI6WzAsMSwyLDNdLCJwIjp7ImNpIjowfX1dLCJjIjoxfQ";

// ---------- 가짜 localStorage — setItem 을 센다 ----------

function withStorage(initial, fn) {
  const store = new Map(Object.entries(initial));
  const writes = [];
  const had = Object.prototype.hasOwnProperty.call(globalThis, "localStorage");
  const before = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { writes.push(k); store.set(k, String(v)); },
    removeItem: (k) => store.delete(k),
  };
  try {
    return fn({ store, writes: () => writes.filter((k) => k === STORAGE_KEY).length });
  } finally {
    if (had) globalThis.localStorage = before; else delete globalThis.localStorage;
  }
}

const controller = (initial) => createCircuitController({ onChange: () => {}, onAnimateStep: async () => {}, initial });

/** 스냅숏의 회로를 저장값 모양으로 — save 가 쓰는 JSON 과 비교한다. */
const savedShape = (s) => JSON.parse(JSON.stringify({ qubitCount: s.qubitCount, clbitCount: s.clbitCount, grid: s.grid }));

// ---------- 정확한 앙상블 — 측정 · 리셋의 갈래를 모두 펼친다 ----------

// runTrajectory 는 k 번째 난수 소비(측정 · 리셋)에 k 번째 값을 쓰고 `값 < p1` 이면 결과 1 이다. 0 을 주면 1, 1 − 2⁻⁵³ 를 주면 0 을 강제한다.
// 조건이 거짓이라 건너뛴 측정 · 리셋은 난수를 쓰지 않으므로, 갈래 길이는 돌려받은 measurements 로 정한다(접두사를 늘려 다시 돈다).
const FORCE_ONE = 0;
const FORCE_ZERO = 1 - 2 ** -53;
const EPS = 1e-12;

function exactEnsemble(qubitCount, clbitCount, grid) {
  const probs = new Array(1 << qubitCount).fill(0);
  const classical = new Map();
  const leaves = [];
  (function walk(prefix) {
    let k = 0;
    const r = runTrajectory(qubitCount, clbitCount, grid, undefined, () => (prefix[k++] === 1 ? FORCE_ONE : FORCE_ZERO));
    if (r.measurements.length > prefix.length) { walk([...prefix, 0]); walk([...prefix, 1]); return; }
    let w = 1;
    for (let i = 0; i < prefix.length; i++) {
      const m = r.measurements[i];
      const pWanted = prefix[i] ? m.p1 : 1 - m.p1;
      // 강제한 결과와 다르게 나왔다면 그 결과는 일어날 수 없는 것이어야 한다 — 아니면 강제 장치가 틀렸다.
      if (m.outcome !== prefix[i]) {
        assert.ok(pWanted <= EPS, `갈래 ${prefix.join("")} 의 ${i} 번째 붕괴: 결과 ${prefix[i]} 을 강제했는데 ${m.outcome} 이 나왔다(확률 ${pWanted})`);
        return;
      }
      w *= pWanted;
    }
    if (w <= EPS) return;
    leaves.push({ w, state: r.state, clbits: r.clbits });
    r.state.forEach((z, i) => { probs[i] += w * (z.re * z.re + z.im * z.im); });
    const key = r.clbits.join("");
    classical.set(key, (classical.get(key) ?? 0) + w);
  })([]);
  const total = leaves.reduce((s, l) => s + l.w, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `갈래 확률의 합이 ${total} 이다`);
  return { probs, classical, leaves };
}

const pOne = (probs, q) => probs.reduce((s, p, i) => s + ((i >> q) & 1 ? p : 0), 0);

function assertClassical(label, got, want) {
  for (const key of new Set([...got.keys(), ...Object.keys(want)])) {
    const g = got.get(key) ?? 0, w = want[key] ?? 0;
    assert.ok(Math.abs(g - w) < 1e-9, `${label}: 고전 비트 ${key} 확률 ${g} — ${w} 이어야 한다`);
  }
}

// ---------- 앱이 만든 회로 ----------

function appCircuit(qubitCount, clbitCount, build) {
  const ctl = controller({ qubitCount, clbitCount, grid: Array.from({ length: MAX_COLUMNS }, () => new Array(qubitCount).fill(null)) });
  const at = (col, q) => ctl.getSnapshot().grid[col][q];
  build({
    gate(col, q, name) {
      ctl.placeGate(col, q, name);
      assert.equal(at(col, q)?.gate, name, `전제: 열 ${col} q${q} 에 ${name} 를 놓지 못했다`);
    },
    measure(col, q, bit) {
      ctl.placeGate(col, q, "MEASURE");
      assert.equal(ctl.setClassicalBit(col, q, bit).ok, true, `전제: 열 ${col} q${q} 측정을 c${bit} 에 쓰지 못했다`);
    },
    cond(col, q, bit) {
      const r = ctl.setCondition(col, q, bit);
      assert.equal(r.ok, true, `전제: 열 ${col} q${q} 에 조건 c${bit} 를 붙이지 못했다 — ${r.reason}`);
    },
  });
  return ctl.getSnapshot();
}

// 경계 경우. 모두 화면 메뉴(setCondition)로 만들 수 있다 — 측정 · 리셋의 조건이 UI 로 열렸다.
const EDGE = {
  // (a) 자기가 읽는 비트에 결과를 쓴다: if (c0==1) measure q1 -> c0. 조건은 측정 **전** 의 c0 을 읽는다.
  //     c0=0(½) 이면 건너뛰어 q1 이 |+⟩ 로 남고 뒤의 H 가 |0⟩ 으로 돌린다. c0=1(½) 이면 q1 을 재서 c0 을 덮는다(½ · ½).
  //     → P(c0=1) = ¼, P(q1=1) = ¼. 조건을 무시하면 둘 다 ½ 이다.
  a: () => appCircuit(2, 1, (o) => {
    o.gate(0, 0, "H"); o.gate(0, 1, "H"); o.measure(1, 0, 0);
    o.measure(2, 1, 0); o.cond(2, 1, 0); o.gate(3, 1, "H");
  }),
  // (b1) 같은 열, 쓰는 측정이 위 행: 열은 홈 행 순서로 돈다 — 아래 행의 조건은 **방금 쓴** 값을 읽는다.
  //      X q0 → c0=1 → q1 을 재서 c1 에 쓴다 → P(c1=1) = ½, 뒤의 H 뒤 P(q1=1) = ½. 열 시작 값을 읽으면 둘 다 0 이다.
  b1: () => appCircuit(3, 2, (o) => {
    o.gate(0, 0, "X"); o.gate(0, 1, "H");
    o.measure(1, 0, 0); o.measure(1, 1, 1); o.cond(1, 1, 0); o.gate(2, 1, "H");
  }),
  // (b2) 같은 열, 쓰는 측정이 아래 행: 위 행의 조건은 **옛** 값(0)을 읽어 건너뛴다 → P(c1=1) = 0, H 뒤 P(q0=1) = 0.
  //      열 전체의 쓰기를 먼저 반영하면 둘 다 ½ 이다.
  b2: () => appCircuit(3, 2, (o) => {
    o.gate(0, 0, "H"); o.gate(0, 1, "X");
    o.measure(1, 0, 1); o.cond(1, 0, 0); o.measure(1, 1, 0); o.gate(2, 0, "H");
  }),
  // (c) 조건부 리셋: c0=1 일 때만 q1 을 |0⟩ 으로. X q1 이라 P(q1=1) = ½. 무조건 리셋이면 0, 리셋을 버리면 1 이다.
  c: () => appCircuit(2, 1, (o) => {
    o.gate(0, 0, "H"); o.gate(0, 1, "X"); o.measure(1, 0, 0);
    o.gate(2, 1, "RESET"); o.cond(2, 1, 0);
  }),
};

// ---------- 실제 직렬화 문자열 ----------

test("예전 판이 저장한 조건부 측정 · 리셋은 조건째 실리고, 배리어 · RCCX 는 조건만 떼고 무엇을 뗐는지 알린다", () => {
  withStorage({ [STORAGE_KEY]: STORED }, ({ store, writes }) => {
    const s = controller().getSnapshot();
    assert.deepEqual(s.grid[2][1], { gate: "RESET", targets: [1], controls: [], params: { cif: 0 } }, "조건 붙은 리셋이 조건째 실리지 않았다");
    assert.deepEqual(s.grid[2][2], { gate: "MEASURE", targets: [2], controls: [], params: { cbit: 1, cif: 0 } }, "조건 붙은 측정이 조건째 실리지 않았다");
    assert.deepEqual(s.grid[2][0], { gate: "BARRIER", targets: [0], controls: [], params: {} }, "배리어가 빠졌거나 조건이 남았다");
    assert.deepEqual(s.grid[3][0], { gate: "RCCX", targets: [0, 1, 2], controls: [], params: {} }, "RCCX 가 빠졌거나 조건이 남았다");
    assert.deepEqual(s.loadNotices, [
      { kind: "condition", column: 3, gate: "BARRIER", bit: 0 },
      { kind: "condition", column: 4, gate: "RCCX", bit: 0 },
    ]);
    // 화면과 같은 말 — 게이트는 팔레트 툴팁의 이름(배리어 칩은 ⋮ 라 이름이 아니다), 비트는 배지 툴팁의 c[k], 열은 1부터(열 3 = 왼쪽에서 셋째).
    assert.equal(loadNoticeText(s.loadNotices),
      "Opened with changes — removed the condition from Barrier in column 3 (only when c[0] is 1), " +
      "RCCX in column 4 (only when c[0] is 1). The original stays saved until you edit.");
    // 원본 보존: 생성 끝의 notify 가 저장하지 않는다.
    assert.equal(s.preservingSource, true);
    assert.equal(writes(), 0, "적재만 했는데 저장값을 덮어썼다");
    assert.equal(store.get(STORAGE_KEY), STORED);
    // 실린 회로는 조건대로 돈다 — c0=1 갈래만 q1 을 리셋하고 q2 를 c1 에 잰다. (조건을 버리면 고전 비트에 "01" 이 생긴다.)
    const e = exactEnsemble(s.qubitCount, s.clbitCount, s.grid);
    assertClassical("저장 회로", e.classical, { "11": 0.5, "00": 0.5 });
    assert.ok(Math.abs(e.probs[0b101] - 0.5) < 1e-9 && Math.abs(e.probs[0b110] - 0.5) < 1e-9, `기저 확률 ${e.probs.map((p) => p.toFixed(3))}`);
  });
});

test("예전 공유 링크의 조건부 측정 · 리셋은 링크째 열린다 — RC3X 는 조건만 떼고 알리며, 첫 편집 전에는 내 저장 회로를 덮지 않는다", () => {
  const mine = JSON.stringify({ qubitCount: 2, clbitCount: 2, grid: Array.from({ length: MAX_COLUMNS }, (_, c) => (c === 0 ? [{ gate: "H", targets: [0], controls: [], params: {} }, null] : [null, null])) });
  withStorage({ [STORAGE_KEY]: mine }, ({ store, writes }) => {
    const shared = parseShareHash(LINK);
    assert.ok(shared, "예전 링크를 열지 못했다(링크 전체 거부)");
    const s = controller(shared).getSnapshot();
    assert.equal(s.qubitCount, 4);
    assert.deepEqual(s.grid[2][0].params, { cif: 0 }, "조건 붙은 리셋");
    assert.deepEqual(s.grid[2][1].params, { cbit: 0, cif: 0 }, "자기 비트를 읽고 쓰는 조건부 측정");
    assert.deepEqual(s.grid[3][0], { gate: "RC3X", targets: [0, 1, 2, 3], controls: [], params: {} });
    assert.deepEqual(s.loadNotices, [{ kind: "condition", column: 4, gate: "RC3X", bit: 0 }]);
    assert.match(loadNoticeText(s.loadNotices), /^Opened with changes — removed the condition from RC3X in column 4 \(only when c\[0\] is 1\)\. /);
    assert.equal(s.preservingSource, true);
    assert.equal(writes(), 0, "링크를 열기만 했는데 내 저장 회로를 덮어썼다");
    assert.equal(store.get(STORAGE_KEY), mine);
    // c0=1 갈래: q0 리셋 → q1(=1) 을 재 c0 = 1. c0=0 갈래: 둘 다 건너뛴다. 조건을 버리면 c0 이 늘 1 이다.
    const e = exactEnsemble(s.qubitCount, s.clbitCount, s.grid);
    assertClassical("링크 회로", e.classical, { 1: 0.5, 0: 0.5 });
    assert.ok(Math.abs(e.probs[0b0010] - 1) < 1e-9, `기저 확률 ${e.probs.map((p) => p.toFixed(3))}`);
  });
});

test("편집 전에 다시 열면 같은 알림이 다시 뜨고, 첫 편집이 고친 회로를 저장하면 다음부터는 뜨지 않는다", () => {
  withStorage({ [STORAGE_KEY]: STORED }, ({ store, writes }) => {
    const first = controller().getSnapshot().loadNotices;
    const again = controller();
    assert.deepEqual(again.getSnapshot().loadNotices, first, "원본이 남아 있는데 다시 연 알림이 다르다");
    again.placeGate(6, 0, "H");
    assert.equal(writes(), 1);
    assert.notEqual(store.get(STORAGE_KEY), STORED);
    const later = controller().getSnapshot();
    assert.deepEqual(later.loadNotices, [], "고친 회로를 저장했는데 다시 알린다");
    assert.equal(later.preservingSource, false);
    // 저장된 것은 고친 회로 + 편집이다 — 조건부 측정 · 리셋은 그대로, 배리어 · RCCX 의 조건만 없다.
    assert.deepEqual(later.grid[2][1].params, { cif: 0 });
    assert.deepEqual(later.grid[2][2].params, { cbit: 1, cif: 0 });
    assert.deepEqual(later.grid[2][0].params, {});
    assert.equal(later.grid[6][0].gate, "H");
  });
});

test("읽지 못한 칸은 사유와 함께 빠지고 알림에 실린다 — 저장값 · 공유 링크 어느 쪽도 말없이 사라지지 않는다", () => {
  // 저장값: 모르는 게이트, 큐비트 범위 밖, 측정에 붙은 제어, 12열 밖. 행 길이가 큐비트 수보다 긴 칸도 센다.
  const row = (...cells) => cells;
  const stored = {
    qubitCount: 2, clbitCount: 1,
    grid: [
      row({ gate: "FOO", targets: [0], controls: [], params: {} }, { gate: "H", targets: [1], controls: [], params: {} }),
      row({ gate: "X", targets: [0], controls: [5], params: {} }, null),
      row({ gate: "MEASURE", targets: [0], controls: [1], params: { cbit: 0 } }, null),
      ...Array.from({ length: MAX_COLUMNS - 3 }, () => row(null, null)),
      row({ gate: "Z", targets: [0], controls: [], params: {} }, null),
      row(null, null, { gate: "H", targets: [2], controls: [], params: {} }),
    ],
  };
  const n = normalizeLoaded(stored);
  assert.deepEqual(n.grid[0][1]?.gate, "H", "멀쩡한 칸까지 빠졌다");
  assert.deepEqual(n.notices, [
    { kind: "dropped", column: 1, gate: "FOO", reason: 'unknown gate "FOO"' },
    { kind: "dropped", column: 2, gate: "X", reason: "X uses q[5], but the circuit has 2 qubits" },
    { kind: "dropped", column: 3, gate: "MEASURE", reason: "MEASURE cannot be controlled" },
    { kind: "dropped", column: 13, gate: "Z", reason: "Z is stored beyond column 12" },
    { kind: "dropped", column: 14, gate: "H", reason: "H is stored beyond column 12" },
  ]);
  assert.match(loadNoticeText(n.notices), /^Opened with changes — left out column 1: unknown gate "FOO", column 2: X uses q\[5\], but the circuit has 2 qubits and 3 more\. /);

  // 공유 링크: 모르는 게이트, 열 범위 밖, 같은 칸에 둘. 링크 전체는 열린다(실패 = null 은 형식 오류뿐).
  const link = Buffer.from(JSON.stringify({
    v: 2, n: 2, p: [
      { c: 0, g: "FOO", tg: [0] },
      { c: 40, g: "H", tg: [0] },
      { c: 1, g: "X", tg: [0] },
      { c: 1, g: "Z", tg: [0] },
      { c: 2, g: "H", tg: [1] },
    ],
  })).toString("base64url");
  const dec = decodeCircuit(link);
  assert.ok(dec, "칸 하나 때문에 링크 전체를 버렸다");
  assert.equal(dec.grid[1][0].gate, "Z");
  assert.equal(dec.grid[2][1].gate, "H");
  assert.deepEqual(dec.dropped, [
    { column: 1, gate: null, reason: 'unknown gate "FOO"' },
    { column: null, gate: "H", reason: "H is outside columns 1–12" },
    { column: 2, gate: "X", reason: "X shares a cell with Z" },
  ]);
  withStorage({}, ({ writes }) => {
    const s = controller(dec).getSnapshot();
    assert.deepEqual(s.loadNotices.map((x) => x.reason), dec.dropped.map((d) => d.reason), "해독이 건너뛴 칸이 알림에 없다");
    assert.equal(writes(), 0);
  });
});

// ---------- 원본 보존이 편집을 잃지 않는다 ----------

// 회로를 바꾸는 API 전부(circuit.js 에서 grid · qubitCount · clbitCount 를 대입하는 자리는 모두 pushUndo 뒤다). 픽스처는 API 마다 성공하게
// 짰다 — 열 0: H q0 · RX q1(q2 빈칸), 열 1: CX(c=q0, t=q1) · 측정 q2→c0, 열 2: RCCX(분해 9스텝 — 4열 + 8 ≤ 12), 열 3: 조건 붙은 배리어(알림).
const API_FIXTURE = JSON.stringify({
  qubitCount: 3, clbitCount: 2,
  grid: [
    [{ gate: "H", targets: [0], controls: [], params: {} }, { gate: "RX", targets: [1], controls: [], params: { theta: 0.5 } }, null],
    [null, { gate: "X", targets: [1], controls: [0], params: {} }, { gate: "MEASURE", targets: [2], controls: [], params: { cbit: 0 } }],
    [{ gate: "RCCX", targets: [0, 1, 2], controls: [], params: {} }, null, null],
    [{ gate: "BARRIER", targets: [0], controls: [], params: { cif: 0 } }, null, null],
    ...Array.from({ length: MAX_COLUMNS - 4 }, () => [null, null, null]),
  ],
});

const EDITS = {
  placeGate: (c) => c.placeGate(5, 0, "H"),
  removeGate: (c) => c.removeGate(0, 0),
  expandGate: (c) => assert.equal(c.expandGate(2, 0).ok, true),
  clear: (c) => c.clear(),
  addControl: (c) => assert.equal(c.addControl(0, 2).ok, true),
  addControlToGate: (c) => assert.equal(c.addControlToGate(0, 0, [2]).ok, true),
  removeControl: (c) => assert.equal(c.removeControl(1, 0), true),
  setParams: (c) => assert.equal(c.setParams(0, 1, { theta: 1 }).ok, true), // 파라미터 슬라이더의 Apply
  setClassicalBit: (c) => assert.equal(c.setClassicalBit(1, 2, 1).ok, true), // 측정 비트 팝오버
  setCondition: (c) => assert.equal(c.setCondition(0, 0, 0).ok, true), // 조건 팝오버
  loadCircuit: (c) => c.loadCircuit(2, Array.from({ length: MAX_COLUMNS }, () => [null, null]), 2), // 프리셋 · 코드 패널 Apply
  setQubitCount: (c) => c.setQubitCount(4),
  setClbitCount: (c) => c.setClbitCount(3),
};

for (const [name, edit] of Object.entries(EDITS)) {
  test(`원본 보존 중에 ${name} 로 회로를 바꾸면 곧바로 저장되고 보존이 끝난다 — 편집을 잃지 않는다`, () => {
    withStorage({ [STORAGE_KEY]: API_FIXTURE }, ({ store, writes }) => {
      const ctl = controller();
      assert.equal(ctl.getSnapshot().preservingSource, true, "전제: 픽스처가 알림을 내야 한다");
      assert.equal(writes(), 0);
      const before = JSON.stringify(savedShape(ctl.getSnapshot()));
      edit(ctl);
      const after = ctl.getSnapshot();
      assert.notEqual(JSON.stringify(savedShape(after)), before, `전제: ${name} 가 회로를 바꾸지 않았다`);
      assert.ok(writes() >= 1, `${name} 뒤에도 저장하지 않았다 — 새로고침하면 편집이 사라진다`);
      assert.deepEqual(JSON.parse(store.get(STORAGE_KEY)), savedShape(after), `${name} 뒤 저장값이 화면의 회로가 아니다`);
      assert.equal(after.preservingSource, false);
    });
  });
}

test("편집이 아닌 동작은 원본 보존 중에 저장하지 않는다 — 선택 · 되감기 · Inspect · Resample · Undo/Redo · 스텝 · 재생", async () => {
  // 스텝 · 재생이 비동기라 withStorage(동기) 대신 여기서 직접 바꾸고 되돌린다.
  const store = new Map([[STORAGE_KEY, API_FIXTURE]]);
  let writes = 0;
  const had = Object.prototype.hasOwnProperty.call(globalThis, "localStorage");
  const before = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: () => { writes++; }, removeItem: () => {} };
  try {
    const ctl = controller();
    ctl.selectQubit(1);
    ctl.reset();
    ctl.setInspectMode(true);
    ctl.resample();
    ctl.undo(); // 스택이 비어 있다 — 보존 중에는 아무 일도 안 한다
    ctl.redo();
    await ctl.stepForward();
    await ctl.stepBackward();
    await ctl.play();
    ctl.pause();
    ctl.setInspectMode(false);
    assert.equal(writes, 0, `편집이 아닌 동작이 저장값을 ${writes}번 덮어썼다`);
    assert.equal(ctl.getSnapshot().preservingSource, true);
    assert.equal(ctl.getSnapshot().canUndo, false);
  } finally {
    if (had) globalThis.localStorage = before; else delete globalThis.localStorage;
  }
});

// ---------- 경계 경우의 뜻 ----------

test("조건부 측정이 자기가 읽는 비트에 결과를 쓰면, 조건은 측정 전의 값을 읽는다", () => {
  const s = EDGE.a();
  assert.deepEqual(s.grid[2][1].params, { cbit: 0, cif: 0 }, "전제: 화면 메뉴로 측정에 조건을 붙이지 못했다");
  const e = exactEnsemble(s.qubitCount, s.clbitCount, s.grid);
  assertClassical("(a)", e.classical, { 1: 0.25, 0: 0.75 });
  assert.ok(Math.abs(pOne(e.probs, 1) - 0.25) < 1e-9, `(a) P(q1=1) ${pOne(e.probs, 1)} — 0.25 이어야 한다(건너뛴 갈래는 q1 이 붕괴하지 않는다)`);
});

// docs/backlog.md 낮음 "같은 열 안의 쓰기와 읽기가 한 스텝에 실행돼, Inspect 로 측정과 보정을 따로 볼 수 없다" 와 같은 규칙이다 —
// 열 안의 순서(홈 행 오름차순)를 바꾸면 이 테스트를 의도적으로 고친다.
test("같은 열에서 다른 측정이 조건 비트를 쓰면, 위 행이 쓴 값은 아래 행이 읽고 아래 행이 쓴 값은 위 행이 읽지 않는다(backlog 낮음 '같은 열 쓰기 · 읽기')", () => {
  const b1 = EDGE.b1();
  const e1 = exactEnsemble(b1.qubitCount, b1.clbitCount, b1.grid);
  assertClassical("(b1) 쓰기 위 · 읽기 아래", e1.classical, { "10": 0.5, "11": 0.5 });
  assert.ok(Math.abs(pOne(e1.probs, 1) - 0.5) < 1e-9, `(b1) P(q1=1) ${pOne(e1.probs, 1)}`);
  const b2 = EDGE.b2();
  const e2 = exactEnsemble(b2.qubitCount, b2.clbitCount, b2.grid);
  assertClassical("(b2) 읽기 위 · 쓰기 아래", e2.classical, { "10": 1 });
  assert.ok(Math.abs(pOne(e2.probs, 0)) < 1e-9, `(b2) P(q0=1) ${pOne(e2.probs, 0)} — 위 행의 측정은 건너뛰어 H 가 되돌린다`);
});

test("조건부 리셋은 조건이 참인 갈래에서만 큐비트를 |0⟩ 으로 둔다", () => {
  const s = EDGE.c();
  assert.deepEqual(s.grid[2][1].params, { cif: 0 }, "전제: 화면 메뉴로 리셋에 조건을 붙이지 못했다");
  const e = exactEnsemble(s.qubitCount, s.clbitCount, s.grid);
  assert.ok(Math.abs(pOne(e.probs, 1) - 0.5) < 1e-9, `(c) P(q1=1) ${pOne(e.probs, 1)} — 0.5 이어야 한다`);
  assertClassical("(c)", e.classical, { 1: 0.5, 0: 0.5 });
});

test("조건부 측정 · 리셋 회로는 내보내기 → 가져오기 → 내보내기가 같은 글자를 내고, 공유 링크도 같은 문자열로 돌아오며, 앙상블이 같다", () => {
  const cases = { ...Object.fromEntries(Object.entries(EDGE).map(([k, f]) => [k, f()])) };
  withStorage({ [STORAGE_KEY]: STORED }, () => { cases.stored = controller().getSnapshot(); });
  cases.link = controller(parseShareHash(LINK)).getSnapshot();
  for (const [name, s] of Object.entries(cases)) {
    const once = toQASM(s.qubitCount, s.grid, s.clbitCount);
    assert.deepEqual(once.warnings, [], `${name}: 내보내기 경고`);
    const parsed = parseQASM(once.code);
    assert.ok(parsed.ok, `${name}: 앱이 내보낸 텍스트를 앱이 거부했다 — ${parsed.message}\n${once.code}`);
    assert.equal(toQASM(parsed.qubitCount, parsed.grid, parsed.clbitCount).code, once.code, `${name}: QASM 왕복이 글자를 바꿨다`);
    assert.equal(toQiskit(parsed.qubitCount, parsed.grid, parsed.clbitCount).code, toQiskit(s.qubitCount, s.grid, s.clbitCount).code, `${name}: Qiskit 코드가 달라졌다`);
    const link = encodeCircuit(s.qubitCount, s.grid, s.clbitCount);
    const back = decodeCircuit(link);
    assert.equal(encodeCircuit(back.qubitCount, back.grid, back.clbitCount), link, `${name}: 공유 링크 왕복이 문자열을 바꿨다`);
    const ea = exactEnsemble(s.qubitCount, s.clbitCount, s.grid);
    const eb = exactEnsemble(parsed.qubitCount, parsed.clbitCount, parsed.grid);
    ea.probs.forEach((p, i) => assert.ok(Math.abs(p - eb.probs[i]) < 1e-9, `${name}: 기저 ${i} 확률 ${p} → ${eb.probs[i]}`));
    assertClassical(`${name} 가져온 뒤`, eb.classical, Object.fromEntries(ea.classical));
  }
});

// ---------- 지연 변환은 조건부 측정 · 리셋을 거절한다 ----------

test("지연 변환은 조건 붙은 측정 · 리셋을 사유와 함께 거절하고, simulate() 는 그 사유로 던진다 — 조용히 틀린 상태를 내지 않는다", () => {
  for (const gate of ["MEASURE", "RESET"]) {
    const g = Array.from({ length: MAX_COLUMNS }, () => [null, null]);
    g[0][0] = { gate: "H", targets: [0], controls: [], params: {} };
    g[1][0] = { gate: "MEASURE", targets: [0], controls: [], params: { cbit: 0 } };
    g[2][1] = { gate, targets: [1], controls: [], params: gate === "MEASURE" ? { cbit: 0, cif: 0 } : { cif: 0 } };
    const r = resolveDeferred(2, 1, g);
    assert.equal(r.grid, null, `${gate}: 지연 변환이 조건 붙은 ${gate} 를 받았다`);
    const reason = /at column 3 is conditioned on c\[0\]\. Deferred measurement can't represent a conditioned measure or reset/;
    assert.match(r.error ?? "", reason);
    assert.throws(() => simulate(2, g, undefined, 1), reason);
  }
});
