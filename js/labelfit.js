// 캔버스 라벨 맞춤 — 잉크가 캔버스 폭(여유 포함) 안에 들게 글자를 줄이고, 잉크 중심을 캔버스 중심에 맞춘다(DOM 없음, ctx 는 주입).
//
// Q-sphere 위상 라벨이 라벨 캔버스 폭을 넘어 가운데 정렬된 글자의 양 끝이 잘렸다(6큐비트 위상 회로에서 Geist 4개, Plex 20개 —
// Plex 숫자는 늘 600 단위라 1 이 많은 라벨이 넓어졌다, 실측). 캔버스를 넓힌 뒤에도 넘치는 라벨이 생기면 그 라벨만 줄인다.
// - 판정은 advance(measureText().width)가 아니라 **잉크**로 한다 — 가짜 굵게(QT Math)처럼 잉크가 advance 밖으로 나온다.
// - textAlign center 에서 actualBoundingBoxLeft/Right 는 기준점에서 잉크 끝까지의 거리라, 합이 폭 안이어도 한쪽이 잘릴 수 있다
//   (예: 170 / 178, 폭 352). 그래서 그리는 x 를 (left − right) / 2 만큼 옮겨 잉크 중심을 캔버스 중심에 맞춘다.
// - measure(px) 는 그 크기로 잰 잉크 { left, right } 를 돌려준다. 폭이 크기에 꼭 비례하지는 않아(힌팅·반올림·크기와 함께
//   줄지 않는 몫) 줄인 뒤 다시 재고, 아직 넘치면 한 번 더 줄인다 — maxTries 번에서 멈춘다(무한 반복 없음).
//   첫 걸음은 비례, 그다음은 앞의 두 측정을 잇는 직선(할선)으로 간다 — 비례만 되풀이하면 크기와 함께 줄지 않는 몫 때문에
//   목표에 기하급수로만 다가가 상한 안에 못 들었다(테스트의 "잉크 = 6px + 120" 에서 네 번 뒤 350.4 > 350).

/** @returns {{ fontPx: number, dx: number }} dx 는 캔버스 중심에서 그리는 x 를 옮길 양 */
export function fitLabel({ measure, width, basePx, marginPx = 2, maxTries = 4 }) {
  const target = width - marginPx;
  let fontPx = basePx;
  let ink = measure(fontPx);
  let w = ink.left + ink.right;
  let prev = null;
  for (let i = 0; i < maxTries && w > target; i++) {
    let next = fontPx * (target / w);
    if (prev && w !== prev.w) {
      const secant = fontPx - (w - target) * (fontPx - prev.px) / (w - prev.w);
      if (Number.isFinite(secant) && secant > 0 && secant < fontPx) next = secant; // 줄이는 쪽으로만
    }
    prev = { px: fontPx, w };
    fontPx = next;
    ink = measure(fontPx);
    w = ink.left + ink.right;
  }
  return { fontPx, dx: (ink.left - ink.right) / 2 };
}

// fitLabel 로 재고 그 결과로 그린다 — 재는 정렬과 그리는 정렬이 같아야 해서 한 함수에 둔다.
// actualBoundingBoxLeft/Right 는 **그때의 textAlign 기준점**에서 잰 거리다. 처음에는 정렬을 그리기 직전에만 center 로 두어,
// 새 캔버스(기본값 "start")에서 잰 첫 그림이 L ≈ 0 · R ≈ 잉크 폭으로 dx ≈ −잉크/2 를 얻어 라벨마다 왼쪽이 잘렸다
// (회로를 바꿔 새로 만든 라벨 — 폰트가 도착해 다시 그린 라벨은 정렬이 이미 center 라 멀쩡해서 숨어 있었다, 실측). 그래서 재기와
// 그리기에 영향을 주는 상태 넷 — font · textAlign · textBaseline · direction — 을 재기 전에 직접 정하고, 이전 그리기에서 물려받지
// 않는다(font 는 잴 때마다·그릴 때 정한다). 나머지 글자 상태(letterSpacing · wordSpacing · fontKerning)와 그리기 상태(변환 ·
// globalAlpha · filter · shadow)는 정하지 않는다 — ctx 가 라벨 하나 전용이고 js/ 어디에서도 그 상태를 쓰지 않아 늘 기본값이다.
// 다시 그리기는 같은 캔버스를 쓰므로 그리기 전에 지운다.
/** @param {(px: number) => string} font 크기 → ctx.font 문자열 */
export function drawFittedLabel(ctx, { text, width, height, basePx, font, marginPx, maxTries }) {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.direction = "ltr";
  const fit = fitLabel({
    width,
    basePx,
    marginPx,
    maxTries,
    measure: (px) => {
      ctx.font = font(px);
      const m = ctx.measureText(text);
      return { left: m.actualBoundingBoxLeft, right: m.actualBoundingBoxRight };
    },
  });
  ctx.clearRect(0, 0, width, height);
  ctx.font = font(fit.fontPx);
  ctx.fillText(text, width / 2 + fit.dx, height / 2);
  return fit;
}
