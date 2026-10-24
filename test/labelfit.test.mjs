// 캔버스 라벨 맞춤(js/labelfit.js) — 잉크가 캔버스 폭 안에 들고, 잉크 중심이 캔버스 중심에 오고, 끝이 보장된다.
import test from "node:test";
import assert from "node:assert/strict";
import { fitLabel, drawFittedLabel } from "../js/labelfit.js";

// 크기에 비례하는 가짜 잉크: px 당 왼쪽·오른쪽 거리
const linear = (leftPerPx, rightPerPx) => (px) => ({ left: leftPerPx * px, right: rightPerPx * px });

test("잉크가 폭 안에 들면(여유 2px 포함) 크기를 바꾸지 않는다 — 넘치지 않는 라벨은 다른 라벨과 같은 크기", () => {
  const r = fitLabel({ measure: linear(3, 3), width: 352, basePx: 44 }); // 잉크 264
  assert.equal(r.fontPx, 44);
  assert.equal(r.dx, 0);
});

test("잉크 + 여유 2px 가 정확히 폭이면 줄이지 않고 다시 재지도 않는다 — 경계는 넘침이 아니다", () => {
  // 경계에서 줄이는 걸음은 크기 × 350/350 이라 결과 크기만으로는 넘침으로 다뤘는지 안 보인다 — 잰 횟수로 본다
  let calls = 0;
  const r = fitLabel({ measure: () => { calls++; return { left: 175, right: 175 }; }, width: 352, basePx: 44 }); // 350 + 2 = 352
  assert.equal(r.fontPx, 44);
  assert.equal(calls, 1, "넘치지 않는 라벨은 한 번만 잰다");
});

test("잉크가 폭 안이어도 여유 2px 를 넘기면 줄인다 — 가짜 굵게로 번진 잉크가 가장자리에 닿지 않게", () => {
  const r = fitLabel({ measure: linear(351 / 88, 351 / 88), width: 352, basePx: 44 }); // 잉크 351 ≤ 352, 351 + 2 > 352
  assert.ok(r.fontPx < 44, `줄여야 한다: ${r.fontPx}`);
  const ink = (351 / 44) * r.fontPx;
  assert.ok(ink + 2 <= 352 + 1e-9, `줄인 뒤 잉크 ${ink}`);
});

test("넘치면 잉크 + 여유가 폭에 맞게 줄인다", () => {
  const r = fitLabel({ measure: linear(4, 4), width: 352, basePx: 44 }); // 잉크 352 → 넘침
  const ink = 8 * r.fontPx;
  assert.ok(ink + 2 <= 352 + 1e-9 && ink + 2 > 351, `잉크 ${ink} 가 폭에 맞아야 한다`);
});

test("가운데 정렬의 잉크가 한쪽으로 치우치면 그리는 x 를 옮겨 잉크 중심을 맞춘다 — 합이 들어도 한쪽이 잘리지 않게(170 / 178, 폭 352)", () => {
  const r = fitLabel({ measure: () => ({ left: 170, right: 178 }), width: 352, basePx: 44 });
  assert.equal(r.fontPx, 44, "합 348 + 2 ≤ 352 라 줄이지 않는다");
  assert.equal(r.dx, -4);
  // 옮긴 뒤 잉크는 [중심 + dx − left, 중심 + dx + right] = [−174, +174] 로 ±176 안이다
  assert.ok(Math.abs(r.dx - 170) <= 176 && Math.abs(r.dx + 178) <= 176);
});

test("폭이 크기에 비례하지 않으면 줄인 뒤 다시 재고, 아직 넘치면 한 번 더 줄인다", () => {
  // 잉크 = 6px + 120 — 비례로 한 번 줄이면 고정분 120 때문에 아직 넘친다
  const calls = [];
  const measure = (px) => { calls.push(px); return { left: 3 * px + 60, right: 3 * px + 60 }; };
  const r = fitLabel({ measure, width: 352, basePx: 44 });
  assert.ok(calls.length >= 3, `처음 + 두 번 이상 다시 재야 한다(${calls.length}번)`);
  const final = measure(r.fontPx);
  assert.ok(final.left + final.right + 2 <= 352 + 1e-6, `마지막 잉크 ${final.left + final.right}`);
});

test("끝까지 맞지 않는 측정이라도 maxTries 번에서 멈춘다 — 무한 반복 없음", () => {
  let calls = 0;
  const r = fitLabel({ measure: () => { calls++; return { left: 500, right: 500 }; }, width: 352, basePx: 44, maxTries: 4 });
  assert.equal(calls, 5, "처음 1번 + 4번");
  assert.ok(Number.isFinite(r.fontPx));
});

// 2D 컨텍스트 흉내: 실제 캔버스처럼 measureText 의 잉크 거리가 **지금 상태의 기준점**에서 잰 값이다.
// - 가로: actualBoundingBoxLeft/Right 는 textAlign 의 기준점에서 잰다. start·end 는 direction 에 따라 뒤집힌다(rtl 이면 start = 오른쪽).
//   글자 한 줄 = advance 안에 왼쪽 여백(bearing) 뒤 잉크.
// - 세로: actualBoundingBoxAscent/Descent 는 textBaseline 의 기준선에서 잰다. em 상자는 알파벳 기준선 위 0.8em · 아래 0.2em, 잉크는
//   위 0.7em · 아래 0.1em.
// 새 컨텍스트의 상태는 실제와 같다(start · alphabetic · inherit). 그린 잉크는 fillText 때의 상태로 계산해 drawn 에 남기고, 잴 때와
// 그릴 때의 상태 넷을 states 에 남긴다 — 물려받은 상태로 재거나 그리면 여기서 드러난다.
const BASELINE_BELOW_ANCHOR = { top: 0.8, hanging: 0.6, middle: 0.3, alphabetic: 0, ideographic: -0.2, bottom: -0.2 }; // em 단위
function fakeCtx({ inkPerPx, bearingPerPx = 2 / 44, advancePerPx }) {
  const log = [], states = [];
  const ctx = { textAlign: "start", textBaseline: "alphabetic", direction: "inherit", font: "10px sans-serif", fillStyle: "#000", log, states, drawn: [] };
  const px = () => Number(/(\d+(?:\.\d+)?)px/.exec(ctx.font)[1]);
  const metrics = () => {
    const p = px(), ink = inkPerPx * p, bearing = bearingPerPx * p, advance = advancePerPx * p;
    const rtl = ctx.direction === "rtl";
    const atRight = ctx.textAlign === "right" || (ctx.textAlign === "end" && !rtl) || (ctx.textAlign === "start" && rtl);
    const anchor = ctx.textAlign === "center" ? advance / 2 : atRight ? advance : 0;
    const below = BASELINE_BELOW_ANCHOR[ctx.textBaseline] * p;
    return {
      width: advance,
      actualBoundingBoxLeft: anchor - bearing, actualBoundingBoxRight: bearing + ink - anchor,
      actualBoundingBoxAscent: 0.7 * p - below, actualBoundingBoxDescent: below + 0.1 * p,
    };
  };
  const record = (op) => states.push({ op, font: ctx.font, textAlign: ctx.textAlign, textBaseline: ctx.textBaseline, direction: ctx.direction });
  ctx.measureText = () => { log.push("measure"); record("measure"); return metrics(); };
  ctx.clearRect = () => { log.push("clear"); };
  ctx.fillText = (text, x, y) => {
    log.push("fill"); record("fill");
    const m = metrics();
    ctx.drawn.push({ left: x - m.actualBoundingBoxLeft, right: x + m.actualBoundingBoxRight, top: y - m.actualBoundingBoxAscent, bottom: y + m.actualBoundingBoxDescent, px: px() });
  };
  return ctx;
}
const font = (px) => `600 ${px}px "Test Sans"`;

test("새 캔버스(정렬 기본값 start)에 처음 그려도 잉크가 캔버스 안 가운데에 든다 — 재는 정렬과 그리는 정렬이 같다", () => {
  // 잉크 232 · advance 238 (44px) — "|0000⟩ -π/8" 와 비슷한 폭. 폭 352 안에 넉넉히 든다
  const ctx = fakeCtx({ inkPerPx: 232 / 44, advancePerPx: 238 / 44 });
  const r = drawFittedLabel(ctx, { text: "|0000⟩ -π/8", width: 352, height: 120, basePx: 44, font });
  assert.equal(r.fontPx, 44);
  const [ink] = ctx.drawn;
  assert.ok(ink.left >= 0 && ink.right <= 352, `잉크 [${ink.left}, ${ink.right}] 가 캔버스 [0, 352] 밖이다`);
  assert.ok(Math.abs((ink.left + ink.right) / 2 - 176) < 1e-9, `잉크 중심 ${(ink.left + ink.right) / 2} ≠ 176`);
});

test("다시 그릴 때는 지운 뒤 그리고, 넘친 라벨은 돌려준 크기로 그린다 — 같은 캔버스에 옛 글자가 남지 않는다", () => {
  const ctx = fakeCtx({ inkPerPx: 400 / 44, advancePerPx: 406 / 44 }); // 44px 에서 잉크 400 > 350
  const r = drawFittedLabel(ctx, { text: "|111111⟩ -0.79π", width: 352, height: 120, basePx: 44, font });
  assert.ok(r.fontPx < 44);
  assert.deepEqual(ctx.log.slice(-2), ["clear", "fill"], `호출 순서 ${ctx.log.join(" → ")}`);
  const [ink] = ctx.drawn;
  assert.equal(ink.px, r.fontPx, "그린 크기 = 돌려준 크기");
  assert.ok(ink.right - ink.left + 2 <= 352 + 1e-9 && ink.left >= 0 && ink.right <= 352, `잉크 [${ink.left}, ${ink.right}]`);
});

test("이전 그리기가 textBaseline 을 top 으로 남겨도 세로 잉크가 캔버스 안 가운데에 든다", () => {
  const ctx = fakeCtx({ inkPerPx: 232 / 44, advancePerPx: 238 / 44 });
  ctx.textBaseline = "top"; // 같은 캔버스를 다른 기준선으로 쓴 그리기가 남긴 상태
  drawFittedLabel(ctx, { text: "|0000⟩ -π/8", width: 352, height: 120, basePx: 44, font });
  const [ink] = ctx.drawn;
  assert.ok(ink.top >= 0 && ink.bottom <= 120, `세로 잉크 [${ink.top}, ${ink.bottom}] 가 캔버스 [0, 120] 밖이다`);
  assert.ok(Math.abs((ink.top + ink.bottom) / 2 - 60) < 1e-9, `세로 잉크 중심 ${(ink.top + ink.bottom) / 2} ≠ 60`);
});

test("이전 그리기가 남긴 font · textAlign · textBaseline · direction 과 관계없이 잴 때와 그릴 때 모두 center · middle · ltr · 그 크기의 font 다", () => {
  const ctx = fakeCtx({ inkPerPx: 400 / 44, advancePerPx: 406 / 44 }); // 넘쳐서 여러 번 잰다
  Object.assign(ctx, { font: 'italic 99px "Old Face"', textAlign: "right", textBaseline: "top", direction: "rtl" });
  const r = drawFittedLabel(ctx, { text: "|111111⟩ -0.79π", width: 352, height: 120, basePx: 44, font });
  assert.ok(ctx.states.filter((s) => s.op === "measure").length >= 2, "여러 번 잰 경우를 본다");
  const bad = ctx.states.filter((s) => s.textAlign !== "center" || s.textBaseline !== "middle" || s.direction !== "ltr" || !/^600 [\d.]+px "Test Sans"$/.test(s.font));
  assert.deepEqual(bad, [], "물려받은 상태로 재거나 그렸다");
  assert.equal(ctx.states.at(-1).font, font(r.fontPx), "그린 font = 돌려준 크기의 font");
});
