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

import { toQASM, toQiskit, gatesApplyWouldDrop, lossesOnApply } from "../js/export.js";
import { parseQASM, normalizeCircuit, sameCircuit, QASM_OPS, opFor } from "../js/qasm.js";
import { MAX_COLUMNS } from "../js/circuit.js";
import { runTrajectory } from "../js/trajectory.js";
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

// 위 테스트는 회로 단위다. 코드 밴드의 Apply 는 **텍스트**를 파싱하고 다시 내보내므로, 사용자가
// 손대지 않은 코드가 Apply 뒤 한 글자라도 바뀌면 "아무것도 안 했는데 코드가 바뀌었다"가 된다.
// 표현 불가 게이트는 주석 줄로 나가고 Apply 가 그 주석을 건너뛰어 게이트가 사라지므로 텍스트가
// 달라지는 게 정상이다 — 그런 프리셋은 기준을 느슨하게 하지 않고 이름과 사유로 **명시적으로**
// 뺀다. 지금은 없다. 표에 없는 프리셋에 표현 불가 줄이 생겨도, 표에 있는데 그 줄이 사라져도
// 실패한다(낡은 제외가 남지 않게).
const TEXT_ROUNDTRIP_EXCLUDED = {};

test("모든 프리셋의 QASM 텍스트가 Apply 왕복 뒤 한 글자도 바뀌지 않는다", () => {
  for (const preset of PRESETS) {
    const dec = decodeCircuit(preset.circuit);
    const { code } = toQASM(dec.qubitCount, dec.grid, dec.clbitCount);
    const unrepresentable = code.includes("cannot be represented");
    const excluded = Object.hasOwn(TEXT_ROUNDTRIP_EXCLUDED, preset.name);
    assert.equal(excluded, unrepresentable,
      `${preset.name}: 표현 불가 줄이 ${unrepresentable ? "있는데 제외 표에 없다" : "없는데 제외 표에 있다"}`);
    if (excluded) continue;
    const parsed = parseQASM(code);
    assert.ok(parsed.ok, `${preset.name}: 내보낸 QASM 을 다시 읽지 못했다 — ${parsed.message}`);
    const again = toQASM(parsed.qubitCount, parsed.grid, parsed.clbitCount).code;
    assert.equal(again, code, `${preset.name}: Apply 왕복 뒤 텍스트가 달라졌다`);
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
  // 예전엔 첫 왕복에서 toFixed(6) 반올림이 한 번 일어나, 한 번 돌린 뒤의 고정점을 봤다. 지금은 전체 정밀도라 첫 왕복부터
  // === 다 — 그 보장은 test/params.test.mjs 가 단언한다. 여기는 한 번 돌린 회로가 다시 왕복하는지를 본다.
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

  // 조건부 게이트는 그 비트를 쓰는 measure **뒤**에 돌아야 한다 — ASAP 이 고전 비트 의존을 무시하면 인과가 뒤집힌다.
  // "뒤" 는 앱의 실행 순서(열, 그다음 홈 행)다: 다음 열이거나 같은 열의 아래 행. 예전엔 "다음 열" 만 맞다고 봐서 같은 열의 쓰기 → 읽기가
  // 열을 하나 더 썼고, 12열을 다 쓴 회로의 마지막 게이트가 사라졌다(test/qasm-conditions.test.mjs).
  const at = (gate) => {
    for (let col = 0; col < MAX_COLUMNS; col++) {
      const row = parsed.grid[col].findIndex((c) => c && c.gate === gate);
      if (row >= 0) return [col, row];
    }
    return null;
  };
  const [mCol, mRow] = at("MEASURE");
  const [xCol, xRow] = at("X");
  assert.ok(xCol > mCol || (xCol === mCol && xRow > mRow),
    `조건부 게이트(열 ${xCol} 행 ${xRow})가 measure(열 ${mCol} 행 ${mRow})보다 먼저 돈다`);
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
    ["복수 qreg", `OPENQASM 2.0;\nqreg q[2];\nqreg r[2];\n`, 3, /Not supported: multiple qreg/],
    // creg 는 여럿 받는다(조건 있는 회로를 비트마다 1비트 레지스터로 내보내므로) — 대신 이름이 겹치면 거부한다.
    ["creg 이름 중복", `OPENQASM 2.0;\nqreg q[2];\ncreg c[1];\ncreg c[1];\n`, 4, /classical register 'c' is declared twice/],
    ["qreg 와 같은 이름의 creg", `OPENQASM 2.0;\nqreg q[2];\ncreg q[1];\n`, 3, /classical register 'q' has the same name as the quantum register/],
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

// if 의미 경고(레지스터 비교 차이 안내)는 없어졌다 — 내보내기가 조건을 비트마다 1비트 레지스터로 정확히 쓴다.
// "조건 있는 회로에 경고가 없다·조건 없는 회로와 비트 1개 회로는 글자 그대로" 는 test/qasm-conditions.test.mjs 가 본다.

test("표현할 수 없는 게이트는 조용히 넘어가지 않는다", () => {
  // Z + 2제어(CCZ)는 QASM_OPS 에 없다 — 주석으로 나가되 warnings 에 반드시 잡혀야 한다.
  assert.equal(opFor("Z", 2), null, "이 테스트의 전제(CCZ 미지원)가 깨졌다");
  const g = build(3, [{ col: 0, cell: cell("Z", [2], [0, 1]) }]);
  const { code, warnings } = toQASM(3, g, 0);
  assert.match(code, /can't export to QASM/, "주석이 없다");
  assert.equal(warnings.length, 1, "warnings 에 안 잡혔다 — 사용자가 틀린 코드를 복사해 간다");
  assert.match(warnings[0], /Z with 2 control/);
});

// ---------------------------------------------------------------- Apply 가 알리지 않고 지우는 게이트
//
// Apply 는 텍스트에서 회로를 통째로 다시 만든다. 표현 못 한 게이트의 표시 줄은 주석이라 파서가 버리고,
// 그 게이트는 회로에서 사라진다. 예전엔 한 글자만 고쳐 Apply 해도 아무 말 없이 사라졌다.
// 판단은 표시 줄로 한다 — 줄이 남아 있으면 지울 뜻이 없었고, 사용자가 줄을 지웠으면 지울 뜻이다.

const MARKER = "// this app can't export to QASM:";
const withoutLines = (code, pick) => code.split("\n").filter((l) => !pick(l)).join("\n");
const summary = (drops) => drops.map((d) => [d.gate, d.controls, d.targets, d.column]);

/** S·CCZ·S(같은 큐비트) — 표현 불가 게이트 셋. 두 CS 는 표시 줄이 글자까지 같다. */
function threeLosses() {
  return build(3, [
    { col: 0, cell: cell("S", [1], [0]) },
    { col: 1, cell: cell("Z", [2], [0, 1]) },
    { col: 2, cell: cell("S", [1], [0]) },
  ]);
}

test("표시 줄을 남긴 편집이면 Apply 가 지울 게이트로 알린다 — 열은 정규화 전 그리드의 열이다", () => {
  // S 에 같은 열의 • 가 붙어 CS 가 된다 — 표현 불가는 • 를 접은 **뒤**의 제어 수로 정해진다.
  // 빈 열 셋 뒤 5열에 두어, 내보낸 텍스트의 순서(정규화로 앞당겨진다)와 회로의 열이 다르게 한다.
  const g = build(2, [{ col: 0, cell: cell("H", [0]) }]);
  g[4][1] = cell("S", [1]);
  g[4][0] = cell("CTRL", [0]);
  const { code } = toQASM(2, g, 0);
  const edited = code.replace("h q[0];", "x q[0];"); // 한 글자 편집
  assert.notEqual(edited, code, "편집이 일어나지 않았다 — 이 테스트의 전제가 깨졌다");
  assert.deepEqual(summary(gatesApplyWouldDrop(2, g, 0, edited)), [["S", [0], [1], 5]]);
});

test("표시 줄을 직접 지운 편집이면 지운다는 뜻이라 알리지 않는다", () => {
  const g = build(2, [{ col: 0, cell: cell("S", [1], [0]) }]);
  const edited = withoutLines(toQASM(2, g, 0).code, (l) => l.startsWith(MARKER));
  assert.deepEqual(gatesApplyWouldDrop(2, g, 0, edited), []);
});

test("표현 못 하는 게이트가 없는 회로는 Apply 가 지울 것이 없다", () => {
  const g = build(2, [
    { col: 0, cell: cell("H", [0]) },
    { col: 1, cell: cell("X", [1], [0]) },
  ]);
  const edited = toQASM(2, g, 0).code.replace("h q[0];", "x q[0];");
  assert.deepEqual(gatesApplyWouldDrop(2, g, 0, edited), []);
});

test("표현 못 하는 게이트가 여럿이면 표시 줄이 남은 것만, 내보낸 순서대로 알린다", () => {
  const g = threeLosses();
  const { code } = toQASM(3, g, 0);
  const all = [["S", [0], [1], 1], ["Z", [0, 1], [2], 2], ["S", [0], [1], 3]];
  assert.deepEqual(summary(gatesApplyWouldDrop(3, g, 0, code + " ")), all);

  // 글자까지 같은 두 CS 의 표시 줄 중 하나를 지우면 하나만 지울 뜻이다 — 남은 줄은 앞의 CS 와 짝짓는다.
  const lines = code.split("\n");
  const last = lines.findLastIndex((l) => l.includes("S with 1 control on"));
  const oneCsGone = lines.filter((_, i) => i !== last).join("\n");
  assert.deepEqual(summary(gatesApplyWouldDrop(3, g, 0, oneCsGone)), [all[0], all[1]]);

  const cczGone = withoutLines(code, (l) => l.includes("Z with 2 controls on"));
  assert.deepEqual(summary(gatesApplyWouldDrop(3, g, 0, cczGone)), [all[0], all[2]]);
});

test("기록할 고전 비트가 없는 Measure 도 표시 줄을 남기고, 그 줄로 같은 판정을 받는다", () => {
  // 예전엔 줄을 아예 쓰지 않아(배너 경고뿐) "사용자가 지웠다" 와 구별할 수 없었다.
  const g = build(2, [
    { col: 0, cell: cell("H", [0]) },
    { col: 1, cell: cell("MEASURE", [0]) },
  ]);
  const { code } = toQASM(2, g, 0);
  assert.ok(code.split("\n").some((l) => l.startsWith(MARKER) && l.includes("MEASURE on q[0]")),
    `비트 없는 Measure 의 표시 줄이 없다:\n${code}`);
  assert.deepEqual(summary(gatesApplyWouldDrop(2, g, 0, code + " ")), [["MEASURE", [], [0], 2]]);
  assert.deepEqual(gatesApplyWouldDrop(2, g, 0, withoutLines(code, (l) => l.startsWith(MARKER))), []);
});

test("내보내기의 표시 줄·경고와 Apply 판정이 같은 곳에서 나온다 — 편집 없는 텍스트에서 둘이 일치한다", () => {
  // 조건이 없는 회로라 warnings 에는 표현 불가 경고만 있다.
  const g = threeLosses();
  g[3][0] = cell("MEASURE", [0]);
  const { code, warnings } = toQASM(3, g, 0);
  const drops = gatesApplyWouldDrop(3, g, 0, code);
  assert.equal(drops.length, 4, `표현 불가 넷이 모두 잡히지 않았다:\n${code}`);
  assert.deepEqual(drops.map((d) => d.warning), warnings);
});

test("표시 줄을 고쳤으면 무엇을 뜻했는지 모르니 짝 없는 게이트를 모두 알린다 — 앞뒤 공백만은 무시한다", () => {
  const g = build(3, [
    { col: 0, cell: cell("S", [1], [0]) },
    { col: 1, cell: cell("Z", [2], [0, 1]) },
  ]);
  const { code } = toQASM(3, g, 0);
  const cczGone = withoutLines(code, (l) => l.includes("Z with 2 controls on"));
  const cs = ["S", [0], [1], 1];
  const ccz = ["Z", [0, 1], [2], 2];

  // 들여쓰기·끝 공백은 같은 줄이다 → CS 는 짝을 찾고, 줄을 지운 CCZ 는 지울 뜻으로 남는다.
  const padded = cczGone.replace(/^(\/\/ this app can't export to QASM.*S with 1 control on.*)$/m, "   $1  ");
  assert.notEqual(padded, cczGone, "공백을 넣지 못했다 — 이 테스트의 전제가 깨졌다");
  assert.deepEqual(summary(gatesApplyWouldDrop(3, g, 0, padded)), [cs]);

  // CS 표시 줄의 큐비트를 고치면 어느 게이트와도 맞지 않는 표시 줄이 남는다 → 줄을 지운 CCZ 까지 알린다.
  const retargeted = cczGone.replace(/(S with 1 control on q\[0\]),q\[1\]/, "$1,q[2]");
  assert.notEqual(retargeted, cczGone, "큐비트를 고치지 못했다 — 이 테스트의 전제가 깨졌다");
  assert.deepEqual(summary(gatesApplyWouldDrop(3, g, 0, retargeted)), [cs, ccz]);
});

test("표시 줄을 직접 지운 게이트는 확인 없이 지우되, 지운 것으로 알린다", () => {
  // 확인은 건너뛰고 알림은 남긴다 — 지울 뜻을 잘못 판정했을 때의 비용이 크다(실행 뒤 상태 줄이 이 목록을 적는다).
  const g = build(2, [{ col: 0, cell: cell("S", [1], [0]) }]);
  const { code } = toQASM(2, g, 0);
  const cs = ["S", [0], [1], 1];

  const deleted = lossesOnApply(2, g, 0, withoutLines(code, (l) => l.startsWith(MARKER)));
  assert.deepEqual(summary(deleted.unannounced), [], "줄을 지웠는데 확인을 요구한다");
  assert.deepEqual(summary(deleted.lineDeleted), [cs], "줄을 지운 게이트가 실행 뒤 알림 목록에 없다");

  const kept = lossesOnApply(2, g, 0, code + " ");
  assert.deepEqual(summary(kept.unannounced), [cs]);
  assert.deepEqual(summary(kept.lineDeleted), []);

  const plain = build(2, [{ col: 0, cell: cell("H", [0]) }]);
  assert.deepEqual(lossesOnApply(2, plain, 0, toQASM(2, plain, 0).code + " "), { unannounced: [], lineDeleted: [] });
});

test("의심스러운 표시 줄이 있으면 줄을 지운 게이트도 지운 뜻으로 보지 않고 확인을 거친다", () => {
  const g = build(3, [
    { col: 0, cell: cell("S", [1], [0]) },
    { col: 1, cell: cell("Z", [2], [0, 1]) },
  ]);
  const { code } = toQASM(3, g, 0);
  // CCZ 줄을 지우고 CS 줄의 큐비트를 고친다 — 남은 표시 줄이 어느 게이트와도 맞지 않는다.
  const edited = withoutLines(code, (l) => l.includes("Z with 2 control"))
    .replace(/(S with 1 control\S* on q\[0\]),q\[1\]/, "$1,q[2]");
  const { unannounced, lineDeleted } = lossesOnApply(3, g, 0, edited);
  assert.deepEqual(summary(unannounced), [["S", [0], [1], 1], ["Z", [0, 1], [2], 2]]);
  assert.deepEqual(lineDeleted, [], "의심스러운데 '지운 뜻' 으로 판정했다");
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

// ---------------------------------------------------------------- [3] 고전 레지스터 프리셋

/** 두 상태벡터가 진폭 단위로 같은지. 확률만 보면 위상이 틀려도 통과한다. */
function sameState(a, b, label) {
  assert.equal(a.length, b.length, `${label}: 차원이 다르다`);
  for (let i = 0; i < a.length; i++) {
    assert.ok(
      Math.abs(a[i].re - b[i].re) < 1e-6 && Math.abs(a[i].im - b[i].im) < 1e-6,
      `${label}: idx ${i} (${a[i].re.toFixed(4)},${a[i].im.toFixed(4)}) → (${b[i].re.toFixed(4)},${b[i].im.toFixed(4)})`
    );
  }
}

/**
 * 붕괴 갈래마다 (고전 비트 → 가중치·상태벡터) — 앱이 조건부 회로를 도는 궤적 경로 그대로다. 갈래마다 상태벡터까지 보므로 지연 측정
 * 경로(simulate)의 상태벡터 하나를 비교하던 것보다 약하지 않다. simulate 를 쓰지 않는 이유: 왕복한 텔레포테이션은 조건이 그 비트를 쓰는
 * 측정과 같은 열의 아래 행에 놓이는데(배치 규칙, quantum-spec §10), 지연 변환(classical.js resolveDeferred)은 같은 열의 기록을 보지 않아
 * "nothing has measured into c[1] yet" 으로 거부한다 — 앱과 다른 그 읽기는 docs/backlog.md 에 있다.
 */
function branches(qubitCount, clbitCount, grid) {
  const out = new Map();
  (function branch(prefix) {
    let k = 0;
    const r = runTrajectory(qubitCount, clbitCount, grid, MAX_COLUMNS, () => {
      const want = prefix[k++];
      return want === undefined ? 0.5 : want === 1 ? 0 : 1 - 1e-15;
    });
    if (r.measurements.length > prefix.length) {
      branch([...prefix, 0]);
      branch([...prefix, 1]);
      return;
    }
    let w = 1;
    for (let i = 0; i < prefix.length; i++) {
      const m = r.measurements[i];
      if (m.outcome !== prefix[i]) return;
      w *= m.outcome ? m.p1 : 1 - m.p1;
    }
    if (w < 1e-12) return;
    const key = r.clbits.join("");
    assert.ok(!out.has(key), `고전 비트 ${key} 로 끝나는 갈래가 둘이다 — 이 비교의 전제가 깨졌다`);
    out.set(key, { w, state: r.state });
  })([]);
  return out;
}

test("[3] 고전 레지스터 프리셋이 왕복해도 갈래마다 **상태벡터**가 같다", () => {
  // 구조(셀) 비교는 위에서 했다. 여기서는 의미까지 같은지 본다 —
  // 구조가 같아 보여도 조건 비트나 측정 대상이 어긋나면 상태가 달라진다.
  for (const name of ["Quantum teleportation", "Superdense coding"]) {
    const preset = PRESETS.find((p) => p.name === name);
    const dec = decodeCircuit(preset.circuit);
    const parsed = parseQASM(toQASM(dec.qubitCount, dec.grid, dec.clbitCount).code);
    assert.ok(parsed.ok, `${name}: ${parsed.message}`);
    const before = branches(dec.qubitCount, dec.clbitCount, dec.grid);
    const after = branches(parsed.qubitCount, parsed.clbitCount, parsed.grid);
    assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort(), `${name}: 갈래(고전 비트 결과)가 다르다`);
    for (const [key, { w, state }] of before) {
      assert.ok(Math.abs(after.get(key).w - w) < 1e-12, `${name} c=${key}: 가중치 ${w} → ${after.get(key).w}`);
      sameState(state, after.get(key).state, `${name} c=${key}`);
    }
  }
});

test("[3] creg 선언과 measure 문의 인덱스 쌍이 정확하다", () => {
  const preset = PRESETS.find((p) => p.name === "Quantum teleportation");
  const dec = decodeCircuit(preset.circuit);
  const { code } = toQASM(dec.qubitCount, dec.grid, dec.clbitCount);

  // 정규식보다 줄 단위 문자열 비교가 안전하다(대괄호 이스케이프가 조용히 깨지기 쉽다).
  // 텔레포테이션은 조건이 있고 고전 비트가 2개 이상이라 비트마다 1비트 레지스터다(c0[1] … — 조건을 비트 하나로 쓰려고).
  const lines = code.split("\n");
  const wantCregs = Array.from({ length: dec.clbitCount }, (_, k) => `creg c${k}[1];`);
  assert.deepEqual(
    lines.filter((l) => l.startsWith("creg")), wantCregs,
    `creg 선언이 비트마다 하나가 아니다 — 실제: ${lines.filter((l) => l.startsWith("creg")).join(" / ") || "없음"}`
  );

  // 원본의 (측정 큐비트 → 고전 비트) 쌍과 QASM 의 measure 줄이 정확히 대응해야 한다.
  const want = dec.grid
    .flat()
    .filter((c) => c && c.gate === "MEASURE")
    .map((c) => `measure q[${c.targets[0]}] -> c${c.params.cbit ?? c.targets[0]}[0];`)
    .sort();
  const got = (code.match(/^measure .*$/gm) ?? []).sort();
  assert.deepEqual(got, want, "measure 문의 인덱스 쌍이 원본과 다르다");
  assert.ok(want.length > 0, "이 프리셋에는 measure 가 있어야 한다");
});

test("[3] if 줄이 왕복 전후로 문자열까지 같다", () => {
  // 조건 있는 회로는 `if (c1==1)`, 고전 비트가 하나면 `if (c==1)` 이다 — 두 모양 모두 센다.
  const ifLines = (src) => (src.match(/^if \(c\d*==\d+\) .*$/gm) ?? []);

  const tele = decodeCircuit(PRESETS.find((p) => p.name === "Quantum teleportation").circuit);
  const first = toQASM(tele.qubitCount, tele.grid, tele.clbitCount).code;
  const parsed = parseQASM(first);
  assert.ok(parsed.ok, parsed.message);
  const second = toQASM(parsed.qubitCount, parsed.grid, parsed.clbitCount).code;
  assert.ok(ifLines(first).length === 2, `텔레포테이션의 if 줄이 ${ifLines(first).length}개 — 구성이 바뀌었다`);
  assert.deepEqual(ifLines(second), ifLines(first), "if 줄이 왕복 후 달라졌다");

  // superdense 에는 조건부 연산이 없다 — 왕복 후에도 0개여야 한다(있으면 회로가 틀린 것).
  const sd = decodeCircuit(PRESETS.find((p) => p.name === "Superdense coding").circuit);
  const sdFirst = toQASM(sd.qubitCount, sd.grid, sd.clbitCount).code;
  const sdParsed = parseQASM(sdFirst);
  assert.ok(sdParsed.ok, sdParsed.message);
  assert.deepEqual(ifLines(sdFirst), [], "superdense 에 if 줄이 생겼다 — 이 프로토콜에는 조건부 연산이 없다");
  assert.deepEqual(ifLines(toQASM(sdParsed.qubitCount, sdParsed.grid, sdParsed.clbitCount).code), []);
});
