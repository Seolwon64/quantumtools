// 위상(phase) → 색 매핑. **색상환 범례와 Q-sphere 노드가 반드시 공유하는 단 하나의 정의.**
// (예전에는 노드는 JS의 HSL hue 보간, 색상환은 CSS conic-gradient 하드코딩이라 서로 달랐다 —
//  그러면 범례가 거짓말을 한다.)
//
// 왜 Oklch인가: 순수 HSL hue는 지각 밝기가 불균일해(노랑이 파랑보다 훨씬 밝다) 특정 위상이
// 강조된 것처럼 보이는 착시가 생긴다. 위상은 크기 개념이 없는 순환량이므로 밝기 차이는 곧
// 데이터 왜곡이다. Oklch에서 **L(밝기)과 C(채도)를 고정하고 hue만 0→360으로 돌리면**
// 모든 위상의 지각 밝기가 설계상 동일해지고, 2π에서 0으로 이어지는 순환성도 구조적으로 보장된다.
// C를 낮게 잡아 파스텔 톤으로 만든다.

const L = 0.72; // 밝기(0~1) — 모든 위상에서 고정
const C = 0.11; // 채도 — 낮춰서 파스텔. 높이면 sRGB 밖으로 나가 클램프되며 균일성이 깨진다.
const HUE_OFFSET = 25; // 위상 0을 살짝 따뜻한 색에서 시작(기존 "0 = 빨강" 감각 유지)

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Oklab → 선형 sRGB (Björn Ottosson)
function oklabToLinearSrgb(Lp, a, b) {
  const l_ = Lp + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = Lp - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = Lp - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}

// 선형 → 감마 보정 sRGB
function linearToSrgb(x) {
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(clamp01(x), 1 / 2.4) - 0.055;
}

/**
 * 위상(라디안) → sRGB. 0~1 범위의 {r,g,b}.
 * 순환: phaseToRgb(θ) === phaseToRgb(θ + 2πk). 음수 위상도 정규화된다.
 */
export function phaseToRgb(phaseRad) {
  const turn = ((phaseRad / (2 * Math.PI)) % 1 + 1) % 1; // 0..1 (2π에서 0으로 되돌아온다)
  const hueDeg = turn * 360 + HUE_OFFSET;
  const h = (hueDeg * Math.PI) / 180;
  const [lr, lg, lb] = oklabToLinearSrgb(L, C * Math.cos(h), C * Math.sin(h));
  return {
    r: clamp01(linearToSrgb(lr)),
    g: clamp01(linearToSrgb(lg)),
    b: clamp01(linearToSrgb(lb)),
  };
}

const to255 = (v) => Math.round(clamp01(v) * 255);

/** 위상 → "rgb(r, g, b)" CSS 문자열 (색상환 그라디언트용). */
export function phaseToCss(phaseRad) {
  const { r, g, b } = phaseToRgb(phaseRad);
  return `rgb(${to255(r)}, ${to255(g)}, ${to255(b)})`;
}

/**
 * 색상환(conic-gradient)용 색 스톱 목록. 노드와 **같은 함수**에서 나오므로 범례가 항상 정확하다.
 * 각도는 CSS conic-gradient 기준(0deg = 위쪽, 시계방향).
 * 색상환은 화면에서 "오른쪽 = 위상 0, 반시계 방향으로 증가"로 읽히도록 매핑한다.
 */
export function phaseWheelStops(steps = 36) {
  const stops = [];
  for (let i = 0; i <= steps; i++) {
    const deg = (360 * i) / steps;
    stops.push({ deg, color: phaseToCss(cssAngleToPhase(deg)) });
  }
  return stops;
}

/** CSS conic 각도(0deg=위, 시계방향) → 위상 라디안(오른쪽=0, 반시계 증가). */
export function cssAngleToPhase(deg) {
  // 위쪽(0deg)은 위상 π/2, 오른쪽(90deg)은 위상 0 → 시계방향으로 갈수록 위상이 준다.
  return ((90 - deg) * Math.PI) / 180;
}

/** conic-gradient CSS 값 문자열. */
export function phaseWheelGradient(steps = 36) {
  const parts = phaseWheelStops(steps).map((s) => `${s.color} ${s.deg}deg`);
  return `conic-gradient(from 0deg, ${parts.join(", ")})`;
}
