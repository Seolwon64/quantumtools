// UI 의 마크업·CSS 수준 불변식 — 특정 패널이 아니라 앱 전체에 걸린 약속들.
//
// 메뉴 드로어(7단계에서 제거)의 테스트에 함께 들어 있던 것 중 **메뉴와 무관한 불변식**을 옮겨
// 왔다: 코드 밴드는 대화상자가 아니다, 코드 밴드에 오버레이가 없다, 자리표시자 금지. 마지막은
// 메뉴 항목에만 걸던 것을 UI 전체로 넓혔다. 여기에 헤더의 Code 버튼(코드 밴드의 유일한 입구)을 더했다.
// 8단계: 게이트 정보도 대화상자가 아니다 · 정보를 닫을 때 포커스가 돌아오는 자리마다 링이 있다.
// 토큰 값의 사본(DESIGN.md·사이드카)이 리포에 없다는 약속도 여기 둔다 — 마크업은 아니지만
// "정의는 style.css 한 곳에만"이라는, 역시 앱 전체에 걸린 약속이다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { icon } from "../js/icons.js";

const HTML = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../style.css", import.meta.url), "utf8");
const JS_DIR = new URL("../js/", import.meta.url);
const JS = readdirSync(JS_DIR)
  .filter((f) => f.endsWith(".js"))
  .map((f) => [f, readFileSync(new URL(f, JS_DIR), "utf8")]);

/** 여는 태그의 속성 문자열. */
function tag(id) {
  const m = HTML.match(new RegExp(`<[a-z]+[^>]*\\bid="${id}"[^>]*>`));
  assert.ok(m, `요소가 없다: #${id}`);
  return m[0];
}

/** 속성 값. */
function attr(id, name) {
  const m = tag(id).match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? m[1] : null;
}

test("코드 밴드는 대화상자가 아니다 — 이름이 있고 aria-modal 이 없다", () => {
  // 레이아웃에 참여하는 도구라 뒤 화면을 계속 쓸 수 있어야 한다(포커스 트랩도 없다).
  assert.match(tag("code-panel"), /aria-label="[^"]+"/, "코드 밴드에 aria-label 없음");
  assert.doesNotMatch(tag("code-panel"), /aria-modal/, "코드 밴드가 모달로 선언됐다");
});

test("코드 밴드에 오버레이(딤)가 없다 — 회로를 보면서 쓰는 도구라 뒤를 가리지 않는다", () => {
  assert.doesNotMatch(HTML, /id="code-overlay"/, "코드 밴드에 오버레이가 생겼다");
});

test("UI 어디에도 자리표시자 문구가 없다 — 미구현 항목이 보이면 앱 전체가 미완성으로 읽힌다", () => {
  // 예전에는 메뉴 항목에만 걸었다. 자리표시자는 "일단 넣어 두자"로 어디든 슬금슬금 들어온다.
  assert.doesNotMatch(HTML, /coming soon/i, "index.html 에 'coming soon' 문구가 있다");
  for (const [file, src] of JS) {
    assert.doesNotMatch(src, /coming soon/i, `js/${file} 에 'coming soon' 문구가 있다`);
  }
});

test("헤더의 Code 버튼이 코드 밴드를 가리키고, 보이는 글자로 시작하는 이름을 갖는다", () => {
  // 메뉴가 없어진 뒤 코드로 들어가는 **유일한 입구**다. 아이콘만으로는 찾기 어려워 글자를 둔다.
  assert.equal(attr("code-entry", "aria-controls"), "code-panel", "aria-controls 가 코드 밴드가 아니다");
  assert.match(tag("code-entry"), /aria-expanded="(true|false)"/, "aria-expanded 없음");
  const body = HTML.match(/<button[^>]*\bid="code-entry"[^>]*>([\s\S]*?)<\/button>/)[1];
  const visible = body.replace(/<[^>]+>/g, "").trim();
  assert.equal(visible, "Code", "보이는 글자가 Code 가 아니다");
  // 말로 부르는 이름이 보이는 글자로 시작해야 한다(WCAG 2.5.3) — 음성 명령 "Code 클릭"이 통해야 한다.
  assert.ok(attr("code-entry", "aria-label").startsWith(visible), "aria-label 이 보이는 글자로 시작하지 않는다");
  // 아이콘은 장식이다 — 아이콘 세트가 aria-hidden 으로 그린다.
  assert.match(body, /data-icon="code"/, "아이콘 자리가 없다");
  assert.match(icon("code"), /aria-hidden="true"/, "아이콘이 보조기술에 노출된다");
});

test("게이트 정보는 대화상자가 아니다 — 제목으로 이름이 붙고 aria-modal 이 없다", () => {
  // 팔레트를 잠깐 덮는 일시적 UI 라 포커스를 가두지 않는다. 영역 이름은 보이는 제목(게이트 이름)이다.
  assert.equal(attr("gate-info", "role"), "region", "게이트 정보가 영역으로 선언돼 있지 않다");
  assert.equal(attr("gate-info", "aria-labelledby"), "gate-info-title", "게이트 정보의 이름이 제목에 연결돼 있지 않다");
  assert.doesNotMatch(tag("gate-info"), /aria-modal|role="dialog"/, "게이트 정보가 대화상자로 선언됐다");
  // 제목 요소는 렌더할 때 만들어진다 — 연결된 id 를 실제로 다는 곳이 있어야 이름이 생긴다.
  const gatemenu = JS.find(([f]) => f === "gatemenu.js")[1];
  assert.match(gatemenu, /\.id = "gate-info-title"/, "gatemenu.js 가 제목에 gate-info-title 을 달지 않는다");
});

test("게이트 정보를 닫을 때 포커스가 돌아오는 자리마다 focus-visible 링이 있다", () => {
  // 돌아온 포커스가 보이지 않으면 키보드 사용자에게는 body 로 떨어진 것과 같다.
  // 회로 그리드는 스크롤 영역에 붙어 자기 링이 잘리므로 감싸개에 그린다.
  const block = CSS.match(/([^{}]*)\{\s*outline: 2px solid var\(--accent-9\);/)[1];
  for (const sel of [".placed-gate:focus-visible", ".ctrl-dot:focus-visible",
    ".mx-scroll:focus-visible", ".circuit-scroll:has(.circuit-grid:focus-visible)"]) {
    assert.ok(block.includes(sel), `${sel} 가 중앙 focus-visible 블록에 없다`);
  }
  // 그리드는 Tab 순서엔 없지만 포커스를 받을 수 있어야 마지막 귀착지가 된다.
  assert.equal(attr("circuit-grid", "tabindex"), "-1", "회로 그리드가 포커스를 받을 수 없다");
  assert.ok(attr("circuit-grid", "aria-label"), "회로 그리드에 이름이 없다");
});

test("헤더의 Code 버튼이 기존 5개 상태 규칙에 편입돼 있다 (별도 정의를 만들지 않는다)", () => {
  for (const state of ["hover", "active", "focus-visible", "disabled"]) {
    assert.match(
      CSS,
      new RegExp(`\\.code-entry[^,{]*:${state}\\s*[,{]`),
      `.code-entry 가 ${state} 목록에 없다`
    );
  }
});

// Impeccable(4.5.2 기준)의 `document` 와 재디자인 흐름(`new-work`)은 DESIGN.md 에 토큰 값을 쓴다 —
// new-work 는 그것이 완료 조건이라, 그 흐름을 한 번 타면 파일이 생긴다. 사이드카도 같은 값을
// 담는다 — `.impeccable/design.json`, 또는 DESIGN.md 옆의 `DESIGN.json`. 모두 "정의는 style.css
// 한 곳에만"과 충돌하고, spec-tokens 테스트는 design-spec.md 가 말하는 변수 이름만 대조하므로
// 그 사본이 style.css 에서 멀어져도 지키지 못한다.
//
// Impeccable 은 DESIGN.md 를 루트 → .agents/context → docs 순으로 찾고, DESIGN.json 도 그 자리에서
// 읽는다. 이름은 소문자로 바꿔 비교한다 — Windows 는 대소문자를 무시해 어떤 철자로 두어도
// 읽히지만, 다른 환경은 아니다.
// 덮지 못하는 것: 환경변수 IMPECCABLE_CONTEXT_DIR 로 지정한 네 번째 위치. 리포 밖일 수 있어
// 여기서는 볼 수 없다.
const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** 리포 루트 기준 디렉터리의 항목들. 없는 디렉터리는 빈 목록이다 — `.agents/context` 는 보통 없다. */
function entries(dir) {
  try {
    return readdirSync(join(ROOT, dir), { withFileTypes: true });
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
}

/** 리포 안의 모든 디렉터리. .git 과 node_modules 는 리포의 내용이 아니라 내려가지 않는다. */
function* dirs(dir = ".") {
  yield dir;
  for (const e of entries(dir)) {
    if (e.isDirectory() && e.name !== ".git" && e.name !== "node_modules") yield* dirs(`${dir}/${e.name}`);
  }
}

test("토큰 값을 따로 적는 DESIGN.md 와 사이드카가 리포에 없다 — 정의는 style.css 한 곳뿐이다", () => {
  const named = (dir, name) =>
    entries(dir).filter((e) => e.name.toLowerCase() === name).map((e) => `${dir}/${e.name}`);
  const found = [
    ...[".", ".agents/context", "docs"].flatMap((dir) =>
      ["design.md", "design.json"].flatMap((name) => named(dir, name))),
    // `.impeccable/` 안의 사이드카는 Impeccable 이 프로젝트 루트로 본 디렉터리 아래에 생긴다.
    // 그게 리포 루트라는 보장이 없어 자리를 정하지 않고 다 본다.
    ...[...dirs()]
      .filter((dir) => dir.toLowerCase().endsWith("/.impeccable"))
      .flatMap((dir) => named(dir, "design.json")),
  ];
  assert.deepEqual(found, [], `토큰 값의 사본이 생겼다: ${found.join(", ")}`);
});
