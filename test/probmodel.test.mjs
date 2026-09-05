// 확률 표시 정책 순수 로직 테스트. 계약의 출처는 docs/quantum-spec.md §6 이다.
import test from "node:test";
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { probDisplay, barTooltipHTML, endianLabelText } from "../js/probmodel.js";
import { marginalClassical } from "../js/trajectory.js";

// |+⟩ 한 큐비트. 이론 확률 50/50.
const PLUS = [
  { index: 0, label: "0", re: Math.SQRT1_2, im: 0, probability: 50 },
  { index: 1, label: "1", re: Math.SQRT1_2, im: 0, probability: 50 },
];
// q0 를 재서 c0 에 쓰는 회로. marginalClassical 이 이 격자를 읽어 기록 큐비트를 찾는다.
const MEASURE_GRID = [
  [{ gate: "H", targets: [0] }],
  [{ gate: "MEASURE", targets: [0], params: { cbit: 0 } }],
];

function snapshot(over = {}) {
  return {
    hasMeasurement: false,
    usesTrajectory: false,
    qubitCount: 1,
    clbitCount: 0,
    grid: [],
    probabilities: PLUS,
    ...over,
  };
}

const AGG = { qubitProbs: [0.3, 0.7], classical: [0.25, 0.75], shots: 512 };
const pcts = (view) => view.entries.map((e) => e.probability);

// ── 분기: 무엇의 분포인가 ──────────────────────────────────────────

test("probDisplay: 측정이 없으면 probView 와 무관하게 큐비트 분포다", () => {
  for (const probView of ["classical", "qubits"]) {
    const view = probDisplay(snapshot(), { probView, aggregate: null });
    assert.equal(view.kind, "qubits");
  }
});

test("probDisplay: 측정이 있으면 probView 가 분포를 고른다", () => {
  const snap = snapshot({ hasMeasurement: true, clbitCount: 1, grid: MEASURE_GRID });
  assert.equal(probDisplay(snap, { probView: "classical", aggregate: null }).kind, "classical");
  assert.equal(probDisplay(snap, { probView: "qubits", aggregate: null }).kind, "qubits");
});

// ── 궤적 집계 vs 이론값 ───────────────────────────────────────────

test("probDisplay: 궤적 집계가 있으면 큐비트 확률은 이론값이 아니라 평균값이다", () => {
  const snap = snapshot({ hasMeasurement: true, usesTrajectory: true, clbitCount: 1, grid: MEASURE_GRID });
  const view = probDisplay(snap, { probView: "qubits", aggregate: AGG });
  assert.deepEqual(pcts(view), [30, 70]);
});

test("probDisplay: 궤적 집계가 있으면 고전 분포는 집계값을 그대로 쓴다", () => {
  const snap = snapshot({ hasMeasurement: true, usesTrajectory: true, clbitCount: 1, grid: MEASURE_GRID });
  const view = probDisplay(snap, { probView: "classical", aggregate: AGG });
  assert.deepEqual(pcts(view), [25, 75]);
});

test("probDisplay: 궤적이 필요 없으면 고전 분포는 이론 주변화와 정확히 같다", () => {
  const snap = snapshot({ hasMeasurement: true, clbitCount: 1, grid: MEASURE_GRID });
  const view = probDisplay(snap, { probView: "classical", aggregate: null });
  const theory = marginalClassical(1, 1, MEASURE_GRID, [0.5, 0.5]).map((p) => p * 100);
  assert.deepEqual(pcts(view), theory);
});

test("probDisplay: usesTrajectory 여도 집계가 아직 없으면 이론값으로 그린다", () => {
  const snap = snapshot({ hasMeasurement: true, usesTrajectory: true, clbitCount: 1, grid: MEASURE_GRID });
  const view = probDisplay(snap, { probView: "classical", aggregate: null });
  assert.deepEqual(pcts(view), [50, 50]);
  assert.equal(view.axis, "Probability (%)"); // 집계값인 척하지 않는다
});

// ── 고전 막대 계약: 진폭도 위상도 없다 ─────────────────────────────

test("probDisplay: 고전 항목에는 진폭도 위상도 없다 — 0 이 아니라 null 이다", () => {
  const snap = snapshot({ hasMeasurement: true, clbitCount: 1, grid: MEASURE_GRID });
  const view = probDisplay(snap, { probView: "classical", aggregate: null });
  for (const e of view.entries) {
    assert.equal(e.re, null);
    assert.equal(e.im, null);
  }
});

test("probDisplay: 궤적 평균은 확률만 갈아끼우고 스냅샷의 진폭은 그대로 둔다", () => {
  const snap = snapshot({ hasMeasurement: true, usesTrajectory: true, clbitCount: 1, grid: MEASURE_GRID });
  const view = probDisplay(snap, { probView: "qubits", aggregate: AGG });
  assert.equal(view.entries[0].re, Math.SQRT1_2);
  assert.equal(view.entries[0].im, 0);
});

test("barTooltipHTML: 고전 막대는 진폭·위상 행을 아예 내지 않는다", () => {
  const entry = { index: 1, label: "1", re: null, im: null, probability: 75 };
  const html = barTooltipHTML(entry, null, { axis: "Probability (%)" });
  assert.ok(!html.includes("Amplitude"));
  assert.ok(!html.includes("Phase"));
});

test("barTooltipHTML: 큐비트 막대는 진폭과 위상 행을 낸다", () => {
  const html = barTooltipHTML(PLUS[0], null, { axis: "Probability (%)" });
  assert.ok(html.includes("Amplitude"));
  assert.ok(html.includes("Phase"));
});

// ── 툴팁이 값의 출처를 밝힌다 ──────────────────────────────────────

test("barTooltipHTML: 축이 shots 면 Estimated, 아니면 Theoretical 이다", () => {
  const theory = barTooltipHTML(PLUS[0], null, { axis: "Probability (%)" });
  const sampled = barTooltipHTML(PLUS[0], null, { axis: "Probability (% of 512 shots)" });
  assert.ok(theory.includes("Theoretical"));
  assert.ok(!theory.includes("Estimated"));
  assert.ok(sampled.includes("Estimated"));
});

test("barTooltipHTML: 관측 행은 sample 을 넘겼을 때만 붙는다", () => {
  const view = { axis: "Probability (%)" };
  assert.ok(!barTooltipHTML(PLUS[1], null, view).includes("Observed"));
  const html = barTooltipHTML(PLUS[1], { counts: [7, 3], shots: 10 }, view);
  assert.ok(html.includes("Observed"));
  assert.ok(html.includes("3 / 10"));
  assert.ok(html.includes("30.00%"));
});

// ── 엔디언 라벨 ──────────────────────────────────────────────────

test("endianLabelText: q0 가 오른쪽 끝이다 (little-endian, Qiskit 관례)", () => {
  assert.equal(endianLabelText(3), "|q2 q1 q0⟩");
  assert.equal(endianLabelText(2, "c"), "|c1 c0⟩");
});

test("endianLabelText: 0비트는 |⟩, 1비트는 |q0⟩ 다", () => {
  assert.equal(endianLabelText(0), "|⟩");
  assert.equal(endianLabelText(1), "|q0⟩");
});

test("probDisplay: 라벨 접두사가 어느 분포인지 드러낸다 — 큐비트 q, 고전 c", () => {
  const snap = snapshot({ hasMeasurement: true, qubitCount: 2, clbitCount: 2, usesTrajectory: true });
  const agg = { qubitProbs: [0.25, 0.25, 0.25, 0.25], classical: [0.25, 0.25, 0.25, 0.25], shots: 8 };
  const four = [0, 1, 2, 3].map((i) => ({ index: i, label: "", re: 0.5, im: 0, probability: 25 }));
  assert.equal(probDisplay({ ...snap, probabilities: four }, { probView: "qubits", aggregate: agg }).endian, "|q1 q0⟩");
  assert.equal(probDisplay({ ...snap, probabilities: four }, { probView: "classical", aggregate: agg }).endian, "|c1 c0⟩");
});

// ── 축 제목 ──────────────────────────────────────────────────────

test("probDisplay: 축 제목이 shots 수를 밝혀 집계값과 이론값을 섞어 읽지 않게 한다", () => {
  const snap = snapshot({ hasMeasurement: true, usesTrajectory: true, clbitCount: 1, grid: MEASURE_GRID });
  assert.equal(probDisplay(snap, { probView: "qubits", aggregate: AGG }).axis, "Probability (% of 512 shots)");
  assert.equal(probDisplay(snap, { probView: "classical", aggregate: AGG }).axis, "Probability (% of 512 shots)");
  assert.equal(probDisplay(snapshot(), { probView: "qubits", aggregate: null }).axis, "Probability (%)");
});

// ── 경계 ─────────────────────────────────────────────────────────

test("probDisplay: probabilities 가 비어도 던지지 않는다", () => {
  const view = probDisplay(snapshot({ qubitCount: 0, probabilities: [] }), { probView: "qubits", aggregate: null });
  assert.deepEqual(view.entries, []);
  assert.equal(view.bits, 0);
  assert.equal(view.endian, "|⟩");
});

test("probDisplay: 고전 비트가 0개면 막대 하나에 확률이 전부 모인다", () => {
  const snap = snapshot({ hasMeasurement: true, clbitCount: 0 });
  const view = probDisplay(snap, { probView: "classical", aggregate: null });
  assert.equal(view.entries.length, 1);
  assert.equal(view.entries[0].label, "");
  assert.equal(view.entries[0].probability, 100);
});

test("probDisplay: 고전 라벨은 clbitCount 자리를 빠짐없이 채운다", () => {
  const snap = snapshot({ hasMeasurement: true, usesTrajectory: true, clbitCount: 2 });
  const agg = { qubitProbs: [0.5, 0.5], classical: [0.4, 0.3, 0.2, 0.1], shots: 10 };
  const view = probDisplay(snap, { probView: "classical", aggregate: agg });
  assert.deepEqual(view.entries.map((e) => e.label), ["00", "01", "10", "11"]);
});

// ── 경계를 누가 지키는가 ──────────────────────────────────────────

test("probDisplay: aggregate 길이를 검사하지 않는다 — 어긋난 집계는 scheduleAggregate 가 먼저 버린다", () => {
  // 길이가 맞는지 보는 것은 이 함수의 일이 아니다. 그 무효화는 scheduleAggregate 가
  // 서명 불일치 직후에 한다(js/probview.js). 여기 남긴 단언은 그 무효화가 사라지면
  // 화면에 무엇이 뜨는지를 말해준다 — NaN 막대다.
  const four = [0, 1, 2, 3].map((i) => ({ index: i, label: "", re: 0.5, im: 0, probability: 25 }));
  const snap = snapshot({ hasMeasurement: true, usesTrajectory: true, qubitCount: 2, probabilities: four });
  const view = probDisplay(snap, { probView: "qubits", aggregate: AGG }); // qubitProbs 는 2개뿐
  assert.equal(view.entries.length, 4);
  assert.ok(Number.isNaN(view.entries[2].probability));
});

test("probDisplay: 넘겨받은 aggregate 를 변형하지 않는다 — probview 가 내부 객체를 그대로 넘긴다", () => {
  // probview 의 getAggregate() 는 방어 복사 없이 캐시 객체 참조를 그대로 준다.
  // 그 캐시를 지키는 것은 probDisplay 의 순수성뿐이라 여기서 고정한다.
  const snap = snapshot({ hasMeasurement: true, usesTrajectory: true, clbitCount: 1, grid: MEASURE_GRID });
  // 공유 상수 AGG 를 쓰지 않는다 — 변형이 실제로 일어나면 다른 테스트까지 오염된다.
  const agg = { qubitProbs: [0.3, 0.7], classical: [0.25, 0.75], shots: 512 };

  // 두 분기가 읽는 필드가 다르다(qubitProbs vs classical). 한쪽이 어겨도 다른 쪽의
  // 결과를 볼 수 있도록 둘 다 돌린 뒤 모아서 단언한다 — 어느 분기가 범인인지 나온다.
  const touched = [];
  for (const probView of ["qubits", "classical"]) {
    const before = structuredClone(agg);
    probDisplay(snap, { probView, aggregate: agg });
    if (!isDeepStrictEqual(agg, before)) touched.push(probView);
  }
  assert.deepStrictEqual(touched, []);
});
