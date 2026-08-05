// 메뉴 드로어의 요구사항을 마크업·CSS 수준에서 고정한다.
//
// 여기서 잡는 것들은 눈으로는 늦게 발견된다:
//   · .hidden(display:none)을 쓰면 애니메이션이 통째로 죽는다 — 정지 화면에선 똑같아 보인다.
//   · width/left 를 애니메이션하면 매 프레임 레이아웃이 다시 계산돼 끊긴다 — 빠른 기기에선 안 보인다.
//   · 자리표시자 항목은 "일단 넣어두자"로 슬금슬금 들어온다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const HTML = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../style.css", import.meta.url), "utf8");
const MENU_JS = readFileSync(new URL("../js/menu.js", import.meta.url), "utf8");

/**
 * 선택자 목록이 **정확히 일치**하는 규칙의 본문.
 * 부분 일치로 찾으면 `.code-drawer` 질의가 `.menu-drawer, .code-drawer` 공유 규칙의
 * 둘째 줄에 걸려 엉뚱한 본문을 돌려준다(실제로 겪음).
 */
function rule(selector) {
  const want = selector.split(",").map((s) => s.trim()).join(",");
  // 주석을 먼저 걷어낸다 — 규칙 앞의 설명 블록이 선택자 자리에 섞여 들어온다.
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  // 앞에 `}` 를 요구하면 그 `}` 가 소비돼 **규칙을 하나 걸러 하나씩** 놓친다(실제로 겪음).
  // 매치가 끝난 지점부터 이어 훑으므로 선택자만 잡으면 된다.
  for (const m of bare.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const sel = m[1].split(",").map((s) => s.trim()).filter(Boolean).join(",");
    if (sel === want) return m[2];
  }
  assert.fail(`규칙이 없다: ${selector}`);
}

/** 여는 태그의 속성 문자열. */
function tag(id) {
  const m = HTML.match(new RegExp(`<[a-z]+[^>]*\\bid="${id}"[^>]*>`));
  assert.ok(m, `요소가 없다: #${id}`);
  return m[0];
}

test("드로어는 transform 만 애니메이션한다 (width/left 는 레이아웃을 재계산시킨다)", () => {
  const shared = rule(".menu-drawer,\n.code-drawer");
  const t = shared.match(/transition:([^;]+);/)[1];
  assert.match(t, /transform/, "transform 전환이 없다");
  assert.doesNotMatch(t, /\bwidth\b/, "width 를 애니메이션하고 있다");
  assert.doesNotMatch(t, /\bleft\b|\bright\b/, "left/right 를 애니메이션하고 있다");
  assert.doesNotMatch(t, /\ball\b/, "all 을 애니메이션하고 있다");
});

test("드로어가 display:none 으로 숨겨지지 않는다 (숨기면 전환이 실행되지 않는다)", () => {
  for (const id of ["menu-drawer", "code-drawer", "menu-overlay"]) {
    assert.doesNotMatch(tag(id), /class="[^"]*\bhidden\b/, `#${id} 가 .hidden 을 쓴다`);
  }
  const shared = rule(".menu-drawer,\n.code-drawer");
  assert.match(shared, /visibility:\s*hidden/, "닫힘 상태가 visibility 로 표현되지 않는다");
});

test("전환 시간과 이징이 토큰에서 온다 (리터럴을 흩뿌리지 않는다)", () => {
  assert.match(CSS, /--dur-drawer:\s*180ms/, "--dur-drawer 토큰이 없다");
  for (const sel of [".menu-drawer,\n.code-drawer", ".drawer-overlay"]) {
    const t = rule(sel).match(/transition:([^;]+);/)[1];
    assert.match(t, /var\(--dur-drawer\)/, `${sel}: 시간이 토큰이 아니다`);
    assert.match(t, /var\(--ease\)/, `${sel}: 이징이 토큰이 아니다`);
  }
});

test("좁은 화면에서 드로어가 화면을 벗어나지 않는다", () => {
  // 고정 폭이면 360px 화면에서 잘린다. min() 으로 뷰포트에 묶어 둔다.
  assert.match(rule(".menu-drawer"), /width:\s*min\([^)]*vw\)/, "메뉴 드로어 폭이 뷰포트에 묶여 있지 않다");
  assert.match(rule(".code-drawer"), /width:\s*min\([^)]*vw\)/, "코드 드로어 폭이 뷰포트에 묶여 있지 않다");
});

test("접근성 속성이 붙어 있다", () => {
  for (const id of ["menu-drawer", "code-drawer"]) {
    assert.match(tag(id), /role="dialog"/, `#${id}: role="dialog" 없음`);
    assert.match(tag(id), /aria-label="[^"]+"/, `#${id}: aria-label 없음`);
  }
  // 메뉴만 모달이다 — 코드 드로어는 뒤 화면을 계속 쓸 수 있어야 한다.
  assert.match(tag("menu-drawer"), /aria-modal="true"/);
  assert.doesNotMatch(tag("code-drawer"), /aria-modal/);
  assert.match(tag("menu-btn"), /aria-expanded/, "햄버거에 aria-expanded 없음");
});

test("메뉴 드로어에만 오버레이가 있다", () => {
  // 메뉴는 고르면 닫히는 일시적 UI라 뒤를 딤 처리하고,
  // 코드는 회로를 보면서 읽는 패널이라 뒤를 가리면 안 된다.
  assert.match(HTML, /id="menu-overlay"/, "메뉴 오버레이가 없다");
  assert.doesNotMatch(HTML, /id="code-overlay"/, "코드 드로어에 오버레이가 생겼다");
  assert.match(rule(".drawer-overlay"), /background:/, "오버레이에 딤 색이 없다");
});

test("자리표시자·비활성 항목이 없다", () => {
  // 미구현 항목이 보이면 앱 전체가 미완성으로 읽힌다.
  assert.doesNotMatch(MENU_JS, /coming soon/i, "'coming soon' 문구가 남아 있다");
  assert.doesNotMatch(HTML, /coming soon/i, "'coming soon' 문구가 남아 있다");
  assert.doesNotMatch(MENU_JS, /disabled:\s*true/, "비활성 항목이 있다");
  // 그룹은 이번에 1개뿐이고, 항목마다 실행 대상(ACTIONS)이 실제로 있어야 한다.
  const groups = MENU_JS.match(/export const MENU_GROUPS = \[([\s\S]*?)\n\];/)[1];
  const ids = [...groups.matchAll(/id:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ["code"], "이번 작업의 항목은 Code editor 하나다");
  for (const id of ids) {
    assert.match(MENU_JS, new RegExp(`ACTIONS\\s*=\\s*\\{[^}]*\\b${id}\\b`), `${id}: 실행 대상이 없다`);
  }
});

test("메뉴 항목이 기존 5개 상태 규칙에 편입돼 있다 (별도 정의를 만들지 않는다)", () => {
  for (const state of ["hover", "active", "focus-visible"]) {
    assert.match(
      CSS,
      new RegExp(`\\.menu-drawer-item[^,{]*:${state}\\s*[,{]`),
      `.menu-drawer-item 이 ${state} 목록에 없다`
    );
  }
});

test("드로어 스타일이 기존 토큰만 쓴다 (새 색·간격 값을 만들지 않는다)", () => {
  const start = CSS.indexOf(".drawer-overlay {");
  const end = CSS.indexOf("}", CSS.indexOf(".code-drawer-body {")) + 1;
  // 주석은 뺀다 — 설명문에 적힌 "360px 화면에서도" 같은 숫자를 값으로 오인한다.
  const block = CSS.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b/, "하드코딩된 색이 있다");
  // 허용: 0, 1px 테두리/구분선, min() 안의 뷰포트 기준 폭, blur 반경
  const pxs = [...block.matchAll(/(?<![\w-])(\d+)px/g)].map((m) => +m[1]);
  const bad = pxs.filter((v) => v !== 0 && v !== 1 && v !== 2 && v !== 260 && v !== 420);
  assert.deepEqual(bad, [], `스케일 밖 px 값: ${bad.join(", ")}`);
});
