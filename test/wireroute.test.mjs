// 연결선이 같은 열의 다른 칩 · ⊕ · • · 다른 선을 지나가지 않는다 — js/wireroute.js 의 판정 · 계획 · 경로.
//
// 예전 고전 이중선은 출발 칸 중심에서 고전 행까지 곧게 내려, 같은 열 아래 칩 뒤를 지나 두 칩이 한 게이트처럼 보였고(예전 링크의
// 조건부 리셋 → 측정), 배경 없는 ⊕ · • 를 지나 CX · 제어처럼 읽혔다(Apply 한 텔레포테이션). 양자 제어선도 관여하지 않는 ⊕ 를 지나
// "타깃 둘인 CX" 로 읽혔다. 장면은 브라우저 실측의 재현이다(2026-10-30 교차 분류 — docs/backlog.md 의 옛 중간 행).
// 치수는 style.css 토큰에서 읽는다 — 테스트가 숫자를 따로 적지 않는다. 그리는 요소의 종류(칩 · 기호 · 점)와 선 목록은 grid.js 와
// 같은 함수(columnRoles · columnLinks · columnSpans)에서 온다. 좌표만 DOM 대신 토큰으로 만든다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  conflicts, planGrid, drawGrid, offsetPolyline, breakAround,
  columnRoles, columnLinks, columnSpans,
} from "../js/wireroute.js";
import { MAX_COLUMNS } from "../js/circuit.js";
import { decodeCircuit, toQASM } from "../js/export.js";
import { parseQASM } from "../js/qasm.js";
import { PRESETS } from "../js/presets.js";

// ---------- style.css 토큰 ----------

const CSS = readFileSync(new URL("../style.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const ROOT = CSS.match(/:root\s*\{([\s\S]*?)\n\}/)[1];
const TOKENS = new Map([...ROOT.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
function px(name, seen = []) {
  assert.ok(TOKENS.has(name), `:root 에 토큰이 없다: ${name}`);
  const v = TOKENS.get(name);
  const alias = v.match(/^var\((--[\w-]+)\)$/);
  if (alias) return px(alias[1], [...seen, name]);
  const n = parseFloat(v);
  assert.ok(Number.isFinite(n) && /^-?[\d.]+px$/.test(v), `${name} 가 px 값이 아니다: ${v}`);
  return n;
}
const T = {
  cell: px("--grid-cell"), chip: px("--grid-chip"), dot: px("--grid-dot"), margin: px("--space-1"),
  line: px("--cl-line"), qLine: px("--q-line"), badge: px("--cl-badge"), badgeGap: px("--cl-badge-gap"),
  lane: px("--cl-lane"), clearance: px("--cl-clearance"), hop: px("--cl-hop"), arrow: px("--cl-arrow"),
};
const TOK = { lineWidth: T.line, qLineWidth: T.qLine, clearance: T.clearance, hop: T.hop, arrow: T.arrow, badge: T.badge, spread: T.lane };

// ---------- 토큰으로 만든 장면(grid.js 가 DOM 에서 재는 것과 같은 모양) ----------

/** CSS 의 셀 규칙과 같은 배치: 셀 폭 = --grid-cell + 통로 수 × --cl-lane, 칩은 원래 --grid-cell 안의 가운데. */
function measure(qubitCount, grid, lanes = new Map()) {
  const cols = [];
  let x = 0;
  for (let col = 0; col < MAX_COLUMNS; col++) {
    const L = lanes.get(col) ?? { left: 0, right: 0 };
    const width = T.cell + (L.left + L.right) * T.lane;
    cols.push({ left: x, width, contentLeft: x + L.left * T.lane, L });
    x += width + T.margin;
  }
  const rowTop = (q) => q * T.cell;
  const clY = qubitCount * T.cell + T.cell / 2;
  const columns = [];
  for (let col = 0; col < MAX_COLUMNS; col++) {
    const links = columnLinks(qubitCount, col, grid[col]);
    const spansRaw = columnSpans(qubitCount, col, grid[col]);
    if (!links.length && !spansRaw.length) continue;
    const c = cols[col];
    const centerX = c.contentLeft + T.cell / 2;
    const rowCells = Array.from({ length: qubitCount }, (_, q) => ({ row: q, rect: { left: c.left, right: c.left + c.width, top: rowTop(q), bottom: rowTop(q) + T.cell } }));
    const elements = [...columnRoles(qubitCount, grid[col])].map(([q, role]) => {
      const cy = rowTop(q) + T.cell / 2;
      const half = (role.kind === "dot" ? T.dot : T.chip) / 2;
      return {
        id: `e${col}:${q}`, owner: `${col}:${role.home}`, row: q, kind: role.kind,
        rect: { left: centerX - half, right: centerX + half, top: cy - half, bottom: cy + half },
        glyphHalf: role.kind === "symbol" ? T.chip / 4 : undefined,
      };
    });
    const spans = spansRaw.map((s) => ({ ...s, top: rowTop(s.minQ) + T.cell / 2, bottom: rowTop(s.maxQ) + T.cell / 2 }));
    const laneXs = {
      left: Array.from({ length: c.L.left }, (_, i) => c.contentLeft - (i + 0.5) * T.lane),
      right: Array.from({ length: c.L.right }, (_, i) => c.contentLeft + T.cell + (i + 0.5) * T.lane),
    };
    columns.push({ col, centerX, rowCells, elements, links, spans, lanes: laneXs });
  }
  return { clY, columns };
}

/** 계획 → 넓힌 장면 → 그림. grid.js 의 두 단계와 같다. */
function render(qubitCount, grid) {
  const plan = planGrid(measure(qubitCount, grid), TOK);
  const lanes = new Map([...plan].filter(([, l]) => l.left + l.right > 0));
  const drawn = drawGrid(measure(qubitCount, grid, lanes), plan, TOK);
  return { plan, drawn };
}

// ---------- 장면 ----------

const C = (gate, targets, controls = [], params = {}) => ({ gate, targets, controls, params });
function make(n, cells) {
  const g = Array.from({ length: MAX_COLUMNS }, () => new Array(n).fill(null));
  for (const [col, cell] of cells) g[col][cell.targets[0]] = cell;
  return { n, grid: g };
}
const preset = (name) => { const d = decodeCircuit(PRESETS.find((p) => p.name === name).circuit); return { n: d.qubitCount, grid: d.grid }; };
const applied = (s) => { const p = parseQASM(toQASM(s.n, s.grid, s.n).code); return { n: p.qubitCount, grid: p.grid }; };

const SCENES = {
  "텔레포테이션 프리셋": preset("Quantum teleportation"),
  "Apply 한 텔레포테이션": applied(preset("Quantum teleportation")),
  "예전 링크 (a) — 조건부 리셋 아래 측정": make(3, [[0, C("H", [0])], [0, C("X", [1])], [0, C("X", [2])], [1, C("MEASURE", [0], [], { cbit: 0 })],
    [2, C("RESET", [1], [], { cif: 0 })], [2, C("MEASURE", [2], [], { cbit: 1, cif: 0 })]]),
  "b2 — 조건부 측정 아래 측정": make(3, [[0, C("H", [0])], [0, C("X", [1])], [1, C("MEASURE", [0], [], { cbit: 1, cif: 0 })], [1, C("MEASURE", [1], [], { cbit: 0 })], [2, C("H", [0])]]),
  "R1 같은 열에 측정 둘 + 조건부 둘": make(4, [[0, C("H", [0])], [0, C("H", [1])], [1, C("MEASURE", [0], [], { cbit: 0 })], [1, C("MEASURE", [1], [], { cbit: 1 })],
    [1, C("X", [2], [], { cif: 0 })], [1, C("Z", [3], [], { cif: 1 })]]),
  "R2 CX(q0→q2) 사이에 측정 q1": make(3, [[0, C("H", [0])], [1, C("X", [2], [0])], [1, C("MEASURE", [1], [], { cbit: 0 })]]),
  "R3 조건부 CX(q3→q1) 사이에 측정 q2": make(4, [[0, C("H", [0])], [0, C("H", [2])], [1, C("MEASURE", [0], [], { cbit: 0 })], [2, C("X", [1], [3], { cif: 0 })], [2, C("MEASURE", [2], [], { cbit: 1 })]]),
  "R4 측정 선이 배리어 · H 를 지난다": make(3, [[0, C("H", [0])], [1, C("MEASURE", [0], [], { cbit: 0 })], [1, C("BARRIER", [1])], [1, C("H", [2])]]),
  "R5 측정 선이 SWAP 을 지난다": make(3, [[0, C("H", [0])], [1, C("MEASURE", [0], [], { cbit: 0 })], [1, C("SWAP", [1, 2])]]),
  "R6 CX(q0→q2) 사이에 X q1": make(3, [[0, C("H", [0])], [1, C("X", [2], [0])], [1, C("X", [1])]]),
  "R7 조건부 H q0 아래 X q1 · CX(q3→q2)": make(4, [[0, C("H", [0])], [1, C("MEASURE", [0], [], { cbit: 0 })], [2, C("H", [0], [], { cif: 0 })], [2, C("X", [1])], [2, C("X", [2], [3])]]),
  "R8 조건부 CX(q0→q2, ⊕ 가 맨 아래) 사이에 측정 q1": make(3, [[0, C("H", [0])], [1, C("MEASURE", [0], [], { cbit: 0 })], [2, C("X", [2], [0], { cif: 0 })], [2, C("MEASURE", [1], [], { cbit: 0 })]]),
  "끝 열에서 모두 측정(6큐비트)": make(6, Array.from({ length: 6 }, (_, q) => [1, C("MEASURE", [q], [], { cbit: q })]).concat([[0, C("H", [0])]])),
  "겹친 두 span(CX q0→q3 안에 CX q1→q2)": make(4, [[0, C("X", [3], [0])], [0, C("X", [2], [1])]]),
  // 안쪽 게이트에 조건이 붙으면 읽는 선이 ⊕(q2) 중심에서 곧게 나와 바깥 제어선 위를 지난다 — 바깥 선이 그 고전 조각 둘레에서도 끊겨야 한다.
  "조건부 CX(q1→q2) 가 CX(q0→q3) 안에": make(4, [[0, C("H", [1])], [1, C("MEASURE", [1], [], { cbit: 0 })], [2, C("X", [3], [0])], [2, C("X", [2], [1], { cif: 0 })]]),
};
for (const p of PRESETS) SCENES[`프리셋 ${p.name}`] ??= preset(p.name);

// ---------- 부등식(경로가 성립하는 조건) ----------

test("격자 토큰이 경로가 성립하는 부등식을 지킨다 — 세로 틈에 꺾는 선이 들어가고, 통로 간격에 배지가 들어간다", () => {
  // 꺾는 가로 구간은 출발 칸의 아래 경계(칸 사이 세로 틈의 가운데)를 지난다. 위아래 칩과 여유만큼 떨어지려면 틈이 그만큼 커야 한다.
  assert.ok(T.cell - T.chip >= T.line + 2 * T.clearance,
    `세로 틈 ${T.cell - T.chip}px < 이중선 ${T.line}px + 2 × 여유 ${T.clearance}px — 꺾는 선이 위아래 칩에 닿는다`);
  // 이웃 통로(그리고 곧게 벌린 선)의 배지가 겹치지 않으려면 통로 간격이 배지 폭 + 틈 이상이어야 한다.
  assert.ok(T.lane >= T.badge + T.badgeGap, `통로 간격 ${T.lane}px < 배지 ${T.badge}px + 틈 ${T.badgeGap}px — 이웃 배지가 겹친다`);
  // 제어선을 끊는 틈이 판정 여유보다 작으면 끊긴 조각이 지나는 칩에 "닿은" 것으로 읽힌다.
  assert.ok(T.hop >= T.clearance, `끊기 틈 ${T.hop}px < 판정 여유 ${T.clearance}px`);
});

// ---------- 색: 고전 선의 대비와 위계 ----------

/** 별칭을 따라 #RRGGBB 를 돌려준다. */
function hex(name, seen = []) {
  assert.ok(TOKENS.has(name), `:root 에 토큰이 없다: ${name}`);
  const v = TOKENS.get(name);
  const alias = v.match(/^var\((--[\w-]+)\)$/);
  if (alias) return hex(alias[1], [...seen, name]);
  assert.match(v, /^#[0-9a-fA-F]{6}$/, `${name} 가 #RRGGBB 가 아니다: ${v}`);
  return v;
}
// WCAG 상대 휘도 · 대비비 — test/colors.test.mjs 와 같은 식(테스트 파일끼리는 임포트하지 않는다).
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const over = (fg, bg, alpha) => fg.map((v, i) => v * alpha + bg[i] * (1 - alpha));
const rule = (selector) => {
  const m = CSS.match(new RegExp(`${selector.replace(/[.]/g, "\\.")}\\s*\\{([^}]*)\\}`));
  assert.ok(m, `style.css 에 ${selector} 규칙이 없다`);
  return m[1];
};

test("고전 선은 불투명한 토큰 색 하나로 카드 · 열 강조 · 드롭 강조 위 3:1 을 넘고, 양자 제어선보다 옅다 — 위계가 남는다", () => {
  // 예전엔 --text-body × opacity .55 로 2.1:1 이었다(칩 뒤를 지나는 선이 물러나 보이게). 선이 칩을 지나지 않게 되면서 그 이유가 사라졌다.
  const strokeRule = rule(".cl-lines .cl-stroke");
  assert.match(strokeRule, /stroke:\s*var\(--cl-stroke\)/, "고전 선 색이 --cl-stroke 토큰이 아니다");
  assert.doesNotMatch(strokeRule, /opacity/, "고전 선에 불투명도가 남았다 — 대비는 토큰 색 하나로 맞춘다");
  const line = rgb(hex("--cl-stroke"));
  const backgrounds = { 카드: hex("--card-bg"), "열 강조": hex("--accent-3"), "드롭 강조": hex("--primary-dim") };
  for (const [name, bg] of Object.entries(backgrounds)) {
    const r = contrast(line, rgb(bg));
    assert.ok(r >= 3, `고전 선의 대비가 ${name}(${bg}) 위에서 ${r.toFixed(2)}:1 — 비텍스트 3:1(WCAG 1.4.11) 미달`);
  }
  // 위계: 양자 제어선(.gate-connector 의 배경 × 불투명도)이 카드 위에서 더 진하다.
  const q = rule(".gate-connector");
  const qColor = hex(q.match(/background:\s*var\((--[\w-]+)\)/)[1]);
  const qAlpha = Number(q.match(/opacity:\s*([\d.]+)/)?.[1] ?? 1);
  const card = rgb(hex("--card-bg"));
  const quantum = contrast(over(rgb(qColor), card, qAlpha), card), classical = contrast(line, card);
  assert.ok(quantum > classical, `양자 제어선(${quantum.toFixed(2)}:1)이 고전 선(${classical.toFixed(2)}:1)보다 옅다 — 위계가 뒤집혔다`);
});

// ---------- 판정 ----------

test("판정 규칙: 자기 끝점 칩만 닿을 수 있고, 다른 선 · 같은 게이트의 다른 고전 선과는 여유만큼 떨어져야 한다", () => {
  const r = (left, top, right, bottom) => ({ left, top, right, bottom });
  const chipA = { id: "chipA", kind: "element", owner: "A", rect: r(0, 0, 40, 40) };
  const seg = (id, owner, line, rect) => ({ id, kind: "segment", owner, line, rect });
  // 자기 칩은 닿아도 된다, 남의 칩은 안 된다.
  assert.deepEqual(conflicts([chipA, seg("a1", "A", "La", r(18, 20, 22, 90))], 2), []);
  assert.deepEqual(conflicts([chipA, seg("b1", "B", "Lb", r(18, 20, 22, 90))], 2), [["chipA", "b1"]]);
  // 다른 선끼리 겹치면 걸린다 — 같은 선의 조각끼리는 이어지므로 빠진다.
  assert.deepEqual(conflicts([seg("a1", "A", "La", r(0, 0, 4, 50)), seg("b1", "B", "Lb", r(-10, 20, 30, 24))], 2), [["a1", "b1"]]);
  assert.deepEqual(conflicts([seg("a1", "A", "La", r(0, 0, 4, 50)), seg("a2", "A", "La", r(-10, 46, 30, 50))], 2), []);
  // 같은 게이트라도 고전 선 둘(조건부 측정의 읽기 · 쓰기)은 서로 겹치면 안 된다. 같은 게이트의 양자선과 고전 선은 빠진다.
  assert.deepEqual(conflicts([seg("r", "A", "Lr", r(0, 0, 4, 50)), seg("w", "A", "Lw", r(2, 0, 6, 50))], 2), [["r", "w"]]);
  assert.deepEqual(conflicts([seg("q", "A", undefined, r(0, 0, 2, 50)), seg("w", "A", "Lw", r(0, 40, 4, 90))], 2), []);
  // 여유: 1px 떨어진 것은 여유 2px 에서 걸리고, 3px 떨어진 것은 걸리지 않는다.
  assert.deepEqual(conflicts([seg("a", "A", "La", r(0, 0, 4, 50)), seg("b", "B", "Lb", r(5, 0, 9, 50))], 2), [["a", "b"]]);
  assert.deepEqual(conflicts([seg("a", "A", "La", r(0, 0, 4, 50)), seg("b", "B", "Lb", r(7, 0, 11, 50))], 2), []);
});

test("그린 선은 자기 끝점 칩 말고는 어떤 칩 · 점 · 다른 선 · 배지 · 화살표와도 겹치지 않는다 — 실측 장면 전부", () => {
  const problems = [];
  for (const [name, s] of Object.entries(SCENES)) {
    const { drawn } = render(s.n, s.grid);
    const found = conflicts(drawn.items, T.clearance);
    if (found.length) problems.push(`${name}: ${found.slice(0, 3).map((p) => p.join(" × ")).join(", ")}`);
  }
  assert.deepEqual(problems, [], `${problems.length}개 장면이 겹친다: ${problems.join(" | ")}`);
});

test("판정은 칩 · 다른 선 · 배지를 본다 — 예전처럼 곧게 내린 그림은 실측 장면에서 걸린다(판정이 비어 있지 않다)", () => {
  // 대조: 통로 없이(계획을 무시하고) 그리면 예전 그림이다. 실측에서 걸린 장면은 여기서도 걸려야 한다.
  for (const name of ["예전 링크 (a) — 조건부 리셋 아래 측정", "Apply 한 텔레포테이션", "R2 CX(q0→q2) 사이에 측정 q1", "R5 측정 선이 SWAP 을 지난다"]) {
    const s = SCENES[name];
    // 빈 계획 = 통로 없음, 틈 −∞ = 제어선도 끊지 않는다 → 예전 그림.
    const flat = drawGrid(measure(s.n, s.grid), new Map(), { ...TOK, hop: -Infinity });
    assert.ok(conflicts(flat.items, T.clearance).length > 0, `${name}: 예전 그림인데 판정이 겹침을 못 찾았다`);
  }
});

test("걸리는 것이 없는 열은 통로 없이 예전처럼 곧게 내린다 — 교차가 없던 프리셋의 선 배치는 바뀌지 않는다", () => {
  const s = make(2, [[0, C("H", [0])], [0, C("X", [1])], [1, C("MEASURE", [1], [], { cbit: 1 })], [2, C("X", [0], [1])]]);
  const { plan, drawn } = render(s.n, s.grid);
  assert.deepEqual(plan.get(1), { left: 0, right: 0 });
  const col = drawn.columns.find((c) => c.col === 1);
  assert.equal(col.routed, false);
  const [line] = col.classical;
  assert.equal(line.points.length, 2, "곧은 선이 아니다");
  assert.equal(line.points[0].x, line.points[1].x);
  assert.equal(line.badge.x, line.points[0].x);
  // 제어선이 지나는 것이 없으면 조각 하나 — 예전 선 그대로다.
  assert.equal(drawn.columns.find((c) => c.col === 2).quantum[0].pieces.length, 1);
  // 교차가 없던 프리셋(텔레포테이션 말고 열 개)은 통로를 쓰지 않는다.
  for (const p of PRESETS.filter((x) => x.name !== "Quantum teleportation")) {
    const ps = preset(p.name);
    const lanes = [...render(ps.n, ps.grid).plan.values()].filter((l) => l.left + l.right > 0);
    assert.deepEqual(lanes, [], `${p.name}: 교차가 없던 프리셋에 통로가 생겼다`);
  }
});

// ---------- 경로 규칙 ----------

test("통로가 여럿이면 아래 행의 선이 안쪽 통로, 위 행의 선이 바깥 통로를 쓴다 — 고전 선끼리 교차하지 않는다", () => {
  const s = SCENES["끝 열에서 모두 측정(6큐비트)"];
  const { plan, drawn } = render(s.n, s.grid);
  assert.deepEqual(plan.get(1), { left: 0, right: 6 });
  const col = drawn.columns.find((c) => c.col === 1);
  const byRow = col.classical.map((c) => ({ row: Number(c.id.split(":")[1]), laneX: c.badge.x })).sort((a, b) => a.row - b.row);
  for (let i = 1; i < byRow.length; i++) {
    assert.ok(byRow[i].laneX < byRow[i - 1].laneX, `q${byRow[i].row} 의 통로가 q${byRow[i - 1].row} 보다 바깥이다`);
  }
  // R1: 쓰기 둘(오른쪽) · 읽기 둘(왼쪽) — 쪽마다 같은 규칙.
  const r1 = render(SCENES["R1 같은 열에 측정 둘 + 조건부 둘"].n, SCENES["R1 같은 열에 측정 둘 + 조건부 둘"].grid);
  assert.deepEqual(r1.plan.get(1), { left: 2, right: 2 });
});

test("조건 붙은 측정의 읽는 선과 쓰는 선은 칩의 반대쪽으로 나가고, 배지는 각자의 통로 x 에 놓인다", () => {
  const s = SCENES["b2 — 조건부 측정 아래 측정"];
  const col = render(s.n, s.grid).drawn.columns.find((c) => c.col === 1);
  const read = col.classical.find((c) => c.id === "1:0:read");
  const write = col.classical.find((c) => c.id === "1:0:write");
  const chipCenter = (read.points[0].x + write.points[0].x) / 2;
  assert.ok(read.points[0].x < chipCenter && write.points[0].x > chipCenter, "읽기 · 쓰기가 같은 쪽으로 나간다");
  assert.ok(read.badge.x < chipCenter && write.badge.x > chipCenter, "읽는 선은 왼쪽, 쓰는 선은 오른쪽 통로여야 한다");
  for (const c of col.classical) assert.equal(c.badge.x, c.points.at(-1).x, `${c.id}: 배지가 통로 x 에 있지 않다`);
});

test("화살표: 쓰는 선은 고전 와이어 쪽 끝에서 아래(▼)로 배지에 닿고, 읽는 선은 칩 쪽 끝에서 위(▲)로 출발 요소에 닿는다", () => {
  for (const name of ["b2 — 조건부 측정 아래 측정", "R3 조건부 CX(q3→q1) 사이에 측정 q2", "R8 조건부 CX(q0→q2, ⊕ 가 맨 아래) 사이에 측정 q1", "텔레포테이션 프리셋"]) {
    const s = SCENES[name];
    const { plan, drawn } = render(s.n, s.grid);
    const widened = measure(s.n, s.grid, new Map([...plan].filter(([, l]) => l.left + l.right > 0)));
    for (const col of drawn.columns) {
      for (const c of col.classical) {
        const [tip, b1] = c.arrow.points;
        if (c.kind === "write") {
          assert.ok(b1.y < tip.y, `${name} ${c.id}: 쓰는 선 화살표가 아래를 향하지 않는다`);
          assert.equal(tip.y, c.badge.y - T.badge / 2, `${name} ${c.id}: 쓰는 선 화살표가 배지 위에 닿지 않는다`);
        } else {
          assert.ok(b1.y > tip.y, `${name} ${c.id}: 읽는 선 화살표가 위를 향하지 않는다`);
          // 꼭짓점 = 출발 요소의 접점: 칩 · 점은 아래 가장자리, ⊕ · × 는 글리프 아래(중심 + 글리프 반지름).
          const row = Number(c.id.split(":")[1]);
          const link = widened.columns.find((x) => x.col === col.col).links.find((l) => l.id === c.id);
          const el = widened.columns.find((x) => x.col === col.col).elements.find((e) => e.row === link.row);
          const contact = el.kind === "symbol" ? (el.rect.top + el.rect.bottom) / 2 + el.glyphHalf : el.rect.bottom;
          assert.ok(Number.isFinite(row));
          assert.equal(tip.y, contact, `${name} ${c.id}: 읽는 선 화살표가 출발 요소(${el.kind})에 닿지 않는다`);
        }
      }
    }
  }
});

test("• · ⊕ 에서 나가는 읽는 선은 요소 중심에서 곧게 아래로 나온다 — 상자 칩의 모서리 규칙은 40×40 칩에만 쓴다", () => {
  for (const [name, row, kind] of [["R3 조건부 CX(q3→q1) 사이에 측정 q2", 3, "dot"], ["R8 조건부 CX(q0→q2, ⊕ 가 맨 아래) 사이에 측정 q1", 2, "symbol"]]) {
    const s = SCENES[name];
    const m = measure(s.n, s.grid);
    const el = m.columns.find((c) => c.col === 2).elements.find((e) => e.row === row);
    assert.equal(el.kind, kind, `전제: ${name} 의 맨 아래 요소가 ${kind} 가 아니다`);
    const read = render(s.n, s.grid).drawn.columns.find((c) => c.col === 2).classical.find((c) => c.kind === "read");
    const cx = (el.rect.left + el.rect.right) / 2;
    const [p0, p1] = read.points;
    // 넓힌 뒤의 요소 중심이므로 넓힌 장면에서 다시 잰다.
    const widened = measure(s.n, s.grid, new Map([[2, render(s.n, s.grid).plan.get(2)]]));
    const elW = widened.columns.find((c) => c.col === 2).elements.find((e) => e.row === row);
    const cxW = (elW.rect.left + elW.rect.right) / 2, cyW = (elW.rect.top + elW.rect.bottom) / 2;
    assert.ok(Number.isFinite(cx));
    assert.deepEqual(p0, { x: cxW, y: cyW }, `${name}: 읽는 선이 ${kind} 중심에서 나오지 않는다`);
    assert.equal(p1.x, cxW, `${name}: 읽는 선이 ${kind} 에서 곧게 내려오지 않는다`);
  }
});

test("양자 제어선은 관여하지 않는 ⊕ · 칩 · 다른 span 위아래에서 끊긴다 — 끊긴 틈은 지나는 것 위아래로 --cl-hop 이다", () => {
  const s = SCENES["R6 CX(q0→q2) 사이에 X q1"];
  const col = render(s.n, s.grid).drawn.columns.find((c) => c.col === 1);
  const pieces = col.quantum[0].pieces;
  assert.equal(pieces.length, 2, "X q1 의 ⊕ 둘레에서 끊기지 않았다");
  const chipTop = T.cell + (T.cell - T.chip) / 2, chipBottom = chipTop + T.chip;
  assert.equal(pieces[0].bottom, chipTop - T.hop);
  assert.equal(pieces[1].top, chipBottom + T.hop);
  // breakAround 자체: 지나는 것이 없으면 하나, 둘이 이어지면 틈 하나로 합쳐진다.
  assert.deepEqual(breakAround({ x: 0, top: 0, bottom: 100, width: 2 }, [], 4), [{ top: 0, bottom: 100 }]);
  assert.deepEqual(breakAround({ x: 0, top: 0, bottom: 100, width: 2 }, [{ left: -5, right: 5, top: 30, bottom: 40 }, { left: -5, right: 5, top: 42, bottom: 50 }], 4),
    [{ top: 0, bottom: 26 }, { top: 54, bottom: 100 }]);
});

test("이중선은 경로 양쪽으로 같은 거리에 두 줄이고, 꺾이는 모서리에서 맞물린다", () => {
  const path = [{ x: 10, y: 0 }, { x: 10, y: 20 }, { x: 40, y: 20 }, { x: 40, y: 80 }];
  const d = T.line / 2 - 0.5;
  const [a, b] = offsetPolyline(path, d);
  assert.equal(a.length, path.length);
  for (let i = 0; i < path.length; i++) {
    // 두 줄은 경로 점을 사이에 두고 마주 본다(합의 절반이 경로 점).
    assert.deepEqual({ x: (a[i].x + b[i].x) / 2, y: (a[i].y + b[i].y) / 2 }, path[i]);
  }
  // 각 조각은 축에 평행하다 — 모서리가 어긋나면 비스듬한 조각이 생긴다.
  for (const line of [a, b]) for (let i = 1; i < line.length; i++) {
    assert.ok(line[i].x === line[i - 1].x || line[i].y === line[i - 1].y, `비스듬한 조각: ${JSON.stringify([line[i - 1], line[i]])}`);
  }
  // 곧은 조각에서 두 줄 사이 거리 = 2d.
  assert.equal(Math.abs(a[0].x - b[0].x), 2 * d);
});
