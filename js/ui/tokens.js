// 디자인 토큰을 JS에서 읽는 단일 창구.
// 색을 JS에 하드코딩하면 style.css의 램프와 조용히 어긋난다(예전에 3D 구·차트 색이 그랬다).
// 항상 CSS 변수에서 읽어 **정의는 style.css 한 곳에만** 둔다.
//
// 주의: 값을 모듈 로드 시점에 캐시하지 않는다 — 스타일시트가 아직 적용되기 전일 수 있다.

/** CSS 변수 값을 문자열로 (예: token("--gray-7") → "#d7dbdf"). */
export function token(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** CSS 변수 값을 three.js용 숫자 색으로 (예: 0xd7dbdf). #RGB 축약형도 처리한다. */
export function tokenHex(name) {
  let v = token(name);
  if (v.startsWith("#")) {
    v = v.slice(1);
    if (v.length === 3) v = v.split("").map((c) => c + c).join("");
    return parseInt(v.slice(0, 6), 16);
  }
  const m = v.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  if (m) return (Math.round(+m[1]) << 16) | (Math.round(+m[2]) << 8) | Math.round(+m[3]);
  return 0x000000;
}

/** 액센트에 알파를 섞은 색 (데이터 셀 음영 등). CSS color-mix로 램프와 어긋나지 않게. */
export function accentAlpha(fraction) {
  const pct = Math.max(0, Math.min(1, fraction)) * 100;
  return `color-mix(in srgb, var(--accent-9) ${pct.toFixed(1)}%, transparent)`;
}
