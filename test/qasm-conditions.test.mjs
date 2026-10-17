// 내보낸 QASM·Qiskit 이 앱과 같은 회로를 돌린다 — 조건부와 고전 비트의 순서.
//
// 앱의 조건은 "고전 비트 k 가 1" 이고, 한 열은 홈 행 순서(위 → 아래)로 돈다. 예전 내보내기는 두 가지를 어겼다.
//   · `creg c[n]; if (c==2^k)` — OpenQASM·Qiskit 은 레지스터 전체 비교로 읽어, 텔레포테이션이 Qiskit 에서 q2 (+0.356, +0.707, 0) 이 됐다
//     (정답 (+0.707, +0.707, 0), Aer 실측).
//   · 고전 비트의 쓰기 순서 — 조건이 읽은 뒤 덮어쓰는 measure 가 조건 앞으로 당겨졌고(P 1 → 0), 같은 열의 두 쓰기가 뒤집혔고,
//     12열을 다 쓴 회로는 내보내기에서 게이트 하나가 조용히 사라졌다(셀 13 → 12).
// 비교는 앱의 정확한 앙상블이다 — 붕괴 갈래를 모두 열어 가중합한다(난수 없음). 텔레포테이션은 보정이 X·Z 라 확률로는 안 보여
// Bloch 까지 본다.
import test from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";

import { toQASM, toQiskit, encodeCircuit, decodeCircuit } from "../js/export.js";
import { parseQASM } from "../js/qasm.js";
import { createCircuitController, MAX_COLUMNS, canCondition, conditionRejection } from "../js/circuit.js";
import { runTrajectory, makeRng } from "../js/trajectory.js";
import { qubitBlochVector } from "../js/density.js";
import { exportCode, exportLosses } from "../js/codepanel.js";
import { PRESETS } from "../js/presets.js";

// ---------- 정확한 앙상블 ----------

/** 회로 하나에서 여는 갈래의 상한. 넘는 회로를 만들면 테스트가 느려진다 — 무작위 회로 생성이 측정 수로 이 안에 맞춘다. */
const BRANCH_LIMIT = 1 << 10;

/**
 * 앱의 정확한 앙상블: 기저 확률, 큐비트마다 Bloch 벡터, 고전 비트 분포.
 * runTrajectory 는 k 번째 붕괴에 k 번째 난수를 쓰고 `난수 < p1` 이면 1 이라, 0 을 먹이면 1 을, 1 에 가까운 값을 먹이면 0 을
 * 강제할 수 있다. 확률 0 인 결과는 강제해도 반대가 나오므로 요청과 다른 갈래는 버린다(가중치 0).
 */
function ensemble(qubitCount, clbitCount, grid) {
  const probs = new Array(1 << qubitCount).fill(0);
  const bloch = Array.from({ length: qubitCount }, () => [0, 0, 0]);
  const classical = new Map();
  let leaves = 0;
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
    leaves++;
    assert.ok(leaves <= BRANCH_LIMIT, `갈래가 ${BRANCH_LIMIT} 를 넘었다 — 측정 수를 줄여야 한다`);
    r.state.forEach((z, i) => { probs[i] += w * (z.re * z.re + z.im * z.im); });
    for (let q = 0; q < qubitCount; q++) {
      const b = qubitBlochVector(r.state, q);
      bloch[q][0] += w * b.x; bloch[q][1] += w * b.y; bloch[q][2] += w * b.z;
    }
    const key = r.clbits.join("");
    classical.set(key, (classical.get(key) ?? 0) + w);
  })([]);
  return { probs, bloch, classical, leaves };
}

const EPS = 1e-9;

/** 두 회로의 앙상블이 같다 — 기저 확률·모든 큐비트의 Bloch·고전 비트 분포. */
function assertSameEnsemble(label, a, b) {
  const ea = ensemble(a.qubitCount, a.clbitCount, a.grid);
  const eb = ensemble(b.qubitCount, b.clbitCount, b.grid);
  ea.probs.forEach((p, i) => assert.ok(Math.abs(p - eb.probs[i]) < EPS, `${label}: 기저 ${i} 확률 ${p} → ${eb.probs[i]}`));
  ea.bloch.forEach((v, q) => v.forEach((x, k) =>
    assert.ok(Math.abs(x - eb.bloch[q][k]) < EPS, `${label}: q${q} Bloch (${v.map((t) => t.toFixed(3))}) → (${eb.bloch[q].map((t) => t.toFixed(3))})`)));
  for (const key of new Set([...ea.classical.keys(), ...eb.classical.keys()])) {
    const pa = ea.classical.get(key) ?? 0, pb = eb.classical.get(key) ?? 0;
    assert.ok(Math.abs(pa - pb) < EPS, `${label}: 고전 비트 ${key} 확률 ${pa} → ${pb}`);
  }
  return ea;
}

/** 큐비트 q 가 1 일 확률. */
const pOne = (probs, q) => probs.reduce((s, p, i) => s + ((i >> q) & 1 ? p : 0), 0);

// ---------- 앱이 만든 회로 ----------

/** 컨트롤러 API 로 회로를 만든다 — 그리드가 허용하는 것만 만들어진다(앱이 만든 회로). */
function appCircuit(qubitCount, clbitCount, build) {
  const ctl = createCircuitController({
    onChange: () => {},
    onAnimateStep: async () => {},
    initial: { qubitCount, clbitCount, grid: Array.from({ length: MAX_COLUMNS }, () => new Array(qubitCount).fill(null)) },
  });
  build(ops(ctl));
  return ctl.getSnapshot();
}

/** 실패하면 바로 알리는 조작 묶음 — 배치가 조용히 거부돼 회로가 생각과 다르면 테스트가 엉뚱한 것을 본다. */
function ops(ctl) {
  const at = (col, q) => ctl.getSnapshot().grid[col][q];
  return {
    gate(col, q, name) {
      ctl.placeGate(col, q, name);
      assert.equal(at(col, q)?.gate, name, `전제: 열 ${col} q${q} 에 ${name} 를 놓지 못했다`);
    },
    measure(col, q, bit) {
      ctl.placeGate(col, q, "MEASURE");
      assert.equal(at(col, q)?.gate, "MEASURE", `전제: 열 ${col} q${q} 에 측정을 놓지 못했다`);
      assert.equal(ctl.setClassicalBit(col, q, bit).ok, true, `전제: 열 ${col} q${q} 측정을 c${bit} 에 쓰지 못했다`);
    },
    cond(col, q, bit) {
      const r = ctl.setCondition(col, q, bit);
      assert.equal(r.ok, true, `전제: 열 ${col} q${q} 에 조건 c${bit} 를 붙이지 못했다 — ${r.reason}`);
    },
    control(col, target, control) {
      const r = ctl.addControlToGate(col, target, [control]);
      assert.equal(r.ok, true, `전제: 열 ${col} q${target} 에 제어 q${control} 를 붙이지 못했다 — ${r.reason}`);
    },
  };
}

/** 코드 밴드의 Apply 와 같은 길 — 내보낸 QASM 을 파싱해 새 컨트롤러에 싣는다. */
function exportApply(snap) {
  const { code } = toQASM(snap.qubitCount, snap.grid, snap.clbitCount);
  const parsed = parseQASM(code);
  assert.ok(parsed.ok, `Apply 실패 — ${parsed.message}\n${code}`);
  const ctl = createCircuitController({ onChange: () => {}, onAnimateStep: async () => {}, initial: parsed });
  return { ...ctl.getSnapshot(), code };
}

const lastColumn = (grid) => {
  for (let col = MAX_COLUMNS - 1; col >= 0; col--) if (grid[col].some(Boolean)) return col + 1;
  return 0;
};
const cellCount = (grid) => grid.flat().filter((c) => c && c.gate !== "CTRL").length;

/** 0c 의 실측 회로들 — 같은 열의 두 행 순서, 덮어쓰기, 12열을 다 쓴 회로, 여러 행에 걸친 조건부 게이트. */
const CASES = {
  // 같은 열: 쓰기(행 0) → 읽기(행 1). 앱은 행 순서로 돌아 새 값을 읽는다 → q1 = 1.
  S1: () => appCircuit(3, 2, (o) => { o.gate(0, 0, "X"); o.measure(1, 0, 0); o.gate(1, 1, "X"); o.cond(1, 1, 0); }),
  // 같은 열: 읽기(행 0) → 쓰기(행 1). 읽기가 먼저라 아직 0 → q0 = 0.
  S2: () => appCircuit(3, 2, (o) => { o.gate(0, 1, "X"); o.gate(1, 0, "X"); o.cond(1, 0, 0); o.measure(1, 1, 0); }),
  // 같은 열에 같은 비트를 쓰는 측정 둘 — 아래 행(q1 = 0)이 나중이다 → c0 = 0 → q2 = 0.
  S3: () => appCircuit(3, 2, (o) => { o.gate(0, 0, "X"); o.measure(1, 0, 0); o.measure(1, 1, 0); o.gate(2, 2, "X"); o.cond(2, 2, 0); }),
  // 12열을 다 쓴 회로 + S1 꼴. 예전 내보내기는 열이 넘쳐 마지막 Z 를 조용히 버렸다(셀 13 → 12).
  S4: () => appCircuit(3, 2, (o) => {
    o.measure(0, 0, 0); o.gate(0, 1, "X"); o.cond(0, 1, 0);
    for (let col = 1; col < MAX_COLUMNS; col++) o.gate(col, 1, "Z");
  }),
  // 조건이 c0 을 읽은 **뒤**에 다른 큐비트가 c0 을 덮어쓴다. 예전 내보내기가 덮어쓰기를 조건 앞으로 당겨 q1 이 1 → 0 이 됐다.
  overwrite: () => appCircuit(3, 1, (o) => {
    o.gate(0, 0, "X"); o.measure(1, 0, 0);
    o.gate(0, 1, "Z"); o.gate(1, 1, "Z"); o.gate(2, 1, "Z"); o.gate(3, 1, "X"); o.cond(3, 1, 0);
    o.gate(0, 2, "Z"); o.gate(1, 2, "Z"); o.measure(4, 2, 0);
  }),
  // 측정 q1(행 1) + 조건부 CX c=q0 → t=q3(홈 행 3). 홈 행이 아래라 측정이 먼저 → q3 = 1. "관여 큐비트 최솟값"(0)으로 세면 뒤집힌다.
  M1: () => appCircuit(4, 1, (o) => { o.gate(0, 0, "X"); o.gate(0, 1, "X"); o.measure(1, 1, 0); o.gate(1, 3, "X"); o.control(1, 3, 0); o.cond(1, 3, 0); }),
  // 조건부 CX c=q3 → t=q0(홈 행 0) + 측정 q1(행 1). CX 가 먼저 → q0 = 0. "최댓값"(3)으로 세면 뒤집힌다.
  M2: () => appCircuit(4, 1, (o) => { o.gate(0, 3, "X"); o.gate(0, 1, "X"); o.gate(1, 0, "X"); o.control(1, 0, 3); o.cond(1, 0, 0); o.measure(1, 1, 0); }),
};

/** 앱 기준 정답 — 테스트의 전제(회로가 의도한 대로 만들어졌는가)를 단언한다. */
const EXPECT = { S1: [1, 1], S2: [0, 0], S3: [2, 0], overwrite: [1, 1], M1: [3, 1], M2: [0, 0] };

test("한 열 안의 게이트는 칩이 그려진 행 순서대로 실행된다 — 여러 큐비트 게이트는 타깃 칩의 행(홈 행)에서 돈다", () => {
  // 실행기(runTrajectory)와 배치기(createPlacer)는 같은 정의(quantum.js homeRow)를 쓴다. 둘이 함께 틀리면 내보내기 왕복은 맞아 보이므로,
  // 앱 자체의 결과를 절댓값으로 못 박는다. M1 은 "관여 큐비트 최솟값"(제어 q0 의 행)으로 세면, M2 는 "최댓값"(제어 q3 의 행)으로 세면 뒤집힌다.
  const cases = [
    ["S1 쓰기(행 0) → 읽기(행 1)", CASES.S1(), 1, 1],
    ["S2 읽기(행 0) → 쓰기(행 1)", CASES.S2(), 0, 0],
    ["M1 측정 q1(행 1) → 조건부 CX c=q0·t=q3(⊕ 행 3)", CASES.M1(), 3, 1],
    ["M2 조건부 CX c=q3·t=q0(⊕ 행 0) → 측정 q1(행 1)", CASES.M2(), 0, 0],
  ];
  for (const [label, snap, q, want] of cases) {
    const p = pOne(ensemble(snap.qubitCount, snap.clbitCount, snap.grid).probs, q);
    assert.ok(Math.abs(p - want) < EPS, `${label}: P(q${q}=1) 이 ${p} — ${want} 이어야 한다(행 순서대로 돌지 않았다)`);
  }
});

/** 회로마다 검사를 돌려 실패를 모은다 — 첫 실패에서 멈추면 어느 회로들이 틀렸는지 한 번에 안 보인다. */
function collect(entries, check) {
  const problems = [];
  for (const [name, snap] of entries) {
    try { check(name, snap); } catch (e) {
      // 단언 밖의 예외(내보내기의 넘침 등)는 회로 이름이 없다 — 붙여 둔다.
      const first = e.message.split("\n")[0];
      problems.push(first.startsWith(`${name}:`) ? first : `${name}: ${first}`);
    }
  }
  // 첫 줄에 앞의 몇 개를 적는다 — 실패 요약(리포터·mutation-control)이 메시지 첫 줄만 보여 준다.
  assert.deepEqual(problems, [],
    `${problems.length}개 회로가 틀렸다: ${problems.slice(0, 6).join(" | ")}\n  ${problems.join("\n  ")}`);
}

test("내보내기 → Apply 뒤에도 고전 비트의 읽기·쓰기 순서가 앱과 같다 — 같은 열의 두 행 순서·덮어쓰기·여러 행 조건부 게이트", () => {
  // 전제는 모으지 않는다 — 회로가 의도와 다르게 만들어졌으면 비교 자체가 무의미하다.
  const entries = Object.entries(EXPECT).map(([name, [q, want]]) => {
    const snap = CASES[name]();
    const p = pOne(ensemble(snap.qubitCount, snap.clbitCount, snap.grid).probs, q);
    assert.ok(Math.abs(p - want) < EPS, `전제: ${name} 의 앱 P(q${q}=1) 이 ${p} — ${want} 이어야 한다`);
    return [name, snap];
  });
  collect(entries, (name, snap) => assertSameEnsemble(name, snap, exportApply(snap)));
});

// 무작위 앱 회로 — 시드 고정(재현 가능). 측정 수를 갈래 상한 안으로 제한해, 상한을 넘는 회로를 건너뛰어 개수가 줄지 않게 한다.
const RANDOM_CIRCUITS = 150;
const MAX_COLLAPSES = 8; // 2^8 갈래 ≤ BRANCH_LIMIT

function randomAppCircuit(rng) {
  const n = 2 + Math.floor(rng() * 3);
  const c = 1 + Math.floor(rng() * 3);
  const pick = (k) => Math.floor(rng() * k);
  return appCircuit(n, c, (o) => {
    let collapses = 0;
    const tryOp = (fn) => { try { fn(); return true; } catch { return false; } };
    for (let col = 0; col < MAX_COLUMNS; col++) {
      for (let q = 0; q < n; q++) {
        if (rng() < 0.35) continue;
        const r = rng();
        if (r < 0.3 && collapses < MAX_COLLAPSES) {
          if (tryOp(() => o.measure(col, q, pick(c)))) collapses++;
        } else if (r < 0.6) {
          if (tryOp(() => o.gate(col, q, ["X", "H", "Z"][pick(3)]))) tryOp(() => o.cond(col, q, pick(c)));
        } else if (r < 0.75) {
          if (tryOp(() => o.gate(col, q, "X"))) {
            tryOp(() => o.control(col, q, pick(n)));
            if (rng() < 0.5) tryOp(() => o.cond(col, q, pick(c)));
          }
        } else {
          tryOp(() => o.gate(col, q, ["H", "X", "S"][pick(3)]));
        }
      }
    }
  });
}

test("앱이 만든 회로는 내보내고 Apply 해도 열 수가 늘지 않고 게이트가 하나도 사라지지 않으며 같은 회로다", () => {
  const fixed = Object.entries(CASES).map(([name, make]) => [name, make()]);
  const rng = makeRng(4242);
  const random = Array.from({ length: RANDOM_CIRCUITS }, (_, i) => [`무작위 ${i}`, randomAppCircuit(rng)]);
  // 전제: 무작위 회로가 이 테스트가 막으려는 모양을 실제로 담는다.
  const full = random.filter(([, s]) => lastColumn(s.grid) === MAX_COLUMNS).length;
  const sameColumnRead = random.filter(([, s]) => s.grid.some((col) => col.some((x) =>
    x?.params?.cif !== undefined && col.some((m) => m?.gate === "MEASURE" && m.params.cbit === x.params.cif)))).length;
  assert.ok(full > 20, `전제: 12열을 다 쓴 회로가 ${full}개뿐이다`);
  assert.ok(sameColumnRead > 10, `전제: 같은 열에서 같은 비트를 쓰고 읽는 회로가 ${sameColumnRead}개뿐이다`);
  collect([...fixed, ...random], (name, snap) => {
    const back = exportApply(snap);
    assert.equal(cellCount(back.grid), cellCount(snap.grid), `${name}: 게이트 수 ${cellCount(snap.grid)} → ${cellCount(back.grid)}`);
    assert.ok(lastColumn(back.grid) <= lastColumn(snap.grid), `${name}: 열 수 ${lastColumn(snap.grid)} → ${lastColumn(back.grid)}`);
    assertSameEnsemble(name, snap, back);
  });
});

test("외부 텍스트에서 읽기가 쓰기 뒤인데 행이 위면 다음 열로 간다 — 한 열 안의 실행 순서가 뒤집히지 않는다", () => {
  // 텍스트 순서: q2 를 측정해 c 에 쓰고, 그다음 c 를 읽어 q0 을 뒤집는다. q0(행 0)은 q2(행 2)보다 위라, 같은 열에 두면 읽기가 먼저 돈다.
  const src = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[3];\ncreg c[1];\nx q[2];\nmeasure q[2] -> c[0];\nif (c==1) x q[0];\n';
  const parsed = parseQASM(src);
  assert.ok(parsed.ok, parsed.message);
  const e = ensemble(parsed.qubitCount, parsed.clbitCount, parsed.grid);
  assert.ok(Math.abs(pOne(e.probs, 0) - 1) < EPS, `P(q0=1) 이 ${pOne(e.probs, 0)} — 측정 뒤의 조건이 측정보다 먼저 돌았다`);
});

// ---------- 내보내기의 조건 표현 ----------

const cell = (gate, targets, controls = [], params = {}) => ({ gate, targets, controls, params });
function grid(qubitCount, placements) {
  const g = Array.from({ length: MAX_COLUMNS }, () => new Array(qubitCount).fill(null));
  for (const [col, c] of placements) g[col][c.targets[0]] = c;
  return g;
}
/** H q0 · H q1 · 둘 다 측정 · c[1] 이면 X q2 — 비트 의미면 P(q2=1) 0.5, 레지스터 의미(c == 2)면 0.25(Aer 실측). */
const discriminator = () => grid(3, [
  [0, cell("H", [0])], [0, cell("H", [1])],
  [1, cell("MEASURE", [0], [], { cbit: 0 })], [1, cell("MEASURE", [1], [], { cbit: 1 })],
  [2, cell("X", [2], [], { cif: 1 })],
]);
const qasmLines = (code) => code.split("\n");

test("내보낸 QASM 의 조건은 비트 하나의 뜻을 담는다 — 조건이 있고 비트가 2개 이상이면 비트마다 1비트 레지스터, 그 밖은 예전 글자 그대로", () => {
  const { code, warnings } = toQASM(3, discriminator(), 3);
  const lines = qasmLines(code);
  assert.deepEqual(lines.filter((l) => l.startsWith("creg")), ["creg c0[1];", "creg c1[1];", "creg c2[1];"]);
  assert.ok(lines.includes("measure q[0] -> c0[0];") && lines.includes("measure q[1] -> c1[0];"), code);
  assert.ok(lines.includes("if (c1==1) x q[2];"), `조건이 비트 하나의 레지스터 비교가 아니다\n${code}`);
  assert.ok(!lines.some((l) => /^if \(c==/.test(l)), `레지스터 전체 비교가 남았다 — Qiskit 이 "c 가 정확히 2" 로 읽는다\n${code}`);
  assert.deepEqual(warnings, [], "정확히 내보냈는데 경고가 붙었다");
  // 앱이 같은 텍스트를 같은 회로로 읽는다.
  const back = parseQASM(code);
  assert.ok(back.ok, back.message);
  assert.equal(back.clbitCount, 3);
  assert.equal(back.grid.flat().find((c) => c?.gate === "X").params.cif, 1);

  // 고전 비트가 하나면 `if (c==1)` 이 이미 정확하다 — 글자를 바꾸지 않는다.
  const one = toQASM(2, grid(2, [[0, cell("MEASURE", [0], [], { cbit: 0 })], [1, cell("X", [1], [], { cif: 0 })]]), 1);
  assert.ok(qasmLines(one.code).includes("creg c[1];") && qasmLines(one.code).includes("if (c==1) x q[1];"), one.code);
  assert.deepEqual(one.warnings, []);

  // 조건이 없으면 고전 비트가 몇 개든 레지스터 하나 그대로(Qiskit counts 키가 '000' 으로 남는다).
  for (const n of [1, 2, 6]) {
    const plain = toQASM(2, grid(2, [[0, cell("H", [0])], [1, cell("MEASURE", [0], [], { cbit: 0 })]]), n);
    assert.deepEqual(qasmLines(plain.code).filter((l) => l.startsWith("creg")), [`creg c[${n}];`], `clbit=${n}\n${plain.code}`);
    assert.deepEqual(plain.warnings, []);
  }
});

test("가져오기는 OpenQASM 의 뜻(레지스터 전체 비교)으로 읽는다 — 다른 비트가 먼저 쓰인 비교는 줄 번호와 이유를 붙여 거부한다", () => {
  const head = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[3];\ncreg c[3];\n';
  // Qiskit 이 판별 회로를 내보내는 꼴. 표준으로는 "c 가 정확히 2(c[0]=0, c[1]=1)" 이라 앱의 "c[1] 이 1" 과 다르다.
  const qiskitStyle = parseQASM(`${head}h q[0];\nh q[1];\nmeasure q[0] -> c[0];\nmeasure q[1] -> c[1];\nif (c==2) x q[2];\n`);
  assert.equal(qiskitStyle.ok, false, "다른 비트가 먼저 쓰였는데 비트 하나의 조건으로 읽었다");
  assert.equal(qiskitStyle.line, 9);
  assert.match(qiskitStyle.message, /compares all 3 bits of c, but c\[0\] is written on line 7/);

  // 앱이 예전에 내보낸 텔레포테이션 — 같은 이유로 거부된다(조용히 다른 회로가 되지 않는다).
  const oldTeleport = parseQASM([
    "OPENQASM 2.0;", 'include "qelib1.inc";', "qreg q[3];", "creg c[3];", "",
    "h q[0];", "h q[1];", "t q[0];", "cx q[1],q[2];", "cx q[0],q[1];", "h q[0];",
    "measure q[1] -> c[1];", "measure q[0] -> c[0];", "if (c==2) x q[2];", "if (c==1) z q[2];", "",
  ].join("\n"));
  assert.equal(oldTeleport.ok, false);
  assert.equal(oldTeleport.line, 14);
  assert.match(oldTeleport.message, /c\[0\] is written on line 13/);

  // 다른 비트가 아직 0 이면(쓰인 적이 없으면) "c == 2" 와 "c[1] == 1" 이 같은 뜻이다 — 예전 텍스트도 그대로 읽힌다.
  const sameMeaning = parseQASM(`${head}h q[0];\nmeasure q[0] -> c[1];\nif (c==2) x q[2];\n`);
  assert.ok(sameMeaning.ok, sameMeaning.message);
  assert.equal(sameMeaning.grid.flat().find((c) => c?.gate === "X").params.cif, 1);
});

test("가져오기의 조건은 레지스터 폭 안에서만 받는다 — 이어 붙인 비트 번호가 옆 레지스터로 넘어가지 않는다", () => {
  const head = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\ncreg a[2];\ncreg b[1];\n';
  const reject = (body, pattern) => {
    const r = parseQASM(head + body);
    assert.equal(r.ok, false, `받아 버렸다: ${body.trim()}`);
    assert.match(r.message, pattern, `${body.trim()} — ${r.message}`);
    assert.match(r.message, /^Line \d+: /);
  };
  // a 는 2비트 — a==4 는 비트 2 인데 이어 붙이면 b[0] 이 된다. 받으면 b 에 대한 조건으로 조용히 바뀐다.
  reject("if (a==4) x q[0];\n", /never true — a has only 2 bits/);
  // 1비트 레지스터는 1 과만 비교할 수 있다(앱의 조건은 "비트가 1").
  reject("if (b==2) x q[0];\n", /1-bit register can only be compared with 1/);
  reject("if (b==0) x q[0];\n", /1-bit register can only be compared with 1/);
  reject("measure q[0] -> a[2];\n", /classical bit index 2 is out of range \(a has 2\)/);

  const ok = (body) => {
    const r = parseQASM(head + body);
    assert.ok(r.ok, r.message);
    assert.equal(r.clbitCount, 3, "레지스터를 이어 붙인 비트 수가 아니다");
    return r.grid.flat().filter(Boolean);
  };
  const viaB = ok("measure q[0] -> b[0];\nif (b==1) x q[1];\n");
  assert.equal(viaB.find((c) => c.gate === "MEASURE").params.cbit, 2, "b[0] 은 a 의 두 비트 다음인 비트 2 다");
  assert.equal(viaB.find((c) => c.gate === "X").params.cif, 2);
  const viaA = ok("measure q[0] -> a[1];\nif (a==2) x q[1];\n");
  assert.equal(viaA.find((c) => c.gate === "X").params.cif, 1);
});

test("Qiskit 코드는 조건을 if_test 로 쓰고 c_if 를 쓰지 않는다 — Qiskit 2.0 에서 c_if 가 없어졌다", () => {
  const tele = PRESETS.find((p) => p.name === "Quantum teleportation");
  const dec = decodeCircuit(tele.circuit);
  const { code, warnings } = toQiskit(dec.qubitCount, dec.grid, dec.clbitCount);
  assert.match(code, /^qc = QuantumCircuit\(3, 3\)$/m, "레지스터 하나 그대로여야 counts 키가 '000' 으로 남는다");
  assert.match(code, /^with qc\.if_test\(\(qc\.clbits\[1\], 1\)\):\n {4}qc\.x\(2\)$/m, code);
  assert.match(code, /^with qc\.if_test\(\(qc\.clbits\[0\], 1\)\):\n {4}qc\.z\(2\)$/m, code);
  assert.doesNotMatch(code, /c_if/);
  assert.deepEqual(warnings, []);
});

test("조건 붙은 측정·리셋은 내보내기에서 조건을 잃지 않고, 가져오기·공유 링크는 같은 사유로 거부한다", () => {
  // 컨트롤러는 이런 셀을 만들지 않는다(canCondition). 내보내기는 순수 함수라 받은 그리드를 그대로 써야 한다 — 예전엔 조건을 조용히 뺐다.
  const g = grid(2, [
    [0, cell("H", [0])], [1, cell("MEASURE", [0], [], { cbit: 0 })],
    [2, cell("RESET", [1], [], { cif: 0 })], [3, cell("MEASURE", [1], [], { cbit: 1, cif: 0 })],
  ]);
  const qasm = qasmLines(toQASM(2, g, 2).code);
  assert.ok(qasm.includes("if (c0==1) reset q[1];"), `QASM 이 리셋의 조건을 뺐다\n${qasm.join("\n")}`);
  assert.ok(qasm.includes("if (c0==1) measure q[1] -> c1[0];"), `QASM 이 측정의 조건을 뺐다\n${qasm.join("\n")}`);
  const py = toQiskit(2, g, 2).code;
  assert.match(py, /^with qc\.if_test\(\(qc\.clbits\[0\], 1\)\):\n {4}qc\.reset\(1\)$/m, `Qiskit 이 리셋의 조건을 뺐다\n${py}`);
  assert.match(py, /^with qc\.if_test\(\(qc\.clbits\[0\], 1\)\):\n {4}qc\.measure\(1, 1\)$/m, `Qiskit 이 측정의 조건을 뺐다\n${py}`);

  // 가져오기는 거부한다 — 앱은 이 셋에 조건을 붙이지 않고, 받으면 화면 메뉴로 지울 수도 없다.
  const head = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[3];\ncreg c[1];\nh q[0];\nmeasure q[0] -> c[0];\n';
  for (const [stmt, gate] of [["reset q[1];", "RESET"], ["measure q[1] -> c[0];", "MEASURE"], ["barrier q[1];", "BARRIER"], ["rccx q[0],q[1],q[2];", "RCCX"]]) {
    const r = parseQASM(`${head}if (c==1) ${stmt}\n`);
    assert.equal(r.ok, false, `if (c==1) ${stmt} 를 받았다`);
    assert.equal(r.message, `Line 7: ${conditionRejection(gate)}`);
  }

  // 공유 링크도 같은 사유다. 반환 계약(실패 = null)은 그대로고, 사유는 콜백으로 온다.
  const link = encodeCircuit(2, grid(2, [[0, cell("MEASURE", [0], [], { cbit: 0 })], [1, cell("RESET", [1], [], { cif: 0 })]]), 1);
  const reasons = [];
  assert.equal(decodeCircuit(link, (r) => reasons.push(r)), null);
  assert.deepEqual(reasons, [conditionRejection("RESET")]);
  assert.equal(decodeCircuit(link), null, "콜백 없이도 null 이어야 한다");
  // 형식이 깨진 링크는 사유 없이 null 이다 — 호출부가 일반 문구를 띄운다.
  const none = [];
  assert.equal(decodeCircuit("%%%", (r) => none.push(r)), null);
  assert.deepEqual(none, []);
});

test("조건을 붙일 수 있는지는 한 함수가 정한다 — setCondition·저장 회로 적재·메뉴가 같은 답을 낸다", () => {
  for (const gate of ["X", "H", "RX", "MEASURE", "RESET", "BARRIER"]) {
    const ctl = createCircuitController({
      onChange: () => {}, onAnimateStep: async () => {},
      initial: { qubitCount: 2, clbitCount: 1, grid: Array.from({ length: MAX_COLUMNS }, () => [null, null]) },
    });
    ctl.placeGate(0, 0, gate);
    assert.equal(ctl.getSnapshot().grid[0][0]?.gate, gate, `전제: ${gate} 를 놓지 못했다`);
    const r = ctl.setCondition(0, 0, 0);
    assert.equal(r.ok, canCondition(gate), `${gate}: setCondition ${r.ok} 인데 canCondition ${canCondition(gate)}`);
    if (!r.ok) assert.equal(r.reason, conditionRejection(gate));
  }
  // 저장 회로에 조건 붙은 리셋이 있으면 적재 때 빠진다(무효 셀 정책 — docs/backlog.md). 컨트롤러가 그런 셀을 갖지 않아야
  // 앱이 내보낸 텍스트를 앱의 가져오기가 거부하는 일이 없다.
  const stored = createCircuitController({
    onChange: () => {}, onAnimateStep: async () => {},
    initial: { qubitCount: 2, clbitCount: 1, grid: grid(2, [[0, cell("MEASURE", [0], [], { cbit: 0 })], [1, cell("RESET", [1], [], { cif: 0 })]]) },
  }).getSnapshot();
  assert.equal(stored.grid.flat().filter((c) => c?.gate === "RESET").length, 0, "조건 붙은 리셋이 컨트롤러에 실렸다");
  // 메뉴는 같은 함수를 쓴다(gatemenu.js 는 DOM 모듈이라 소스로 본다) — 예전엔 같은 집합을 따로 적었다.
  const menu = readFileSync(new URL("../js/gatemenu.js", import.meta.url), "utf8");
  assert.match(menu, /canCondition\(cell\.gate\)/, "게이트 메뉴가 canCondition 을 쓰지 않는다");
  assert.doesNotMatch(menu, /NON_CONDITIONABLE/, "게이트 메뉴에 조건 불가 집합이 따로 남았다");
});

test("코드 밴드는 내보내기가 넘쳐도 던지지 않고 사유를 돌려준다 — 렌더가 멈추지 않는다", () => {
  // 같은 열에서 큐비트가 겹치는 셀(X q0 와 q0 을 제어로 쓰는 X q1)로 12열을 채운다. 컨트롤러 UI 로는 못 만들지만 공유 링크는 막지 않는다.
  const g = Array.from({ length: MAX_COLUMNS }, () => [cell("X", [0]), cell("X", [1], [0])]);
  const snap = { qubitCount: 2, clbitCount: 0, grid: g };
  assert.throws(() => toQASM(2, g, 0), /can't be exported/, "전제: 이 그리드는 내보내기를 넘치게 해야 한다");
  for (const tab of ["qasm", "qiskit"]) {
    const r = exportCode(snap, tab);
    assert.match(r.error ?? "", /can't be exported: written one operation per line it needs more than 12 columns/, `${tab}: 사유가 없다`);
    assert.equal(r.code, "");
    assert.deepEqual(r.warnings, []);
  }
  const losses = exportLosses(snap, "");
  assert.match(losses.error ?? "", /can't be exported/);
  assert.deepEqual([losses.unannounced, losses.lineDeleted], [[], []]);
  // 앱이 만든 회로에서는 사유가 없다.
  assert.equal(exportCode({ qubitCount: 3, clbitCount: 3, grid: discriminator() }, "qasm").error, null);
});
