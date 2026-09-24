// 디자인 토큰을 JS에서 읽는 단일 창구.
// 색을 JS에 하드코딩하면 style.css의 램프와 조용히 어긋난다(예전에 3D 구·차트 색이 그랬다).
// 항상 CSS 변수에서 읽어 **정의는 style.css 한 곳에만** 둔다.
//
// 주의: 값을 모듈 로드 시점에 캐시하지 않는다 — 스타일시트가 아직 적용되기 전일 수 있다.

/** CSS 변수 값을 문자열로 (예: token("--gray-7") → "#d7dbdf"). */
export function token(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * CSS 변수 값을 숫자로 (예: tokenPx("--prob-chart-min") → 96).
 * 이름은 px 지만 parseFloat 라 **단위를 보지 않고 숫자 부분만** 읽는다 —
 * 단위 없는 비율 토큰(tokenPx("--c1") → 18)도 이 함수로 읽는다. 단위가 섞이지 않게
 * 쓰는 쪽에서 무엇을 읽는지 알고 부른다.
 * 변수가 없으면 getPropertyValue 가 빈 문자열을 주고 parseFloat 가 NaN 이 된다.
 * 그 NaN 이 style 에 들어가면 브라우저가 무효 값으로 조용히 무시해 원인을 찾기 어렵다 —
 * 그래서 경고를 남기고 0 을 돌려준다. 0 이면 계산 결과가 눈에 띄게 작아져 증상이 보인다.
 * 대체값을 인자로 받지 않는다 — 받으면 그 값이 JS 로 되살아나 정의처가 둘이 된다.
 */
export function tokenPx(name) {
  const v = parseFloat(token(name));
  if (Number.isFinite(v)) return v;
  console.warn(`tokenPx: ${name} 를 px 로 읽지 못했다 (값: "${token(name)}").`);
  return 0;
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
