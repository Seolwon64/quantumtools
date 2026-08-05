// 게이트 카테고리 색 규격을 고정한다.
//
// 색은 눈으로 보면 "괜찮아 보이는" 범위가 넓어 조용히 어긋난다 — 실제로 두 번 어긋났다:
// 한 번은 너무 진해서(흰 글자 대비 1.74), 한 번은 너무 옅어서(패널 경계 대비 1.41).
// 그래서 "보기 좋은가"가 아니라 **측정 가능한 두 수치**로 못 박는다.
//   · 경계 대비  블록 vs 패널(--gray-2) ≥ 3.0   (WCAG 1.4.11 비텍스트 대비)
//   · 글자 대비  --gray-12 vs 블록      ≥ 4.5   (WCAG 1.4.3 AA)
// 그리고 명도(OKLCH L)가 카테고리마다 다르면 특정 게이트가 더 중요해 보이므로 균일성도 고정한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const CSS = readFileSync(new URL("../style.css", import.meta.url), "utf8");
const ROOT = CSS.match(/:root\s*\{([\s\S]*?)\n\}/)[1];

const CATEGORIES = ["pauli", "phase", "rotation", "interaction", "multi", "structural", "advanced"];
const CHROMATIC = ["pauli", "phase", "rotation", "interaction"];

function tokenHex(name) {
  const m = ROOT.match(new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  assert.ok(m, `토큰이 없다: ${name}`);
  return m[1];
}

const srgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** WCAG 상대 휘도. */
function luminance(hex) {
  const [r, g, b] = srgb(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 대비비. */
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** OKLCH의 L(명도)과 C(채도). 지각 균일 공간이라 "같은 밝기"를 수치로 말할 수 있다. */
function oklch(hex) {
  const [r, g, b] = srgb(hex).map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(A, B) };
}

test("카테고리당 색이 하나다 — 팔레트/회로용 별도 변수가 남아 있지 않다", () => {
  // 두 벌로 나뉘어 있으면 팔레트와 회로 색이 다시 어긋난다. 정의 자체를 못 만들게 막는다.
  const stale = CSS.match(/--cat-[a-z]+-(?:bg|fg|c)\s*:/g);
  assert.equal(stale, null, `구 변수가 남아 있다: ${stale?.join(", ")}`);
  for (const c of CATEGORIES) assert.match(tokenHex(`--cat-${c}`), /^#[0-9a-f]{6}$/);
});

test("팔레트와 회로가 같은 변수를 참조한다", () => {
  for (const c of CATEGORIES) {
    const palette = CSS.match(new RegExp(`\\.cat-${c}\\s*\\{[^}]*background:\\s*var\\(--cat-${c}\\)`));
    assert.ok(palette, `.cat-${c} 가 --cat-${c} 를 쓰지 않는다`);
    const circuit = CSS.match(new RegExp(`\\.placed-gate\\.cat-${c}\\s*\\{[^}]*--gate-c:\\s*var\\(--cat-${c}\\)`));
    assert.ok(circuit, `.placed-gate.cat-${c} 가 --cat-${c} 를 쓰지 않는다`);
  }
});

test("배치 전후로 색이 변하는 필터가 없다", () => {
  // 2타깃 게이트의 두 번째 블록만 흐리게 만들던 규칙 — 하나의 게이트는 하나의 색이다.
  assert.doesNotMatch(CSS, /\.placed-partner\s*\{/, ".placed-partner 감광 규칙이 남아 있다");
});

test("명도(OKLCH L)가 7개 카테고리에서 균일하다", () => {
  const Ls = CATEGORIES.map((c) => oklch(tokenHex(`--cat-${c}`)).L);
  const spread = Math.max(...Ls) - Math.min(...Ls);
  assert.ok(spread <= 0.01, `L 편차 ${spread.toFixed(4)} — 카테고리마다 밝기가 다르면 위계가 생긴다`);
});

test("블록 경계가 패널 배경과 3:1 이상으로 구분된다 (테두리 없이 보여야 한다)", () => {
  const panel = tokenHex("--gray-2");
  for (const c of CATEGORIES) {
    const ratio = contrast(tokenHex(`--cat-${c}`), panel);
    assert.ok(ratio >= 3.0, `${c}: 경계 대비 ${ratio.toFixed(2)} < 3.0 — 배경에 녹아든다`);
  }
});

test("블록 안 글자가 WCAG AA(4.5:1) 이상이다", () => {
  const text = tokenHex("--gray-12");
  for (const c of CATEGORIES) {
    const ratio = contrast(text, tokenHex(`--cat-${c}`));
    assert.ok(ratio >= 4.5, `${c}: 글자 대비 ${ratio.toFixed(2)} < 4.5`);
  }
});

test("흰 글자는 이 배경에서 AA에 못 미친다 — 뒤집지 않는 근거", () => {
  for (const c of CATEGORIES) {
    assert.ok(contrast("#ffffff", tokenHex(`--cat-${c}`)) < 4.5, `${c}: 흰 글자가 AA를 넘는다 — 재검토 필요`);
  }
});

test("채도가 '너무 진했던 이전'과 '너무 옅던 현재' 사이에 있다", () => {
  for (const c of CHROMATIC) {
    const { C } = oklch(tokenHex(`--cat-${c}`));
    assert.ok(C > 0.095, `${c}: C ${C.toFixed(3)} — 옅던 시절(0.095)보다 진해야 한다`);
    assert.ok(C < 0.194, `${c}: C ${C.toFixed(3)} — 진하던 시절(0.194)보다는 옅어야 한다`);
  }
});

test("중성 3계열은 채도가 낮되 서로 구분된다", () => {
  const neutrals = ["multi", "structural", "advanced"].map((c) => tokenHex(`--cat-${c}`));
  for (const hex of neutrals) {
    assert.ok(oklch(hex).C < 0.06, `${hex}: 중성인데 채도가 높다`);
  }
  assert.equal(new Set(neutrals).size, 3, "중성 3계열이 같은 색이라 구분되지 않는다");
});

test("hover는 같은 계열에서 더 진해진다 (중립 회색으로 덮지 않는다)", () => {
  for (const c of CATEGORIES) {
    const base = oklch(tokenHex(`--cat-${c}`));
    const hover = oklch(tokenHex(`--cat-${c}-hover`));
    assert.ok(hover.L < base.L, `${c}: hover가 더 밝다`);
    assert.ok(base.L - hover.L < 0.12, `${c}: hover가 과하게 어둡다`);
  }
});

test("위험/경고 색이 게이트 카테고리와 분리돼 있다", () => {
  // 예전엔 --cat-pauli-bg/-fg 를 빌려 써서, 게이트 색을 바꾸면 경고 배너가 함께 깨졌다.
  assert.match(ROOT, /--danger-bg\s*:/);
  assert.match(ROOT, /--danger-fg\s*:/);
  assert.ok(
    contrast(tokenHex("--danger-fg"), tokenHex("--danger-bg")) >= 4.5,
    "경고 배너 글자가 AA 미달"
  );
});
