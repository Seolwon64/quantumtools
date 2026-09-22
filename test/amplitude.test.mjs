// 진폭 표시 형식 — 상태벡터 패널이 계수를 열에 나눠 넣고 소수점을 세로로 맞추는 근거.
// 형식이 깨지면 화면에서만 어긋나 눈으로만 잡히므로, 조각 분해 규칙을 여기서 고정한다.
import test from "node:test";
import assert from "node:assert/strict";
import { amplitudeParts, amplitudeShowsAsZero, fmt2, AMP_DISPLAY_EPS } from "../js/probmodel.js";

const MINUS = "−"; // U+2212 — ASCII 하이픈이 섞이면 숫자 옆에서 폭이 어긋난다

test("계수는 언제나 소수 2자리라 열 안에서 소수점이 어긋나지 않는다", () => {
  // 뒤 0 을 지우던 시절에는 0.5(1자리)와 0.71(2자리)이 섞여 어떤 정렬로도 맞출 수 없었다.
  assert.equal(amplitudeParts(0.5, 0).re, "0.50");
  assert.equal(amplitudeParts(0.7071, 0).re, "0.71");
  assert.equal(amplitudeParts(0.1, 0).re, "0.10");
  assert.equal(amplitudeParts(0, 0.5).im, "0.50");
  const complex = amplitudeParts(0.25, -0.25);
  assert.equal(complex.re, "0.25");
  assert.equal(complex.im, "0.25");
  for (const s of [complex.re, complex.im]) assert.match(s, /^\d+\.\d{2}$/);
});

test("크기 1 은 그 항이 유일한 부분일 때만 생략된다", () => {
  assert.deepEqual(amplitudeParts(1, 0), { sign: "", re: "", imSign: "", im: "", hasI: false });
  assert.deepEqual(amplitudeParts(-1, 0), { sign: MINUS, re: "", imSign: "", im: "", hasI: false });
  assert.deepEqual(amplitudeParts(0, 1), { sign: "", re: "", imSign: "", im: "", hasI: true });
  assert.deepEqual(amplitudeParts(0, -1), { sign: MINUS, re: "", imSign: "", im: "", hasI: true });
});

test("복소수에서는 1.00 이 남아 실수부·허수부가 통째로 사라지지 않는다", () => {
  // 0.996 은 1.00 으로 반올림된다. 여기서 생략하면 "+0.05i" 로 읽혀 실수부가 증발한다.
  // (경계는 0.995 가 아니다 — 0.995 는 이진수로 0.99499999999999999556 이라 0.99 로 내려간다.)
  const a = amplitudeParts(0.996, 0.05);
  assert.equal(a.re, "1.00");
  assert.equal(a.imSign, "+");
  assert.equal(a.im, "0.05");

  const b = amplitudeParts(0.05, 0.996);
  assert.equal(b.re, "0.05");
  assert.equal(b.im, "1.00");

  const c = amplitudeParts(-0.996, 0.05);
  assert.equal(c.sign, MINUS);
  assert.equal(c.re, "1.00");
});

test("음수 실수부의 부호는 행의 부호 칸이 갖는다 (ASCII 하이픈이 섞이지 않는다)", () => {
  const a = amplitudeParts(-0.25, 0.25);
  assert.equal(a.sign, MINUS);
  assert.equal(a.re, "0.25", "부호가 빠진 크기만 남아야 열이 맞는다");
  assert.equal(a.imSign, "+");
  for (const s of [a.sign, a.re, a.imSign, a.im]) assert.ok(!s.includes("-"), `ASCII 하이픈: ${s}`);
});

test("허수부 부호는 허수 칸 앞에 붙는다", () => {
  assert.equal(amplitudeParts(0.25, -0.25).imSign, MINUS);
  assert.equal(amplitudeParts(0.25, 0.25).imSign, "+");
  assert.equal(amplitudeParts(0.5, 0).imSign, "", "실수에는 허수 부호가 없다");
});

test("순허수는 실수 칸이 비고 i 칸이 선다", () => {
  const a = amplitudeParts(0, 0.7071);
  assert.equal(a.re, "");
  assert.equal(a.im, "0.71");
  assert.equal(a.hasI, true);
  assert.equal(amplitudeParts(0.7071, 0).hasI, false, "실수에는 i 가 없다");
});

test("반올림해서 0.00 이 되는 값에는 부호를 붙이지 않는다", () => {
  // "− 0.00" 은 읽는 사람에게 -0 과 같은 말이다. fmt2 의 -0 정규화를 조각 수준에서 한 것.
  const a = amplitudeParts(-0.003, 0);
  assert.equal(a.re, "0.00");
  assert.equal(a.sign, "");
});

test("0.005 경계: 미만은 숨김 대상이고 이상은 표시된다", () => {
  assert.equal(AMP_DISPLAY_EPS, 0.005);
  assert.equal(amplitudeShowsAsZero(0.004, 0.004), true);
  assert.equal(amplitudeShowsAsZero(0.005, 0), false, "경계값은 숨기지 않는다");
  assert.equal(amplitudeShowsAsZero(0, 0.005), false);
  assert.equal(amplitudeShowsAsZero(0.06, 0), false, "진폭 0.06 은 확률 0.36% 라도 계수로는 0 이 아니다");
  assert.equal(amplitudeParts(0.005, 0).re, "0.01", "경계값은 0.01 로 올라간다");
});

test("fmt2 는 -0 을 0 으로 정규화해 -0.00 을 찍지 않는다", () => {
  // 밀도행렬과 상태벡터가 같이 쓰는 포매터다 — 한쪽만 고치면 두 패널이 갈라진다.
  assert.equal(fmt2(-0.003), "0.00");
  assert.equal(fmt2(-0), "0.00");
  assert.equal(fmt2(0), "0.00");
  assert.equal(fmt2(-0.5), "-0.50", "표시할 만큼 큰 음수는 부호를 유지한다");
});

test("fmt2 는 수치 오차(5e-4 미만)를 0 으로 뭉갠다", () => {
  assert.equal(fmt2(1e-17), "0.00");
  assert.equal(fmt2(-1e-17), "0.00");
  assert.equal(fmt2(0.0004), "0.00");
  assert.equal(fmt2(0.004), "0.00", "오차는 아니지만 2자리에서는 0.00 으로 보인다");
});
