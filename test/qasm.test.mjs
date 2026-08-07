// QASM 왕복(round-trip) 무손실이 이 기능의 핵심 계약이다.
//
// 회로 → QASM → Apply 로 회로가 조금씩 달라지면 사용자는 그걸 알아채지 못한 채
// 다른 회로를 시뮬레이션하게 된다. 그래서 "돌려봤더니 되더라"가 아니라
// **정규형끼리 셀 단위로 같은지**를 프리셋 전부와 까다로운 게이트들에 대해 못 박는다.
//
// 비교는 정규형끼리 한다: QASM 에는 열 구조도 제어점(•) 문법도 없으므로,
// 양쪽을 같은 규칙(빈 열 압축 + 제어점을 controls 로 접기)으로 맞춘 뒤 본다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { toQASM, toQiskit, IF_SEMANTICS_WARNING } from "../js/export.js";
import { parseQASM, normalizeCircuit, sameCircuit, QASM_OPS, opFor } from "../js/qasm.js";
import { MAX_COLUMNS } from "../js/circuit.js";
import { PRESETS } from "../js/presets.js";
import { decodeCircuit } from "../js/export.js";

const cell = (gate, targets, controls = [], params = {}) => ({ gate, targets, controls, params });

/** 셀 목록을 grid 로. [{col, cell}] */
function build(qubitCount, placements) {
  const grid = Array.from({ length: MAX_COLUMNS }, () => new Array(qubitCount).fill(null));
  for (const { col, cell: c } of placements) grid[col][c.targets[0]] = c;
  return grid;
}

/** 원본 → QASM → 파싱 → 정규형 비교. 실패 시 QASM 을 통째로 보여준다(디버깅 비용 절감). */
function roundTrip(label, qubitCount, grid, clbitCount = qubitCount) {
  const { code } = toQASM(qubitCount, grid, clbitCount);
  const parsed = parseQASM(code);
  assert.ok(parsed.ok, `${label}: 파싱 실패 — ${parsed.message}\n${code}`);
  const before = normalizeCircuit(qubitCount, grid).grid;
  const after = normalizeCircuit(parsed.qubitCount, parsed.grid).grid;
  assert.ok(
    sameCircuit(qubitCount, before, parsed.qubitCount, after),
    `${label}: 왕복 후 회로가 달라졌다\n--- QASM ---\n${code}`
  );
  assert.equal(parsed.clbitCount, clbitCount, `${label}: 고전 비트 수가 달라졌다`);
  return { code, parsed };
}

// ---------------------------------------------------------------- 왕복

test("모든 프리셋이 왕복해도 같은 회로다", () => {
  assert.ok(PRESETS.length >= 8, "프리셋이 예상보다 적다 — 테스트가 비어 있는지 확인");
  for (const preset of PRESETS) {
    const dec = decodeCircuit(preset.circuit);
    assert.ok(dec, `${preset.name}: 프리셋 디코드 실패`);
    roundTrip(preset.name, dec.qubitCount, dec.grid, dec.clbitCount);
  }
});

test("다중 제어 게이트가 왕복한다 (CCX · c3x · c4x)", () => {
  roundTrip("CCX", 3, build(3, [{ col: 0, cell: cell("X", [2], [0, 1]) }]), 0);
  roundTrip("c3x", 4, build(4, [{ col: 0, cell: cell("X", [3], [0, 1, 2]) }]), 0);
  roundTrip("c4x", 5, build(5, [{ col: 0, cell: cell("X", [4], [0, 1, 2, 3]) }]), 0);
});

test("RCCX / RC3X 는 타깃 순서까지 보존된다 (순서가 결과를 바꾼다)", () => {
  // targets 순서를 뒤집은 두 회로가 서로 다른 QASM 이 되어야 한다.
  const a = build(3, [{ col: 0, cell: cell("RCCX", [0, 1, 2]) }]);
  const b = build(3, [{ col: 0, cell: cell("RCCX", [1, 0, 2]) }]);
  const ra = roundTrip("RCCX(0,1,2)", 3, a, 0);
  const rb = roundTrip("RCCX(1,0,2)", 3, b, 0);
  assert.notEqual(ra.code, rb.code, "타깃 순서가 QASM 에 반영되지 않는다");
  assert.deepEqual(ra.parsed.grid[0][0].targets, [0, 1, 2]);
  assert.deepEqual(rb.parsed.grid[0][1].targets, [1, 0, 2]);

  roundTrip("RC3X", 4, build(4, [{ col: 0, cell: cell("RC3X", [0, 1, 2, 3]) }]), 0);
});

test("파라미터 게이트가 왕복한다 (RX·RY·RZ·P·U)", () => {
  const g = build(2, [
    { col: 0, cell: cell("RX", [0], [], { theta: Math.PI / 2 }) },
    { col: 1, cell: cell("RY", [0], [], { theta: Math.PI / 4 }) },
    { col: 2, cell: cell("RZ", [0], [], { theta: Math.PI }) },
    { col: 3, cell: cell("P", [1], [], { theta: Math.PI / 3 }) },
    { col: 4, cell: cell("U", [1], [], { theta: 0.5, phi: 1.25, lambda: -0.75 }) },
  ]);
  // 첫 왕복에서 toFixed(6) 반올림이 한 번 일어나므로, 그 이후가 고정점인지를 본다.
  const first = parseQASM(toQASM(2, g, 0).code);
  assert.ok(first.ok, first.message);
  roundTrip("params(고정점)", 2, first.grid, 0);
});

test("각도가 왕복 후에도 드리프트하지 않는다 (표시값이 흔들리면 안 된다)", () => {
  const deg = (rad) => Math.round((rad * 180) / Math.PI);
  for (const [label, theta, expected] of [
    ["π/2", Math.PI / 2, 90],
    ["π/4", Math.PI / 4, 45],
    ["π", Math.PI, 180],
    ["π/3", Math.PI / 3, 60],
    ["2π/3", (2 * Math.PI) / 3, 120],
  ]) {
    let grid = build(2, [{ col: 0, cell: cell("RX", [0], [], { theta }) }]);
    const seen = [];
    for (let i = 0; i < 3; i++) {
      const parsed = parseQASM(toQASM(2, grid, 0).code);
      assert.ok(parsed.ok, `${label}: ${parsed.message}`);
      grid = parsed.grid;
      seen.push(grid[0][0].params.theta);
    }
    assert.equal(seen[0], seen[1], `${label}: 2회차에 값이 바뀐다 (${seen.join(" → ")})`);
    assert.equal(seen[1], seen[2], `${label}: 3회차에 값이 바뀐다 (${seen.join(" → ")})`);
    for (const v of seen) {
      assert.equal(deg(v), expected, `${label}: 표시 각도가 ${deg(v)}° 로 밀렸다`);
    }
  }
});

test("고전 레지스터와 측정이 왕복한다", () => {
  const g = build(3, [
    { col: 0, cell: cell("H", [0]) },
    { col: 1, cell: cell("MEASURE", [0], [], { cbit: 2 }) },
    { col: 2, cell: cell("X", [1], [], { cif: 2 }) },
  ]);
  const { parsed } = roundTrip("classical", 3, g, 3);
  const find = (gate) => parsed.grid.flat().find((c) => c && c.gate === gate);
  assert.equal(find("MEASURE").params.cbit, 2, "측정 대상 비트가 보존되지 않았다");
  assert.equal(find("X").params.cif, 2, "조건 비트가 보존되지 않았다");

  // 조건부 게이트는 그 비트를 쓰는 measure **뒤** 열에 있어야 한다 —
  // ASAP 이 고전 비트 의존을 무시하면 인과가 뒤집힌다.
  const colOf = (gate) => parsed.grid.findIndex((col) => col.some((c) => c && c.gate === gate));
  assert.ok(colOf("X") > colOf("MEASURE"), "조건부 게이트가 measure 앞으로 당겨졌다");
});

test("SWAP·CSWAP·RXX·RYY·RZZ 가 왕복한다", () => {
  roundTrip("SWAP", 2, build(2, [{ col: 0, cell: cell("SWAP", [0, 1]) }]), 0);
  roundTrip("CSWAP", 3, build(3, [{ col: 0, cell: cell("SWAP", [1, 2], [0]) }]), 0);
  for (const gate of ["RXX", "RYY", "RZZ"]) {
    roundTrip(gate, 2, build(2, [{ col: 0, cell: cell(gate, [0, 1], [], { theta: 0.7 }) }]), 0);
  }
});

// ---------------------------------------------------------------- 정규화

test("제어점(•)이 명시적 제어로 접힌다 — 예전엔 export 가 이걸 통째로 버렸다", () => {
  // q1 에 제어점, 같은 열 q0 에 X → 실질은 CX(1→0)
  const grid = build(2, [
    { col: 0, cell: cell("X", [0]) },
    { col: 0, cell: cell("CTRL", [1]) },
  ]);
  const { grid: norm, changed } = normalizeCircuit(2, grid);
  assert.ok(changed.controlDots, "제어점이 접혔다고 보고하지 않는다");
  assert.deepEqual(norm[0][0].controls, [1], "제어점이 controls 로 들어가지 않았다");
  assert.equal(norm[0][1], null, "CTRL 셀이 남아 있다");

  const { code } = toQASM(2, grid, 0);
  assert.match(code, /cx q\[1\],q\[0\];/, "제어점이 반영된 cx 가 나오지 않는다");
  roundTrip("control dot", 2, grid, 0);
});

test("빈 열이 압축되고, 압축이 일어났는지 보고한다", () => {
  const gapped = build(2, [
    { col: 0, cell: cell("H", [0]) },
    { col: 5, cell: cell("X", [1]) },
  ]);
  const { grid, changed } = normalizeCircuit(2, gapped);
  assert.ok(changed.emptyColumns, "빈 열 압축을 보고하지 않는다");
  // ASAP 은 큐비트별이라, q1 의 게이트는 q0 와 독립이므로 0번 열까지 당겨진다.
  assert.ok(grid[0][1], "두 번째 게이트가 앞쪽 열로 당겨지지 않았다");

  // 이미 촘촘한 회로에서는 아무것도 바뀌지 않았다고 보고해야 한다(불필요한 안내 방지).
  // 이미 ASAP 형태인 회로 — 둘 다 0번 열(서로 독립이므로).
  const tight = build(2, [
    { col: 0, cell: cell("H", [0]) },
    { col: 0, cell: cell("X", [1]) },
  ]);
  const t = normalizeCircuit(2, tight);
  assert.equal(t.changed.emptyColumns, false);
  assert.equal(t.changed.controlDots, false);
});

// ---------------------------------------------------------------- 파싱 실패

test("파싱 실패 시 부분 결과를 반환하지 않는다", () => {
  const bad = `OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\nh q[0];\nfoo q[1];\n`;
  const r = parseQASM(bad);
  assert.equal(r.ok, false);
  assert.equal(r.grid, undefined, "실패했는데 grid 를 돌려준다 — 부분 적용 경로가 생긴다");
  assert.equal(r.qubitCount, undefined);
});

test("에러에 줄 번호와 구체적 사유가 함께 붙는다", () => {
  const cases = [
    ["알 수 없는 게이트", `OPENQASM 2.0;\nqreg q[2];\nfoo q[0];\n`, 3, /unknown gate 'foo'/],
    ["커스텀 게이트 정의", `OPENQASM 2.0;\nqreg q[2];\ngate mine a { h a; }\n`, 3, /Not supported: custom gate definitions/],
    ["반복문", `OPENQASM 2.0;\nqreg q[2];\nfor i in [0:2] { h q[0]; }\n`, 3, /Not supported: (loops and functions|custom gate definitions)/],
    ["복수 qreg", `OPENQASM 2.0;\nqreg q[2];\nqreg r[2];\n`, 3, /Not supported: multiple qreg\/creg/],
    ["복수 creg", `OPENQASM 2.0;\nqreg q[2];\ncreg c[1];\ncreg d[1];\n`, 4, /Not supported: multiple qreg\/creg/],
    ["큐비트 수 초과", `OPENQASM 2.0;\nqreg q[9];\n`, 2, /needs 9 qubits, but the maximum is 6/],
    ["다중 비트 조건", `OPENQASM 2.0;\nqreg q[2];\ncreg c[2];\nif (c==3) x q[0];\n`, 4, /Not supported: multi-bit conditions/],
    ["제어 수 초과", `OPENQASM 2.0;\nqreg q[6];\nc5x q[0],q[1],q[2],q[3],q[4],q[5];\n`, 3, /Not supported: c5x/],
  ];
  for (const [label, src, line, pattern] of cases) {
    const r = parseQASM(src);
    assert.equal(r.ok, false, `${label}: 통과해 버렸다`);
    assert.equal(r.line, line, `${label}: 줄 번호가 ${r.line} (기대 ${line}) — ${r.message}`);
    assert.match(r.message, pattern, `${label}: 사유가 구체적이지 않다`);
    assert.match(r.message, /^Line \d+: /, `${label}: 줄 번호 접두사가 없다`);
    assert.doesNotMatch(r.message, /^Line \d+: syntax error$/i, `${label}: 뭉뚱그린 메시지다`);
  }
});

test("주석과 pi 표기를 읽는다", () => {
  const src = [
    "OPENQASM 2.0;",
    'include "qelib1.inc";',
    "qreg q[2];",
    "// 주석",
    "rx(pi/2) q[0];",
  ].join("\n");
  const r = parseQASM(src);
  assert.ok(r.ok, r.message);
  assert.ok(Math.abs(r.grid[0][0].params.theta - Math.PI / 2) < 1e-9);
});

// ---------------------------------------------------------------- if 경고

/** 주석 블록이 코드에 들어 있는가. Copy 가 이 문자열을 그대로 넘기므로 코드로 확인한다. */
const hasNote = (code) => /This app treats/.test(code);

test("if 경고는 조건이 있고 고전 비트가 2개 이상일 때만 뜬다", () => {
  // (1) 고전 비트 1개 + 조건 1개 → 안 뜸
  const one = build(2, [
    { col: 0, cell: cell("MEASURE", [0], [], { cbit: 0 }) },
    { col: 1, cell: cell("X", [1], [], { cif: 0 }) },
  ]);
  const r1 = toQASM(2, one, 1);
  assert.equal(hasNote(r1.code), false, "1비트인데 주석이 붙었다 — 불필요한 경고");
  assert.ok(!r1.warnings.includes(IF_SEMANTICS_WARNING), "1비트인데 if 경고가 붙었다");

  // (2) 텔레포테이션 프리셋(고전 비트 2개 + 조건 2개) → 뜸
  const tele = PRESETS.find((p) => /teleport/i.test(p.name));
  assert.ok(tele, "텔레포테이션 프리셋을 찾지 못했다");
  const dec = decodeCircuit(tele.circuit);
  const r2 = toQASM(dec.qubitCount, dec.grid, dec.clbitCount);
  assert.ok(dec.clbitCount > 1, "이 프리셋은 고전 비트가 2개 이상이어야 한다");
  assert.equal(hasNote(r2.code), true, "텔레포테이션에 주석이 안 붙었다");
  assert.ok(r2.warnings.includes(IF_SEMANTICS_WARNING), "warnings 에 안 잡혔다");

  // (3) 조건 없음 → 고전 비트가 몇 개든 안 뜸
  for (const n of [0, 1, 2, 6]) {
    const plain = build(2, [
      { col: 0, cell: cell("H", [0]) },
      { col: 1, cell: cell("MEASURE", [0], [], { cbit: 0 }) },
    ]);
    const r = toQASM(2, plain, n);
    assert.equal(hasNote(r.code), false, `조건이 없는데 clbit=${n} 에서 주석이 붙었다`);
    // clbit=0 이면 "쓸 고전 비트가 없다"는 별개의 정당한 경고가 뜬다 — if 경고만 없으면 된다.
    assert.ok(
      !r.warnings.includes(IF_SEMANTICS_WARNING),
      `조건이 없는데 clbit=${n} 에서 if 경고가 생겼다`
    );
  }
});

test("if 경고 문구가 무엇이 어떻게 다른지 말한다", () => {
  const tele = PRESETS.find((p) => /teleport/i.test(p.name));
  const dec = decodeCircuit(tele.circuit);
  const { code } = toQASM(dec.qubitCount, dec.grid, dec.clbitCount);
  // "may behave differently" 류로 뭉뚱그리지 않았는지 — 세 조각이 모두 있어야 한다.
  assert.match(code, /if \(c==2\^k\)/, "조건 표기 예시가 없다");
  assert.match(code, /bit c\[k\] is 1/, "이 앱의 의미 설명이 없다");
  assert.match(code, /whole register value/, "OpenQASM 쪽 의미 설명이 없다");
  assert.match(IF_SEMANTICS_WARNING, /whole register value/);
});

test("표현할 수 없는 게이트는 조용히 넘어가지 않는다", () => {
  // Z + 2제어(CCZ)는 QASM_OPS 에 없다 — 주석으로 나가되 warnings 에 반드시 잡혀야 한다.
  assert.equal(opFor("Z", 2), null, "이 테스트의 전제(CCZ 미지원)가 깨졌다");
  const g = build(3, [{ col: 0, cell: cell("Z", [2], [0, 1]) }]);
  const { code, warnings } = toQASM(3, g, 0);
  assert.match(code, /cannot be represented/, "주석이 없다");
  assert.equal(warnings.length, 1, "warnings 에 안 잡혔다 — 사용자가 틀린 코드를 복사해 간다");
  assert.match(warnings[0], /Z with 2 control/);
});

// ---------------------------------------------------------------- 표 단일성

test("매핑 표가 하나뿐이다 (export 와 parse 가 갈라지지 않게)", () => {
  const src = readFileSync(new URL("../js/export.js", import.meta.url), "utf8");
  for (const stale of ["const SIMPLE", "const PARAM", "function qasmControlled", "controlledQiskit"]) {
    assert.ok(!src.includes(stale), `export.js 에 옛 매핑 '${stale}' 이 남아 있다`);
  }
  assert.match(src, /from "\.\/qasm\.js"/, "export.js 가 QASM_OPS 를 쓰지 않는다");
  // 같은 (gate, 제어 수) 조합이 표에 두 번 나오면 export 가 어느 쪽을 쓸지 모호해진다.
  const keys = QASM_OPS.map((op) => `${op.gate}/${op.nc}`);
  assert.equal(new Set(keys).size, keys.length, "표에 중복된 (gate, nc) 조합이 있다");
  const names = QASM_OPS.map((op) => op.qasm);
  assert.equal(new Set(names).size, names.length, "표에 중복된 QASM 이름이 있다");
});

test("Qiskit 코드는 생성되며 왕복 대상이 아니다", () => {
  const g = build(2, [{ col: 0, cell: cell("X", [1], [0]) }]);
  const { code } = toQiskit(2, g, 0);
  assert.match(code, /from qiskit import QuantumCircuit/);
  assert.match(code, /qc\.cx\(0, 1\)/);
});
