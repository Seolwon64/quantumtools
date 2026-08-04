// 아이콘 세트가 "한 세트"로 남아 있는지 고정한다.
// 규격이 흔들리면(크기·굵기·색 결합) 눈으로는 한참 뒤에야 알아채므로 테스트로 잡는다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { icon, ICON_NAMES, ICON_SIZE, ICON_STROKE } from "../js/icons.js";

test("규격: 16px · stroke 1.5 · currentColor · fill none · 24 그리드", () => {
  assert.equal(ICON_SIZE, 16);
  assert.equal(ICON_STROKE, 1.5);
  for (const name of ICON_NAMES) {
    const svg = icon(name);
    assert.match(svg, /width="16" height="16"/, `${name}: 크기가 16이 아니다`);
    assert.match(svg, /stroke-width="1\.5"/, `${name}: stroke-width가 1.5가 아니다`);
    assert.match(svg, /stroke="currentColor"/, `${name}: 색이 currentColor가 아니다`);
    assert.match(svg, /fill="none"/, `${name}: fill이 none이 아니다`);
    assert.match(svg, /viewBox="0 0 24 24"/, `${name}: Lucide 24×24 그리드가 아니다`);
  }
});

test("색을 하드코딩한 아이콘이 없다 (currentColor 연동이 끊기면 색 시스템과 어긋난다)", () => {
  for (const name of ICON_NAMES) {
    const body = icon(name).replace(/stroke="currentColor"/, "").replace(/fill="none"/, "");
    assert.doesNotMatch(body, /#[0-9a-fA-F]{3,8}\b/, `${name}: 헥스 색이 박혀 있다`);
    assert.doesNotMatch(body, /rgba?\(/, `${name}: rgb() 색이 박혀 있다`);
    assert.doesNotMatch(body, /(fill|stroke)="(?!none|currentColor)[^"]+"/, `${name}: currentColor/none 외의 색이 있다`);
  }
});

test("아이콘은 장식이다 — aria-hidden이고 포커스를 받지 않는다", () => {
  for (const name of ICON_NAMES) {
    assert.match(icon(name), /aria-hidden="true"/, `${name}: aria-hidden이 없다`);
    assert.match(icon(name), /focusable="false"/, `${name}: focusable="false"가 없다`);
  }
});

test("정의되지 않은 이름은 조용히 넘어가지 않고 빈 문자열 + 경고", () => {
  const warned = [];
  const orig = console.warn;
  console.warn = (m) => warned.push(m);
  try {
    assert.equal(icon("nope-not-an-icon"), "");
  } finally {
    console.warn = orig;
  }
  assert.equal(warned.length, 1);
});

test("교체 대상 아이콘이 전부 정의돼 있다", () => {
  const required = [
    // 컨텍스트 메뉴
    "info", "pencil", "unfold-horizontal", "circle-plus", "circle-minus", "binary", "trash-2",
    // 재생 컨트롤
    "skip-back", "step-back", "play", "pause", "step-forward",
    // 상단 툴바
    "undo-2", "redo-2", "link", "code", "menu",
    // 3D 뷰 리셋 · GitHub · 기타
    "rotate-ccw", "github", "chevron-down", "x", "triangle-alert",
  ];
  for (const name of required) {
    assert.ok(ICON_NAMES.includes(name), `누락된 아이콘: ${name}`);
    assert.ok(icon(name).length > 60, `${name}: 경로 본문이 비어 있다`);
  }
});
