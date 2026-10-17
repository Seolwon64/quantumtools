// 손대지 않은 각도는 바뀌지 않는다 — 파라미터 편집기 Apply·QASM Apply 왕복·공유 URL 왕복.
//
// 예전엔 셋 다 사용자가 움직이지 않은 각도를 바꿨다. 편집기는 슬라이더(정수 도)로 모든 파라미터를 다시 써 θ 만 움직여도
// φ·λ 가 1° 단위로 양자화됐고(1.235 → 1.239), QASM 내보내기와 공유 URL 은 각도를 소수 6자리로 잘랐다(1e-7 → 0).
// 비교는 전부 === 다 — "거의 같다" 를 허용하면 바로 그 차이가 이 버그였다.
import test from "node:test";
import assert from "node:assert/strict";

import { shownDegree, editedParams } from "../js/popover.js";
import { toQASM, encodeCircuit, decodeCircuit } from "../js/export.js";
import { parseQASM } from "../js/qasm.js";
import { createCircuitController, MAX_COLUMNS } from "../js/circuit.js";

const KEYS = ["theta", "phi", "lambda"];
const toRad = (deg) => (deg * Math.PI) / 180;

test("파라미터 편집기에서 θ 만 움직이면 φ·λ 는 원래 값과 === 로 같다", () => {
  const params = { theta: 0.5, phi: 1.235, lambda: 2.346 };
  const shown = KEYS.map((k) => shownDegree(params[k]));
  assert.deepEqual(shown, [29, 71, 134], "전제: 보이는 값이 정수 도다");

  const next = editedParams(params, KEYS, shown, [40, shown[1], shown[2]]);
  assert.equal(next.theta, toRad(40), "움직인 θ 는 슬라이더 값으로 쓴다");
  assert.equal(next.phi, 1.235, "움직이지 않은 φ 가 바뀌었다");
  assert.equal(next.lambda, 2.346, "움직이지 않은 λ 가 바뀌었다");
  assert.deepEqual(params, { theta: 0.5, phi: 1.235, lambda: 2.346 }, "원래 params 객체를 고쳐 썼다");

  // 아무것도 안 움직이면 같은 객체 — 호출부가 setParams 를 건너뛰어 헛 Undo 단계가 생기지 않는다.
  assert.equal(editedParams(params, KEYS, shown, [...shown]), params, "아무것도 안 움직였는데 새 객체가 나왔다");

  // 음수 각도는 337° 로 보인다. 손대지 않으면 −0.4 그대로다(337° × π/180 = 5.88 로 바뀌지 않는다).
  const negative = { theta: 0.5, phi: 1.235, lambda: -0.4 };
  const shownNeg = KEYS.map((k) => shownDegree(negative[k]));
  assert.equal(shownNeg[2], 337, "전제: −0.4 rad 는 337° 로 보인다");
  const nextNeg = editedParams(negative, KEYS, shownNeg, [40, shownNeg[1], shownNeg[2]]);
  assert.equal(nextNeg.lambda, -0.4, "손대지 않은 음수 λ 가 바뀌었다");
  assert.equal(nextNeg.phi, 1.235);
});

test("슬라이더에 넣는 보이는 값은 늘 0…359 의 정수라 슬라이더(0–360, 1° 눈금)가 고치지 않는다", () => {
  const cases = [0, -0, -0.4, 1.235, Math.PI / 2, 2 * Math.PI, 2 * Math.PI + 0.1, -2 * Math.PI - 0.1,
    toRad(359.6), toRad(-0.4), 1e-7, -1e-7, 1e21, -1e21];
  for (let rad = -4 * Math.PI; rad <= 4 * Math.PI; rad += 0.0137) cases.push(rad);
  for (const rad of cases) {
    const d = shownDegree(rad);
    assert.ok(Number.isInteger(d) && d >= 0 && d <= 359, `shownDegree(${rad}) = ${d} — 0…359 의 정수가 아니다`);
  }
  assert.equal(shownDegree(Math.PI / 2), 90, "배치 팝오버의 기본 θ(π/2)는 90° 로 보인다");
  assert.equal(shownDegree(toRad(359.6)), 0, "360 으로 반올림되는 값은 0 으로 감싼다");
  assert.equal(shownDegree(-0.4), 337);
});

/** U(θ, φ, λ) 를 q0 에, RX(θ) 를 q1 에 둔 회로. */
function circuitGrid(u, rxTheta) {
  const g = Array.from({ length: MAX_COLUMNS }, () => [null, null]);
  g[0][0] = { gate: "U", targets: [0], controls: [], params: { ...u } };
  g[0][1] = { gate: "RX", targets: [1], controls: [], params: { theta: rxTheta } };
  return g;
}

/** 열 위치는 왕복에서 바뀔 수 있다(QASM 은 빈 열을 압축한다) — 게이트 이름으로 찾는다. */
function find(snapshot, gate) {
  for (let col = 0; col < snapshot.grid.length; col++) {
    for (let row = 0; row < snapshot.qubitCount; row++) {
      const cell = snapshot.grid[col][row];
      if (cell?.gate === gate) return { col, row, params: cell.params };
    }
  }
  assert.fail(`회로에 ${gate} 가 없다`);
}

/** 앱의 두 적재 경로 — 코드 밴드 Apply(parseQASM → loadCircuit)와 공유 링크(decodeCircuit → loadCircuit). */
function qasmApply(c) {
  const s = c.getSnapshot();
  const { code } = toQASM(s.qubitCount, s.grid, s.clbitCount);
  const parsed = parseQASM(code);
  assert.ok(parsed.ok, `QASM 파싱 실패 — ${parsed.message}\n${code}`);
  c.loadCircuit(parsed.qubitCount, parsed.grid, parsed.clbitCount);
  return code;
}
function urlRoundTrip(c) {
  const s = c.getSnapshot();
  const dec = decodeCircuit(encodeCircuit(s.qubitCount, s.grid, s.clbitCount));
  assert.ok(dec, "공유 URL 디코딩 실패");
  c.loadCircuit(dec.qubitCount, dec.grid, dec.clbitCount);
}

test("손대지 않은 각도(π/4·1.235·1e-7)는 편집기 Apply·QASM Apply 왕복·공유 URL 왕복 셋 모두에서 === 로 남는다", () => {
  // 감시값은 정수 도로 떨어지지 않아야 한다 — 45×π/180 === π/4 라서 π/4 는 변이 (a) 를 못 잡는다.
  const c = createCircuitController({
    onChange: () => {},
    onAnimateStep: async () => {},
    initial: { qubitCount: 2, clbitCount: 2, grid: circuitGrid({ theta: 0.5, phi: Math.PI / 4, lambda: 1.235 }, 1e-7) },
  });
  const expectUntouched = (stage) => {
    const s = c.getSnapshot();
    const u = find(s, "U").params;
    assert.equal(u.phi, Math.PI / 4, `${stage}: 손대지 않은 φ(π/4)가 ${u.phi} 로 바뀌었다`);
    assert.equal(u.lambda, 1.235, `${stage}: 손대지 않은 λ(1.235)가 ${u.lambda} 로 바뀌었다`);
    assert.equal(find(s, "RX").params.theta, 1e-7, `${stage}: 손대지 않은 RX θ(1e-7)가 ${find(s, "RX").params.theta} 로 바뀌었다`);
  };

  // ① 편집기 — U 의 θ 만 움직인다. 브라우저에선 보이는 값을 슬라이더의 valueAsNumber 로 읽는데, shownDegree 가 범위·눈금
  // 안이라 같은 값이다(위 테스트).
  const u = find(c.getSnapshot(), "U");
  const shown = KEYS.map((k) => shownDegree(u.params[k]));
  const next = editedParams(u.params, KEYS, shown, [shown[0] + 10, shown[1], shown[2]]);
  assert.notEqual(next, u.params, "전제: θ 를 움직였으니 새 파라미터가 나온다");
  assert.equal(c.setParams(u.col, u.row, next).ok, true);
  assert.equal(find(c.getSnapshot(), "U").params.theta, toRad(shown[0] + 10), "전제: 움직인 θ 가 적용됐다");
  expectUntouched("편집기 Apply");

  // ② 코드 밴드 Apply — 내보낸 QASM 을 그대로 파싱해 회로를 갈아 끼운다.
  qasmApply(c);
  expectUntouched("QASM Apply 왕복");

  // ③ 공유 URL — 인코딩한 해시를 디코딩해 연다.
  urlRoundTrip(c);
  expectUntouched("공유 URL 왕복");

  // 지수 표기 — String(x) 는 |x| < 1e-6 이나 ≥ 1e21 에서 1e-7·1e+21 을 낸다. 소수점 없는 이 형태도 정확히 돌아와야 한다.
  for (const theta of [1e-7, 1.2246467991473532e-16, -1e-7, 1e21]) {
    assert.match(String(theta), /e/, `전제: ${theta} 는 지수 표기로 나간다`);
    const e = createCircuitController({
      onChange: () => {},
      onAnimateStep: async () => {},
      initial: { qubitCount: 2, clbitCount: 2, grid: circuitGrid({ theta: 0.5, phi: Math.PI / 4, lambda: 1.235 }, theta) },
    });
    const code = qasmApply(e);
    assert.ok(code.includes(`rx(${String(theta)})`), `전제: QASM 이 rx(${String(theta)}) 를 그대로 쓴다\n${code}`);
    assert.equal(find(e.getSnapshot(), "RX").params.theta, theta, `QASM Apply 왕복에서 RX θ ${theta} 가 바뀌었다`);
    urlRoundTrip(e);
    assert.equal(find(e.getSnapshot(), "RX").params.theta, theta, `공유 URL 왕복에서 RX θ ${theta} 가 바뀌었다`);
  }
});
