// 확률 막대 차트의 축/라벨 배치를 위한 순수 로직(DOM 무관, 테스트 가능).

// 라벨 모드가 X축에 요구하는 하단 여백(px). **모드를 고르는 곳이 그 대가도 갖는다** —
// 예전에는 probview 의 두 함수가 각각 `mode === "rot45" ? 46 : 24` 를 베껴 적고 있었다.
export const LABEL_BOTTOM = { horizontal: 24, rot45: 46, sparse: 24 };

// 차트 내부 좌표(디자인 명세 [5] 의 허용 예외 — 레이아웃 여백이 아니라 좌표계다).
const CHART_TOP_PX = 12;  // 플롯 위 여백
const MIN_PLOT_PX = 60;   // Y 눈금 6개(0/20/…/100)가 --text-xs(10px)에서 겹치지 않는 하한

// X축 라벨 표시 전략. count = 숨김 적용 후 표시 상태 수, bandWidth = 막대 밴드 픽셀폭,
// labelPx = 가로 라벨의 예상 픽셀폭. 반환: "horizontal" | "rot45" | "sparse".
// 규칙: ≤8 가로, 9~16 45°, ≥17 sparse. 단 겹치면(밴드가 좁으면) 다음 단계로 강등한다.
//
// **높이도 강등 조건이다.** 45°는 하단 46px 를 쓰는데, 그걸 떼고 나면 플롯이 읽히지 않을
// 만큼만 남는 높이가 있다. 그때는 라벨을 잘라 보여주는 대신 sparse(인덱스 눈금)로 내린다 —
// 확률 패널의 최소 높이를 sparse 기준으로 잡을 수 있는 근거가 이 강등이다.
// chartHeight 를 주지 않으면 높이 제약이 없는 것으로 본다(기존 호출 그대로 동작).
export function pickLabelMode(count, bandWidth, labelPx, { chartHeight = Infinity, topPx = CHART_TOP_PX, minPlotPx = MIN_PLOT_PX } = {}) {
  let mode = count <= 8 ? "horizontal" : count <= 16 ? "rot45" : "sparse";
  if (mode === "horizontal" && labelPx + 4 > bandWidth) mode = "rot45";
  if (mode === "rot45" && bandWidth < 11) mode = "sparse";
  if (mode === "rot45" && chartHeight - topPx - LABEL_BOTTOM.rot45 < minPlotPx) mode = "sparse";
  return mode;
}

// sparse 모드 인덱스 눈금 간격(위치 기준). 밴드폭에서 minGapPx 이상 벌어지도록
// 2의 거듭제곱으로 올림(…,0,8,16,24 같은 눈금이 겹치지 않게).
export function niceTickStep(bandWidth, minGapPx = 40) {
  const raw = Math.max(1, Math.ceil(minGapPx / Math.max(bandWidth, 0.001)));
  let step = 1;
  while (step < raw) step *= 2;
  return step;
}

// 진폭 re+im·i 의 위상. 진폭이 0이면 위상 미정의(defined:false).
export function phaseInfo(re, im) {
  const mag = Math.hypot(re, im);
  if (mag < 1e-9) return { defined: false, rad: 0, deg: 0 };
  const rad = Math.atan2(im, re);
  return { defined: true, rad, deg: (rad * 180) / Math.PI };
}
