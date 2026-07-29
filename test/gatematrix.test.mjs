// 게이트 유니터리 행렬(읽기 전용 모듈) 검증.
// 행렬은 엔진에 기저 벡터를 통과시켜 열 단위로 구성되므로, 이 테스트는 "표시되는 행렬이
// 실제 시뮬레이션과 같은 연산인가"를 고정한다.
// 실행: node --test test/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { gateMatrix, formatComplex, symbolicComplex, gateDescription, decompositionSteps } from "../js/gatematrix.js";
import { applyRCCX, RCCX_STEPS, matrixFor, applyUnitary, initialState } from "../js/quantum.js";

const cell = (gate, targets, controls = [], params = {}) => ({ gate, targets, controls, params });
const S = Math.SQRT1_2;
const near = (a, b, e = 1e-4) => Math.abs(a - b) < e;

// 행렬을 [[re,…],…] 로 (허수부가 0인 경우만 쓰는 헬퍼)
function reals(m) {
  return m.rows.map((row) => row.map((z) => Number(z.re.toFixed(4))));
}
function assertMatrix(m, expected, e = 1e-4) {
  assert.equal(m.ok, true);
  assert.equal(m.rows.length, expected.length);
  for (let r = 0; r < expected.length; r++) {
    for (let c = 0; c < expected.length; c++) {
      const got = m.rows[r][c];
      const want = expected[r][c];
      assert.ok(near(got.re, want.re ?? want, e) && near(got.im, want.im ?? 0, e),
        `(${r},${c}) = ${got.re.toFixed(3)}${got.im >= 0 ? "+" : ""}${got.im.toFixed(3)}i, 기대 ${JSON.stringify(want)}`);
    }
  }
}

test("H → [[0.707,0.707],[0.707,−0.707]]", () => {
  const m = gateMatrix(cell("H", [0]));
  assert.equal(m.size, 2);
  assertMatrix(m, [[S, S], [S, -S]]);
});

test("Z + 컨트롤 1개 → diag(1,1,1,−1) (CZ)", () => {
  const m = gateMatrix(cell("Z", [1], [0]));
  assert.equal(m.size, 4);
  assertMatrix(m, [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, -1]]);
});

test("X + 컨트롤 1개 → 교과서 CNOT 행렬", () => {
  const m = gateMatrix(cell("X", [1], [0]));
  assertMatrix(m, [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 0, 1], [0, 0, 1, 0]]);
});

test("RX(π/2) → [[0.707, −0.707i],[−0.707i, 0.707]]", () => {
  const m = gateMatrix(cell("RX", [0], [], { theta: Math.PI / 2 }));
  assertMatrix(m, [
    [{ re: S, im: 0 }, { re: 0, im: -S }],
    [{ re: 0, im: -S }, { re: S, im: 0 }],
  ]);
});

test("모든 지원 게이트의 행렬이 유니터리다 (U†U = I)", () => {
  const cases = [
    cell("H", [0]), cell("X", [0]), cell("Y", [0]), cell("Z", [0]),
    cell("S", [0]), cell("Sdg", [0]), cell("T", [0]), cell("Tdg", [0]),
    cell("SX", [0]), cell("SXdg", [0]), cell("I", [0]),
    cell("RX", [0], [], { theta: 0.7 }), cell("RY", [0], [], { theta: 1.3 }),
    cell("RZ", [0], [], { theta: -0.4 }), cell("P", [0], [], { theta: 2.1 }),
    cell("U", [0], [], { theta: 0.6, phi: 1.1, lambda: -0.3 }),
    cell("SWAP", [0, 1]), cell("SWAP", [0, 1], [2]),      // CSWAP
    cell("X", [1], [0]), cell("Z", [1], [0]),             // CNOT, CZ
    cell("X", [2], [0, 1]),                                // CCX
    cell("RXX", [0, 1], [], { theta: 0.9 }),
    cell("RYY", [0, 1], [], { theta: 0.9 }),
    cell("RZZ", [0, 1], [], { theta: 0.9 }),
    { gate: "RCCX", targets: [0, 1, 2], controls: [], params: {} },
  ];
  for (const cl of cases) {
    const m = gateMatrix(cl);
    assert.equal(m.ok, true, `${cl.gate}: ${m.reason ?? ""}`);
    const N = m.size;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        // (U†U)_{ij} = Σ_k conj(U_ki) · U_kj
        let re = 0, im = 0;
        for (let k = 0; k < N; k++) {
          const a = m.rows[k][i], b = m.rows[k][j];
          re += a.re * b.re + a.im * b.im;
          im += a.re * b.im - a.im * b.re;
        }
        const want = i === j ? 1 : 0;
        assert.ok(near(re, want) && near(im, 0), `${cl.gate}: (U†U)[${i}][${j}] = ${re.toFixed(4)}+${im.toFixed(4)}i`);
      }
    }
  }
});

test("컨트롤 순서 교환: CZ·CCX는 같은 행렬, RCCX는 다른 행렬", () => {
  assert.deepEqual(reals(gateMatrix(cell("Z", [2], [0, 1]))), reals(gateMatrix(cell("Z", [2], [1, 0]))));
  assert.deepEqual(reals(gateMatrix(cell("X", [2], [0, 1]))), reals(gateMatrix(cell("X", [2], [1, 0]))));
  const rccxAB = gateMatrix({ gate: "RCCX", targets: [0, 1, 2], controls: [], params: {} });
  const rccxBA = gateMatrix({ gate: "RCCX", targets: [1, 0, 2], controls: [], params: {} });
  assert.notDeepEqual(rccxAB.rows, rccxBA.rows); // Margolus는 두 컨트롤에 비대칭
});

test("8x8 초과는 행렬 대신 크기 안내", () => {
  const mcx = gateMatrix(cell("X", [3], [0, 1, 2])); // 제어 3개 → 16x16
  assert.equal(mcx.ok, false);
  assert.equal(mcx.tooLarge, true);
  assert.equal(mcx.size, 16);
  const rc3x = gateMatrix({ gate: "RC3X", targets: [0, 1, 2, 3], controls: [], params: {} });
  assert.equal(rc3x.tooLarge, true);
  assert.equal(rc3x.size, 16);
  // CCX(8x8)는 여전히 렌더링된다
  assert.equal(gateMatrix(cell("X", [2], [0, 1])).ok, true);
});

test("기저 라벨 + 로컬 순서 표기", () => {
  const cz = gateMatrix(cell("Z", [1], [0])); // 제어 q0, 타깃 q1
  assert.deepEqual(cz.basisLabels, ["|00⟩", "|01⟩", "|10⟩", "|11⟩"]);
  assert.equal(cz.localOrder, "local |c t⟩ = |q0 q1⟩");
  assert.equal(cz.basisLabels.length, cz.size);

  const ccx = gateMatrix(cell("X", [2], [0, 1]));
  assert.equal(ccx.basisLabels.length, 8);
  assert.deepEqual(ccx.basisLabels[0], "|000⟩");
  assert.deepEqual(ccx.basisLabels[7], "|111⟩");
  assert.equal(ccx.localOrder, "local |c₁ c₂ t⟩ = |q0 q1 q2⟩");

  const swap = gateMatrix(cell("SWAP", [0, 2]));
  assert.equal(swap.localOrder, "local |t₁ t₂⟩ = |q0 q2⟩");
});

test("비유니터리(Measure/Barrier/Reset)는 행렬 없음", () => {
  for (const g of ["MEASURE", "BARRIER", "RESET"]) {
    const m = gateMatrix(cell(g, [0]));
    assert.equal(m.ok, false);
    assert.match(m.reason, /not a unitary gate/);
  }
});

test("formatComplex: 3자리, −0은 0, 순실수/순허수는 짧게", () => {
  assert.equal(formatComplex({ re: 0.7071, im: 0 }), "0.707");
  assert.equal(formatComplex({ re: -0, im: 0 }), "0");
  assert.equal(formatComplex({ re: 0, im: 0 }), "0");
  assert.equal(formatComplex({ re: 0, im: -0.7071 }), "−0.707i");
  assert.equal(formatComplex({ re: 0.5, im: -0.5 }), "0.500 − 0.500i");
  assert.equal(formatComplex({ re: -1, im: 0 }), "-1.000");
});

test("symbolicComplex: 알려진 값만 기호 병기", () => {
  assert.equal(symbolicComplex({ re: Math.SQRT1_2, im: 0 }), "1/√2");
  assert.equal(symbolicComplex({ re: -Math.SQRT1_2, im: 0 }), "−1/√2");
  assert.equal(symbolicComplex({ re: 0, im: Math.SQRT1_2 }), "1/√2i");
  assert.equal(symbolicComplex({ re: 0, im: 0 }), null);
  assert.equal(symbolicComplex({ re: 0.3137, im: 0 }), null); // 알려지지 않은 값
});

test("gateDescription: 제어 개수를 문장에 반영", () => {
  assert.match(gateDescription(cell("X", [2], [0, 1])), /all 2 controls are \|1⟩/);
  assert.match(gateDescription(cell("X", [1], [0])), /the control is \|1⟩/);
  assert.equal(gateDescription(cell("Z", [0])), "Pauli-Z"); // 제어 없으면 GATE_INFO.desc
});

test("[B] 분해 데이터가 엔진 동작과 일치한다(추출로 동작이 안 바뀜)", () => {
  // RCCX_STEPS를 직접 적용한 결과 == applyRCCX
  const targets = [0, 1, 2];
  for (let basis = 0; basis < 8; basis++) {
    let manual = initialState(3);
    manual[0] = { re: 0, im: 0 };
    manual[basis] = { re: 1, im: 0 };
    let viaSteps = manual;
    for (const s of RCCX_STEPS) {
      const ctrl = s.control === undefined ? [] : [targets[s.control]];
      viaSteps = applyUnitary(viaSteps, targets[s.on], matrixFor(s.gate), ctrl);
    }
    const viaFn = applyRCCX(manual, 0, 1, 2);
    for (let i = 0; i < 8; i++) {
      assert.ok(near(viaSteps[i].re, viaFn[i].re) && near(viaSteps[i].im, viaFn[i].im),
        `basis ${basis}, idx ${i}`);
    }
  }
});

test("decompositionSteps: RCCX는 9스텝, 기본 게이트는 null", () => {
  const steps = decompositionSteps({ gate: "RCCX", targets: [0, 1, 2], controls: [], params: {} });
  assert.equal(steps.length, 9);
  assert.equal(steps[0].text, "H(t)");
  assert.equal(steps[2].text, "CX(c₂,t)"); // RCCX는 컨트롤이 2개라 c₁/c₂ 표기
  assert.equal(steps[0].target, 2);
  assert.equal(steps[2].control, 1);
  assert.equal(decompositionSteps(cell("H", [0])), null);
  assert.equal(decompositionSteps(cell("X", [2], [0, 1])), null); // CCX는 분해가 없다
});
