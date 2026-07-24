// 확률 막대 차트의 축/라벨 배치를 위한 순수 로직(DOM 무관, 테스트 가능).

// X축 라벨 표시 전략. count = 숨김 적용 후 표시 상태 수, bandWidth = 막대 밴드 픽셀폭,
// labelPx = 가로 라벨의 예상 픽셀폭. 반환: "horizontal" | "rot45" | "sparse".
// 규칙: ≤8 가로, 9~16 45°, ≥17 sparse. 단 겹치면(밴드가 좁으면) 다음 단계로 강등한다.
export function pickLabelMode(count, bandWidth, labelPx) {
  let mode = count <= 8 ? "horizontal" : count <= 16 ? "rot45" : "sparse";
  if (mode === "horizontal" && labelPx + 4 > bandWidth) mode = "rot45";
  if (mode === "rot45" && bandWidth < 11) mode = "sparse";
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
