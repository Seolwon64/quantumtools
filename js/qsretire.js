// Q-sphere 노드를 언제 · 무엇을 버리나 — 크로스페이드 수명 장부와 GPU 자원 고르기(Three.js · DOM 없음).
//
// 버리는 길이 셋(setQSphereData 의 clearGroup · 크로스페이드 끝 정리 · 링 다시 짓기)이었고 규칙이 갈라져 있었다. 크로스페이드 끝
// 정리는 라벨 텍스처(material.map)를 버리지 않아 재생마다 라벨 수만큼 GPU 텍스처가 남았고(3큐비트 3스텝 회로에서 재생마다 +17,
// 20번에 340 — 실측), 반대로 공유 지오메트리(마커 구 · three.js 스프라이트 사각형)는 버려 다음 프레임에 다시 올렸다. 링 다시 짓기는
// 링끼리 공유하는 머티리얼을 링 수만큼 되풀이해 버렸다. 그래서 "무엇을" 은 resourcesToDispose 한 곳에서 고르고, "언제" 는
// createFadeLedger 가 정한다 — 페이드가 끝난 뒤 한 번만, 중간에 다른 갱신이 오면 그쪽이 맡는다.

/**
 * 버릴 노드들이 쓰는 GPU 자원을 겹치지 않게 고른다.
 * - 지오메트리는 그 노드가 가진다고 표시한 것(`userData.ownsGeometry`)만 버린다. 마커는 공유 구를, 스프라이트는 three.js 의 공유
 *   사각형을 쓴다 — 버리면 지우는 것이 아니라 다음 프레임에 다시 올린다(재생마다 17번, 실측).
 * - 머티리얼은 모두 버린다. Q-sphere 노드는 머티리얼을 노드마다 새로 만들고 계속 남는 객체(실루엣 · 극축 · 축 라벨)와 공유하지
 *   않는다. 같은 머티리얼을 여러 노드가 쓰면(링끼리의 `ringMat`) 한 번만 넣는다.
 * - 텍스처는 머티리얼의 `map` 이다.
 * @returns {{ geometries: object[], materials: object[], textures: object[] }}
 */
export function resourcesToDispose(objects) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  for (const obj of objects) {
    if (obj.userData?.ownsGeometry && obj.geometry) geometries.add(obj.geometry);
    const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
    for (const m of mats) {
      materials.add(m);
      if (m.map) textures.add(m.map);
    }
  }
  return { geometries: [...geometries], materials: [...materials], textures: [...textures] };
}

/**
 * 크로스페이드 하나의 수명 장부. 사라져 가는 쪽(outgoing)은 페이드가 **끝난 뒤에만**, **한 번만** 버린다.
 * - `begin({ outgoing, incoming })` → 토큰. 끝나지 못한 페이드가 있으면 그 outgoing · incoming 을 새 outgoing 에 합친다 — 새 페이드가
 *   시작되면 앞 페이드의 두 쪽 모두 이제 사라질 것이고, 호출자가 빠뜨려도 새지 않게 장부가 이어받는다.
 * - `settle(token)` → 그 토큰이 지금 페이드면 outgoing 에서 지금 보이는 incoming 을 뺀 목록을 돌려주고 장부를 비운다. 지난 토큰(새
 *   페이드에 밀렸거나 cancel 된 것)이면 [] — 그 끝 정리가 남의 노드를 버리거나 같은 노드를 두 번 버리지 않는다.
 * - `cancel()` → 진행 중인 페이드를 무효로 한다. setQSphereData 처럼 그룹을 통째로 비우는 쪽이 그 노드를 맡을 때 부른다 — 예전에는
 *   일시정지 · 모드 전환 · 회로 편집이 페이드 200ms 안에 오면 비운 뒤 남은 끝 정리가 old 를 한 번 더 버렸다.
 */
export function createFadeLedger() {
  let active = null; // { token, outgoing: Set, incoming: Set }
  let nextToken = 1;
  return {
    begin({ outgoing = [], incoming = [] } = {}) {
      const out = new Set(outgoing);
      if (active) for (const o of [...active.outgoing, ...active.incoming]) out.add(o);
      active = { token: nextToken++, outgoing: out, incoming: new Set(incoming) };
      return active.token;
    },
    settle(token) {
      if (!active || active.token !== token) return [];
      const { outgoing, incoming } = active;
      active = null;
      return [...outgoing].filter((o) => !incoming.has(o));
    },
    cancel() {
      active = null;
    },
  };
}
