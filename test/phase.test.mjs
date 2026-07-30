// 위상 컬러맵(순환·명도 균일)과 회로 블록 색(대비 균일) 검증.
// 이 값들이 흔들리면 "특정 위상/게이트가 강조된 것처럼 보이는 착시" = 데이터 왜곡이 되살아난다.
// 실행: node --test test/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { phaseToRgb, phaseToCss, phaseWheelStops, cssAngleToPhase } from "../js/phase.js";

const TAU = 2 * Math.PI;
// WCAG 상대 휘도
const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const lum = ({ r, g, b }) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const same = (a, b, e = 1e-9) =>
  Math.abs(a.r - b.r) < e && Math.abs(a.g - b.g) < e && Math.abs(a.b - b.b) < e;

test("순환: 0과 2π가 같은 색, 음수 위상도 정규화된다", () => {
  assert.ok(same(phaseToRgb(0), phaseToRgb(TAU)), "0 vs 2π");
  assert.ok(same(phaseToRgb(0), phaseToRgb(-TAU)), "0 vs −2π");
  assert.ok(same(phaseToRgb(Math.PI / 3), phaseToRgb(Math.PI / 3 + 4 * TAU)), "주기성");
  assert.ok(same(phaseToRgb(-Math.PI / 2), phaseToRgb(TAU - Math.PI / 2)), "음수 정규화");
});

test("명도 균일: 모든 위상의 상대 휘도가 거의 같다(HSL hue의 착시 제거)", () => {
  const lums = [];
  for (let i = 0; i < 72; i++) lums.push(lum(phaseToRgb((TAU * i) / 72)));
  const min = Math.min(...lums), max = Math.max(...lums);
  // 순수 HSL hue는 노랑/파랑 사이 휘도가 몇 배씩 차이난다. Oklch L 고정이면 그 비가 1에 가깝다.
  assert.ok(max / min < 1.25, `휘도 비 ${(max / min).toFixed(3)} — 위상별 밝기가 균일해야 한다`);
});

test("서로 다른 위상은 서로 다른 색이다(0·π/2·π·3π/2)", () => {
  const pts = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map(phaseToRgb);
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      assert.ok(!same(pts[i], pts[j], 0.02), `${i} vs ${j}가 구분되어야 한다`);
    }
  }
});

test("파스텔: 채도가 과하지 않다(모든 채널이 완전 포화되지 않음)", () => {
  for (let i = 0; i < 36; i++) {
    const c = phaseToRgb((TAU * i) / 36);
    const max = Math.max(c.r, c.g, c.b), min = Math.min(c.r, c.g, c.b);
    assert.ok(max - min < 0.62, `위상 ${i}: 채도차 ${(max - min).toFixed(2)} — 파스텔이어야 한다`);
  }
});

test("색상환 ↔ 노드: 같은 함수에서 나오므로 링 각도의 색이 그 위상의 색과 일치", () => {
  // 링의 네 방향이 0·π/2·π·3π/2에 대응하는지 (오른쪽=0, 위=π/2, 왼쪽=π, 아래=3π/2)
  const at = (deg) => cssAngleToPhase(deg);
  const norm = (a) => ((a % TAU) + TAU) % TAU;
  assert.ok(Math.abs(norm(at(90)) - 0) < 1e-9, "오른쪽 = 위상 0");
  assert.ok(Math.abs(norm(at(0)) - Math.PI / 2) < 1e-9, "위 = π/2");
  assert.ok(Math.abs(norm(at(270)) - Math.PI) < 1e-9, "왼쪽 = π");
  assert.ok(Math.abs(norm(at(180)) - (3 * Math.PI) / 2) < 1e-9, "아래 = 3π/2");

  // 스톱 색이 그 각도의 위상 색과 정확히 같은 문자열인지(범례가 거짓이 될 수 없다)
  for (const s of phaseWheelStops(24)) {
    assert.equal(s.color, phaseToCss(cssAngleToPhase(s.deg)), `${s.deg}deg`);
  }
});

// ---------- 회로 블록 색: 명도 균일 + WCAG AA ----------

test("회로 블록 색: 흰 글자 대비가 전부 AA 이상이고 서로 균일하다", () => {
  const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const names = ["pauli", "phase", "rotation", "multi", "interaction", "structural", "advanced"];
  const ratios = [];
  for (const n of names) {
    const m = new RegExp(`--cat-${n}-c:\\s*#([0-9a-fA-F]{6})`).exec(css);
    assert.ok(m, `--cat-${n}-c 를 찾을 수 없다`);
    const hex = m[1];
    const rgb = {
      r: parseInt(hex.slice(0, 2), 16) / 255,
      g: parseInt(hex.slice(2, 4), 16) / 255,
      b: parseInt(hex.slice(4, 6), 16) / 255,
    };
    const ratio = 1.05 / (lum(rgb) + 0.05); // 흰 글자 대비
    assert.ok(ratio >= 4.5, `${n}: 대비 ${ratio.toFixed(2)} — WCAG AA(4.5) 미달`);
    ratios.push(ratio);
  }
  // 대비비는 배경 휘도의 함수이므로, 이게 균일하면 지각 밝기가 균일하다
  const min = Math.min(...ratios), max = Math.max(...ratios);
  assert.ok(max - min < 0.35, `대비 범위 ${min.toFixed(2)}~${max.toFixed(2)} — 명도가 균일해야 한다`);
});

test("회로 블록 색: hue가 4계열로 묶여 있다(알록달록해지지 않게)", () => {
  const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const hueOf = (name) => {
    const hex = new RegExp(`--cat-${name}-c:\\s*#([0-9a-fA-F]{6})`).exec(css)[1];
    const r = parseInt(hex.slice(0, 2), 16) / 255, g = parseInt(hex.slice(2, 4), 16) / 255, b = parseInt(hex.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (d < 1e-6) return 0;
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return ((h * 60) % 360 + 360) % 360;
  };
  // Phase·Multi·Rotation은 같은 파랑 계열(hue 차 60도 이내)
  const blues = ["phase", "multi", "rotation"].map(hueOf);
  assert.ok(Math.max(...blues) - Math.min(...blues) < 60, `파랑 계열 hue 폭 ${(Math.max(...blues) - Math.min(...blues)).toFixed(0)}도`);
  // 회색 계열은 채도가 낮아야 한다
  for (const n of ["structural", "advanced"]) {
    const hex = new RegExp(`--cat-${n}-c:\\s*#([0-9a-fA-F]{6})`).exec(css)[1];
    const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
    assert.ok(Math.max(r, g, b) - Math.min(r, g, b) < 45, `${n}: 회색 계열이어야 한다`);
  }
});
