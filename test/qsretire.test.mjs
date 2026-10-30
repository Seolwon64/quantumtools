// Q-sphere 노드 버리기(js/qsretire.js) — 공유 자원은 버리지 않고, 쓰던 자원은 빠짐없이 한 번만, 페이드가 끝난 뒤에만 버린다.
import test from "node:test";
import assert from "node:assert/strict";
import { resourcesToDispose, createFadeLedger } from "../js/qsretire.js";

// three.js 노드 흉내: 지오메트리 · 머티리얼(map 은 텍스처) · userData. 이름만 붙인 빈 객체라 같은지만 본다.
const res = (name) => ({ name });
const SHARED_SPRITE_QUAD = res("공유 스프라이트 사각형");
const SHARED_MARKER_SPHERE = res("공유 마커 구");
const label = (n) => ({ name: `라벨${n}`, userData: {}, geometry: SHARED_SPRITE_QUAD, material: { name: `라벨${n} 머티리얼`, map: res(`라벨${n} 텍스처`) } });
const stem = (n) => ({ name: `스템${n}`, userData: { ownsGeometry: true }, geometry: res(`스템${n} 지오메트리`), material: { name: `스템${n} 머티리얼` } });
const marker = (n) => ({ name: `마커${n}`, userData: {}, geometry: SHARED_MARKER_SPHERE, material: { name: `마커${n} 머티리얼` } });
const names = (xs) => xs.map((x) => x.name).sort();

test("라벨 · 스템 · 마커를 버릴 때 라벨 텍스처는 버리고 공유 지오메트리(스프라이트 사각형 · 마커 구)는 버리지 않는다", () => {
  const r = resourcesToDispose([label(1), stem(1), marker(1)]);
  assert.deepEqual(names(r.textures), ["라벨1 텍스처"], "라벨의 CanvasTexture 를 버리지 않으면 재생마다 GPU 에 남는다");
  assert.deepEqual(names(r.geometries), ["스템1 지오메트리"], "자기 지오메트리를 가진 스템만 — 공유 지오메트리를 버리면 다음 프레임에 다시 올린다");
  assert.deepEqual(names(r.materials), ["라벨1 머티리얼", "마커1 머티리얼", "스템1 머티리얼"]);
});

test("여러 노드가 같은 머티리얼을 써도 한 번만 버린다 — 링끼리 공유하는 머티리얼", () => {
  const ringMat = { name: "링 머티리얼" };
  const rings = [1, 2, 3].map((n) => ({ name: `링${n}`, userData: { ownsGeometry: true }, geometry: res(`링${n} 지오메트리`), material: ringMat }));
  const r = resourcesToDispose(rings);
  assert.equal(r.materials.length, 1);
  assert.equal(r.geometries.length, 3);
});

test("머티리얼도 자기 지오메트리도 없는 객체(그룹)는 아무것도 버리지 않는다", () => {
  assert.deepEqual(resourcesToDispose([{ name: "그룹", userData: {}, children: [] }]), { geometries: [], materials: [], textures: [] });
});

test("끝난 페이드는 사라져 가는 쪽을 한 번만 돌려준다 — 같은 토큰을 다시 정리하면 아무것도 없다", () => {
  const ledger = createFadeLedger();
  const old = [label(1), stem(1)], fresh = [label(2)];
  const t = ledger.begin({ outgoing: old, incoming: fresh });
  assert.deepEqual(names(ledger.settle(t)), ["라벨1", "스템1"]);
  assert.deepEqual(ledger.settle(t), [], "두 번째 정리가 같은 노드를 또 버리면 안 된다");
});

test("페이드 중에 새 페이드가 오면 앞 토큰은 아무것도 버리지 않고, 뒤 토큰이 앞 페이드의 두 쪽을 한 번씩 버린다", () => {
  const ledger = createFadeLedger();
  const o1 = [label(1)], n1 = [label(2)], n2 = [label(3)];
  const a = ledger.begin({ outgoing: o1, incoming: n1 });
  // 호출자가 앞 페이드의 노드를 outgoing 으로 넘기지 않아도 장부가 이어받는다(빠뜨려도 새지 않는다)
  const b = ledger.begin({ outgoing: [], incoming: n2 });
  assert.deepEqual(ledger.settle(a), [], "밀려난 페이드의 끝 정리는 아무것도 버리지 않는다");
  assert.deepEqual(names(ledger.settle(b)), ["라벨1", "라벨2"]);
});

test("페이드 중에 그룹을 통째로 비우면(cancel) 남은 끝 정리는 아무것도 버리지 않는다 — 두 번 버리지 않는다", () => {
  const ledger = createFadeLedger();
  const t = ledger.begin({ outgoing: [label(1)], incoming: [label(2)] });
  ledger.cancel(); // setQSphereData 가 두 그룹을 비우며 old · new 를 모두 버린다
  assert.deepEqual(ledger.settle(t), []);
});

test("지금 보이는 쪽(incoming)은 outgoing 으로 잘못 넘겨도 버리지 않는다", () => {
  const ledger = createFadeLedger();
  const visible = label(2);
  const t = ledger.begin({ outgoing: [label(1), visible], incoming: [visible] });
  assert.deepEqual(names(ledger.settle(t)), ["라벨1"]);
});
