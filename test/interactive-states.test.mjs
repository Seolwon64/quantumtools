// 버튼의 hover·active·선택 상태가 글자를 읽을 수 있게 남기는지 고정한다.
//
// 왜: 공용 중립 hover·누름 규칙(`:not()` 셋 + `:hover` = 특이도 0,5,0)이 자기 색을 가진 요소를 빼지 않아, 그 요소의
// 배경만 회색으로 덮고 흰 글자는 남겼다 — 확률 패널 Run·선택된 qpick 이 hover 1.13, 누름 1.2(실측). 활성 탭(1.03)·
// Delete 에 이어 같은 함정에 네 번째로 걸린 것이라 값이 아니라 **규칙이 겹치는 모양**을 텍스트로 본다. 특이도·순서는
// 일부러 보지 않는다: 재생 버튼은 같은 특이도의 자기 규칙이 뒤에 와서 버텼을 뿐이라, 순서가 바뀌면 같은 버그가 된다.
// 토큰 값의 대비는 design-spec "인터랙티브 상태" 의 토큰 쌍 표가 정하고 여기서 다시 계산한다. 렌더된 실제 색(합성·
// opacity)은 Node 에서 못 보므로 브라우저 측정이 지킨다(design-spec "측정 규칙").
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
// 주석을 뺀다 — 주석 속 선택자 예시("…:hover(0,3,0)")가 규칙으로 읽히지 않게.
const CSS = read("style.css").replace(/\/\*[\s\S]*?\*\//g, "");
const SPEC = read("docs/design-spec.md");
const MARKUP = [read("index.html"), ...readdirSync(new URL("../js/", import.meta.url))
  .filter((f) => f.endsWith(".js")).map((f) => read(`js/${f}`))];

// ── 토큰 ─────────────────────────────────────────────────────────────────────
const ROOT = CSS.match(/:root\s*\{([\s\S]*?)\n\}/)[1];
const TOKENS = new Map([...ROOT.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

/** 별칭(`--primary: var(--accent-9)`)을 끝까지 따라가 실제 값을 돌려준다. */
function tokenValue(name, seen = []) {
  assert.ok(TOKENS.has(name), `:root 에 토큰이 없다: ${name}`);
  assert.ok(!seen.includes(name), `별칭이 돈다: ${[...seen, name].join(" → ")}`);
  const value = TOKENS.get(name);
  const alias = value.match(/^var\((--[\w-]+)\)$/);
  return alias ? tokenValue(alias[1], [...seen, name]) : value;
}

// WCAG 상대 휘도·대비비 — test/colors.test.mjs 와 같은 식(테스트 파일끼리는 임포트하지 않는다).
const srgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function luminance(hex) {
  const [r, g, b] = srgb(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// ── 선택자 해석 ───────────────────────────────────────────────────────────────
/** 괄호·대괄호 안의 쉼표는 건너뛰고 나눈다(`:not(.a, .b)` 는 한 덩어리). */
function splitTop(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0) { parts.push(text.slice(start, i).trim()); start = i + 1; }
  }
  parts.push(text.slice(start).trim());
  return parts.filter(Boolean);
}

/** 선택자의 마지막 복합 선택자 — 그 요소 자신에 걸리는 부분. 괄호 밖 공백·`>`·`+`·`~` 가 경계다. */
function lastCompound(selector) {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (depth === 0 && /[\s>+~]/.test(ch)) start = i + 1;
  }
  return selector.slice(start);
}

const closeOf = (text, open) => {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return i;
  }
  throw new Error(`괄호가 닫히지 않는다: ${text}`);
};
const normAttr = (attr) => attr.replace(/["'\s]/g, "");

/** `:not()` 인자의 클래스·속성·상태 의사 클래스(`:disabled`) — 이것들을 가진 요소는 빠진다. */
function excludedTokens(arg) {
  return [
    ...[...arg.matchAll(/\.([\w-]+)/g)].map((m) => `.${m[1]}`),
    ...[...arg.matchAll(/\[[^\]]+\]/g)].map((m) => normAttr(m[0])),
    ...[...arg.matchAll(/(?<![\w-]):([\w-]+)(?!\()/g)].map((m) => `:${m[1]}`),
  ];
}

/**
 * 복합 선택자 하나를 "요소가 가져야 할 클래스 / 빠지는 토큰 / 상태" 로 푼다. `:is(.a, .b)` 는 대안마다 하나씩 나온다.
 * `:where()`·`:is()` 는 특이도만 다르고 고르는 요소는 같아서 똑같이 푼다 — 이번에 새로 쓴 제외는 `:where(:not(…))` 꼴이다.
 */
function variants(compound) {
  const blank = () => ({ classes: new Set(), not: new Set(), pseudo: new Set() });
  const merged = (a, b) => ({
    classes: new Set([...a.classes, ...b.classes]), not: new Set([...a.not, ...b.not]), pseudo: new Set([...a.pseudo, ...b.pseudo]),
  });
  let acc = [blank()];
  let i = 0;
  while (i < compound.length) {
    const rest = compound.slice(i);
    if (rest[0] === ".") {
      const m = rest.match(/^\.([\w-]+)/);
      for (const v of acc) v.classes.add(`.${m[1]}`);
      i += m[0].length;
    } else if (rest[0] === "[") {
      const end = rest.indexOf("]");
      for (const v of acc) v.classes.add(normAttr(rest.slice(0, end + 1)));
      i += end + 1;
    } else if (rest[0] === ":") {
      const m = rest.match(/^::?([\w-]+)/);
      i += m[0].length;
      if (compound[i] !== "(") {
        for (const v of acc) v.pseudo.add(m[1]);
        continue;
      }
      const close = closeOf(compound, i);
      const args = splitTop(compound.slice(i + 1, close));
      i = close + 1;
      if (m[1] === "not") {
        const tokens = args.flatMap(excludedTokens);
        for (const v of acc) for (const t of tokens) v.not.add(t);
      } else if (m[1] === "is" || m[1] === "where") {
        const alts = args.flatMap((a) => variants(a));
        if (alts.length === 1) {
          acc = acc.map((v) => merged(v, alts[0]));
        } else if (alts.every((a) => a.classes.size === 0 && a.not.size === 0)) {
          // `:is(:hover, :active)` — 상태 중 하나면 걸린다
          const pseudo = new Set(alts.flatMap((a) => [...a.pseudo]));
          acc = acc.map((v) => merged(v, { classes: new Set(), not: new Set(), pseudo }));
        } else if (alts.every((a) => a.classes.size === 0 && a.pseudo.size === 0)) {
          // `:where(:not(.a), :not(.b))` 는 "a 가 아니거나 b 가 아니면" 이다 — 둘 다 가진 요소만 빠진다
          const not = new Set([...alts[0].not].filter((t) => alts.every((a) => a.not.has(t))));
          acc = acc.map((v) => merged(v, { classes: new Set(), not, pseudo: new Set() }));
        } else {
          acc = acc.flatMap((v) => alts.map((a) => merged(v, a)));
        }
      }
      // :has()·:nth-child() 같은 다른 함수형 의사 클래스는 이 검사와 상관없다
    } else {
      i++; // 요소 이름·#id·* — 클래스 판정에 쓰지 않는다
    }
  }
  return acc;
}

// ── 규칙 ─────────────────────────────────────────────────────────────────────
// @media 안의 규칙도 중괄호 한 겹이라 이 정규식에 그대로 잡힌다.
const RULES = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => {
  const decls = new Map([...m[2].matchAll(/([\w-]+)\s*:\s*([^;]+)/g)].map((d) => [d[1], d[2].trim()]));
  return {
    selectors: splitTop(m[1].trim()).map((text) => ({ text, variants: variants(lastCompound(text)) })),
    background: decls.get("background-color") ?? decls.get("background"),
    color: decls.get("color"),
  };
}).filter((r) => !r.selectors.some((s) => s.text.startsWith("@") || s.text === ":root"));

const GRAY = new Set(Array.from({ length: 12 }, (_, k) => tokenValue(`--gray-${k + 1}`)));
const INTERACTION = new Set(["hover", "active"]);
const touches = (v) => [...v.pseudo].some((p) => INTERACTION.has(p));

/** 중립 hover·누름 단계: 배경 `--gray-4`/`--gray-5` 나 글자 `--text-title` 을 `:hover`/`:active` 에서 준다. */
const NEUTRAL = RULES.flatMap((r) => {
  const neutralBg = /^var\(--gray-[45]\)$/.test(r.background ?? "");
  const neutralText = r.color === "var(--text-title)";
  if (!neutralBg && !neutralText) return [];
  return r.selectors.flatMap((s) => s.variants.filter((v) => v.classes.size > 0 && touches(v)).map((v) => ({ text: s.text, v, neutralText })));
});

/** 자기 색: 배경이 회색 램프가 아닌 토큰이다. 기본·hover·active 에서 걸리는 것만(`::after` 같은 의사 요소의 칠은 요소 색이 아니다).
 *  :root 에 없는 변수(JS 가 런타임에 넣는 것)는 회색이라고 볼 근거가 없으니 자기 색으로 친다. */
const OWN = RULES.flatMap((r) => {
  const ref = (r.background ?? "").match(/^var\((--[\w-]+)\)$/);
  if (!ref || (TOKENS.has(ref[1]) && GRAY.has(tokenValue(ref[1])))) return [];
  return r.selectors.flatMap((s) => s.variants
    .filter((v) => v.classes.size > 0 && [...v.pseudo].every((p) => INTERACTION.has(p)))
    .map((v) => ({ text: s.text, v })));
});

// ── 한 요소에 함께 붙는 클래스 ─────────────────────────────────────────────────
// 상태 클래스(.selected·.is-on)는 JS 가 토글하지만 자기 색 규칙이 `.qpick-btn.selected` 처럼 복합 선택자라 거기서 안다.
// 여기서 모으는 것은 **다른 이름의 보조 클래스** — `round-btn round-btn-primary` 처럼 규칙만 봐서는 같은 요소인지
// 모르는 경우다. 한 문장(한 class 속성)의 리터럴을 한 요소로 본다. 템플릿의 `${…}` 에 닿은 조각(`cat-`)은 버린다.
function classLists() {
  const lists = [];
  const fromLiterals = (literals) => {
    const names = literals.join(" ").split(/\s+/).filter((n) => /^-?[A-Za-z_][\w-]*$/.test(n) && !n.endsWith("-"));
    if (names.length) lists.push(new Set(names.map((n) => `.${n}`)));
  };
  const literalsIn = (code) => [...code.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)]
    .map((m) => (m[1] ?? m[2] ?? m[3]).replace(/\S*\$\{[^}]*\}\S*/g, " "));
  for (const source of MARKUP) {
    for (const m of source.matchAll(/\bclass="([^"$]*)"/g)) fromLiterals([m[1]]);
    for (const m of source.matchAll(/\.className\s*=([^;\n]*)/g)) fromLiterals(literalsIn(m[1]));
    for (const m of source.matchAll(/\.setAttribute\(\s*["']class["']\s*,([^;\n]*)/g)) fromLiterals(literalsIn(m[1]));
    for (const m of source.matchAll(/\.classList\.add\(([^;\n]*)\)/g)) fromLiterals(literalsIn(m[1]));
    // toggle 은 첫 인자만 클래스다 — 둘째 인자의 비교 문자열("qasm")은 클래스가 아니다
    for (const m of source.matchAll(/\.classList\.toggle\(\s*(["'`])([^"'`]*)\1/g)) fromLiterals([m[2]]);
  }
  return lists;
}
const LISTS = classLists();

/**
 * 중립 변형 n 과 자기 색 변형 o 가 같은 요소에 걸릴 수 있나. 보조 클래스로 잇는 것은 o 의 **첫 클래스**(요소 이름 몫 —
 * `.inspect-toggle.is-on` 의 `.inspect-toggle`)뿐이다. 아무 클래스나 잇게 했더니 `class="segmented-btn active"` 의 상태
 * 클래스 `.active` 를 타고 `.gate-menu-item.active` 까지 같은 요소로 읽었다(대조군에서 실측).
 */
function sameElement(n, o) {
  if ([...n.classes].every((c) => o.classes.has(c))) return true;
  const head = [...o.classes].find((c) => c.startsWith("."));
  return !n.classes.has(head) && LISTS.some((list) => list.has(head) && [...n.classes].every((c) => list.has(c)));
}

// ── 테스트 ───────────────────────────────────────────────────────────────────
test("버튼 상태가 쓰는 글자·배경 토큰 쌍은 design-spec 의 최소 대비를 넘고, 표에 적힌 대비가 실제 값이다", () => {
  const start = SPEC.search(/^## \d+\. 인터랙티브 상태/m);
  assert.ok(start >= 0, 'design-spec 에 "인터랙티브 상태" 절이 없다');
  const end = SPEC.slice(start + 1).search(/^## /m);
  const section = SPEC.slice(start, end < 0 ? undefined : start + 1 + end);
  const rows = [...section.matchAll(/^\|\s*([^|]+?)\s*\|\s*`(--[\w-]+)`\s*\|\s*`(--[\w-]+)`\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*$/gm)];
  assert.ok(rows.length > 0, "상태별 토큰 쌍 표를 읽지 못했다 — 표 형식이 바뀌었으면 이 추출을 고친다");
  for (const [, state, fg, bg, min, shown] of rows) {
    const ratio = contrast(tokenValue(fg), tokenValue(bg));
    assert.ok(ratio >= Number(min), `${state}: ${fg} on ${bg} = ${ratio.toFixed(2)} < ${min}`);
    assert.equal(ratio.toFixed(2), shown, `${state}: 표에는 ${shown} 인데 실제 ${fg} on ${bg} = ${ratio.toFixed(2)} — 표를 고친다`);
  }
});

test("자기 색을 가진 요소는 중립 hover·누름 규칙에 덮이지 않는다 — 규칙 순서·특이도와 무관하게", () => {
  // 추출이 망가지면 아무것도 못 잡고 통과한다 — 셋 다 비어 있지 않은지 먼저 본다.
  assert.ok(NEUTRAL.length > 0 && OWN.length > 0, "중립·자기 색 규칙을 하나도 못 찾았다 — 해석을 고친다");
  assert.ok(LISTS.some((l) => l.size > 1), "한 요소에 함께 붙는 클래스를 하나도 못 찾았다 — 수집을 고친다");
  const problems = [];
  for (const n of NEUTRAL) {
    for (const o of OWN) {
      if (!sameElement(n.v, o.v)) continue;
      // 자기 색 규칙이 요구하는 것 중 하나를 중립 쪽이 빼야 한다. 요구하는 게 중립 쪽 클래스뿐이면(늘·hover 에 자기 색)
      // 뺄 방법이 없으니 그 요소는 중립 목록에 있으면 안 된다.
      const required = [...o.v.classes].filter((c) => !n.v.classes.has(c));
      if (required.some((c) => n.v.not.has(c))) continue;
      problems.push(required.length
        ? `${n.text}\n    가 ${o.text} 의 자기 색을 덮는다 — ${required.join(" 또는 ")} 를 :where(:not(…)) 로 뺀다`
        : `${n.text}\n    가 ${o.text} 의 자기 색을 덮는다 — 이 요소는 중립 목록에서 지운다`);
    }
  }
  assert.deepEqual(problems, []);
});

test("비활성은 hover·누름에 반응하지 않는다 — :disabled 만 빼는 상태 규칙은 .is-disabled·aria-disabled 를 놓친다", () => {
  // 이 앱의 비활성은 셋으로 온다: 네이티브 disabled, 사유 툴팁을 위해 클래스로 쓰는 .is-disabled, 그리고 aria-disabled.
  // `.round-btn:active:not(:disabled)` 는 활성 버튼에선 블록에 져 죽어 있으면서 .is-disabled 재생 버튼에서만 살아,
  // 누르면 0.92 로 줄었다(실측). :disabled 를 빼는 규칙이면 나머지 둘도 함께 빼야 한다.
  const problems = [];
  for (const r of RULES) {
    for (const s of r.selectors) {
      for (const v of s.variants) {
        if (!touches(v) || !v.not.has(":disabled")) continue;
        const missing = [".is-disabled", "[aria-disabled=true]"].filter((t) => !v.not.has(t));
        if (missing.length) problems.push(`${s.text} — ${missing.join("·")} 를 빼지 않는다`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("글자를 올리는 중립 규칙은 hover 와 active 단독 둘 다에 걸린다 — 키보드 Space·터치는 hover 없이 :active 만 건다", () => {
  const states = new Map();
  for (const { v, neutralText } of NEUTRAL) {
    if (!neutralText) continue;
    const key = [...v.classes].sort().join("");
    states.set(key, new Set([...(states.get(key) ?? []), ...[...v.pseudo].filter((p) => INTERACTION.has(p))]));
  }
  assert.ok(states.size > 0, "글자를 --text-title 로 올리는 중립 규칙을 못 찾았다");
  const missing = [...states].filter(([, s]) => !(s.has("hover") && s.has("active"))).map(([key, s]) => `${key} (${[...s].join("·")} 만)`);
  assert.deepEqual(missing, []);
});
