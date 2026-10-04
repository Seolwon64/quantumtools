// 명세가 코드에서 멀어지는 것을 잡는다 — design-spec 이 이름으로 말하는 CSS 변수가 실제로 있는가.
//
// --circuit-chrome 토큰을 지운 뒤에도 명세의 현재형 문단에 그 이름이 남아 있었다. 사람이 읽어서는
// 놓친다. 지금 없는 이름을 정당하게 말해야 하는 곳(회귀 교훈)은 이름을 **취소선**으로 감싼다:
// ~~`--이름`~~. 렌더된 문서에서도 "지워진 이름"으로 읽히고, 이름 하나 단위라 같은 절에 있는
// 살아 있는 이름은 계속 검사된다(절 단위 예외였다면 그 절의 오타를 놓친다).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const SPEC = readFileSync(new URL("../docs/design-spec.md", import.meta.url), "utf8");
// 주석을 뺀다 — style.css 주석에 "옛 --col-min: 18fr" 처럼 지운 이름이 선언 모양으로 남아 있다.
const CSS = readFileSync(new URL("../style.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const JS_DIR = new URL("../js/", import.meta.url);
const JS = readdirSync(JS_DIR)
  .filter((f) => f.endsWith(".js"))
  .map((f) => readFileSync(new URL(f, JS_DIR), "utf8"))
  .join("\n");

const NAME = /--[a-zA-Z][\w-]*/;

// 정의된 변수 = style.css 선언 + JS 가 런타임에 쓰는 것(--row-top·--c1·--code-band-max 처럼
// layout.js 가 setProperty 로 넣는 값).
const DEFINED = new Set([
  ...[...CSS.matchAll(new RegExp(`(${NAME.source})\\s*:`, "g"))].map((m) => m[1]),
  ...[...JS.matchAll(new RegExp(`setProperty\\(\\s*["'\`](${NAME.source})["'\`]`, "g"))].map((m) => m[1]),
]);

// 취소선 안의 코드 조각 = "지금 없다"고 표시한 이름.
const STRUCK = /~~`([^`\n]+)`~~/g;
const struckNames = [...SPEC.matchAll(STRUCK)].flatMap((m) => m[1].match(new RegExp(NAME.source, "g")) ?? []);

// 나머지 코드 조각에서 변수 이름을 모은다. 조각의 맨 앞이나 `[` `(` `,` `var(` 바로 뒤의 `--` 만
// 본다 — `node --check` 같은 명령행 옵션을 변수로 오인하지 않게.
const liveNames = [...SPEC.replace(STRUCK, "").matchAll(/`([^`\n]+)`/g)].flatMap((m) =>
  [...m[1].matchAll(new RegExp(`(?:^|[\\[(,]\\s*|var\\()(${NAME.source})`, "g"))].map((x) => x[1])
);

/** 자리표시(`--col-N-min` 의 N)는 숫자로 맞춰 하나라도 정의돼 있으면 있는 것으로 본다. */
function isDefined(name) {
  if (!/-N(-|$)/.test(name)) return DEFINED.has(name);
  const pattern = new RegExp(`^${name.replace(/-N(?=-|$)/g, "-\\d+")}$`);
  return [...DEFINED].some((d) => pattern.test(d));
}

test("design-spec 이 이름으로 말하는 CSS 변수는 style.css(또는 JS 런타임)에 실제로 있다", () => {
  // 검사할 이름이 하나도 없으면 이 테스트는 아무것도 지키지 않는다 — 추출이 망가진 것이다.
  assert.ok(liveNames.length > 0, "design-spec 에서 CSS 변수 이름을 하나도 찾지 못했다");
  const missing = [...new Set(liveNames)].filter((n) => !isDefined(n));
  assert.deepEqual(missing, [],
    `명세가 말하는데 정의가 없다: ${missing.join(", ")} — 지운 이름이면 ~~\`이름\`~~ 로 표시하라`);
});

test("취소선으로 '지금 없다'고 표시한 이름은 정말 없다 — 되살린 토큰에 낡은 표시가 남지 않는다", () => {
  const revived = [...new Set(struckNames)].filter((n) => isDefined(n));
  assert.deepEqual(revived, [], `취소선인데 정의돼 있다: ${revived.join(", ")}`);
});
