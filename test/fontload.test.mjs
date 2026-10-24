// 폰트 도착 알림(js/fontload.js) — 몰린 적재는 한 번으로, 구독 전에 끝난 적재와 늦게 온 면도 놓치지 않는다.
import test from "node:test";
import assert from "node:assert/strict";
import { onFontFacesLoaded } from "../js/fontload.js";

// document.fonts 흉내: EventTarget + ready 프로미스. ready 는 이미 풀렸거나(로드 끝) 나중에 풀린다.
function fakeFonts({ ready = "pending" } = {}) {
  const fonts = new EventTarget();
  let resolve;
  fonts.ready = ready === "resolved" ? Promise.resolve(fonts) : new Promise((r) => { resolve = r; });
  fonts.resolveReady = () => resolve?.(fonts);
  fonts.load = () => fonts.dispatchEvent(new Event("loadingdone"));
  return fonts;
}
// requestAnimationFrame 흉내: 프레임을 손으로 넘긴다
function fakeRaf() {
  const queue = [];
  const raf = (fn) => { queue.push(fn); };
  raf.frame = () => { for (const fn of queue.splice(0)) fn(); };
  return raf;
}
const microtasks = () => new Promise((r) => setTimeout(r, 0));

test("한 프레임 안에 몰린 loadingdone 세 번은 콜백 한 번이다 — 면이 연달아 와도 다시 재기는 한 번이면 된다", async () => {
  const fonts = fakeFonts(), raf = fakeRaf();
  let n = 0;
  onFontFacesLoaded(() => n++, { fonts, raf });
  fonts.load(); fonts.load(); fonts.load();
  raf.frame();
  assert.equal(n, 1);
});

test("구독 전에 적재가 끝났어도(ready 가 이미 풀림) 한 번 부른다 — loadingdone 은 지나간 적재를 알려 주지 않는다", async () => {
  const fonts = fakeFonts({ ready: "resolved" }), raf = fakeRaf();
  let n = 0;
  onFontFacesLoaded(() => n++, { fonts, raf });
  await microtasks();
  raf.frame();
  assert.equal(n, 1);
});

test("첫 적재 뒤 늦게 온 면은 다시 한 번 부른다 — 분할 면은 그 글자가 처음 나올 때 온다", async () => {
  const fonts = fakeFonts({ ready: "resolved" }), raf = fakeRaf();
  let n = 0;
  onFontFacesLoaded(() => n++, { fonts, raf });
  await microtasks();
  raf.frame();
  fonts.load();
  raf.frame();
  assert.equal(n, 2);
});

test("ready 와 loadingdone 이 같은 프레임에 오면 한 번으로 합친다", async () => {
  const fonts = fakeFonts(), raf = fakeRaf();
  let n = 0;
  onFontFacesLoaded(() => n++, { fonts, raf });
  fonts.load();
  fonts.resolveReady();
  await microtasks();
  raf.frame();
  assert.equal(n, 1);
});
