// 축소 밀도행렬 · 순도 · 블로흐 벡터 — 확률 패널의 DM 뷰와 Bloch sphere가 공유하는 모듈.
// 노이즈 없는 시뮬레이터의 전역 상태는 항상 순수 상태라, 전체 2^n×2^n 밀도행렬은
// 상태벡터와 정보량이 같고 n이 크면 표시 불가하다. 그래서 큐비트 k의 2×2 축소 밀도행렬만
// O(2^n)로 계산한다(전체 행렬을 만들지 않는다).

// 큐비트 k의 2×2 축소 밀도행렬. 반환 [[rho00, rho01],[rho10, rho11]] (각 원소 {re,im}).
//   rho00 = Σ_{bit k=0} |psi[i]|^2
//   rho11 = Σ_{bit k=1} |psi[i]|^2
//   rho01 = Σ_{bit k=0} psi[i]·conj(psi[i | (1<<k)]) ,  rho10 = conj(rho01)
export function reducedDensityMatrix(state, k) {
  const bit = 1 << k;
  let r00 = 0, r11 = 0, re01 = 0, im01 = 0;
  for (let i = 0; i < state.length; i++) {
    if (i & bit) continue;
    const a = state[i];       // bit k = 0
    const b = state[i | bit]; // bit k = 1
    r00 += a.re * a.re + a.im * a.im;
    r11 += b.re * b.re + b.im * b.im;
    // rho01 += a · conj(b)
    re01 += a.re * b.re + a.im * b.im;
    im01 += a.im * b.re - a.re * b.im;
  }
  return [
    [{ re: r00, im: 0 }, { re: re01, im: im01 }],
    [{ re: re01, im: -im01 }, { re: r11, im: 0 }],
  ];
}

// 블로흐 벡터: rx = 2·Re(rho01), ry = −2·Im(rho01), rz = rho00 − rho11.
export function blochVectorFromRho(rho) {
  return { x: 2 * rho[0][1].re, y: -2 * rho[0][1].im, z: rho[0][0].re - rho[1][1].re };
}
export function qubitBlochVector(state, q) {
  return blochVectorFromRho(reducedDensityMatrix(state, q));
}

// Purity = Tr(rho^2) = rho00^2 + rho11^2 + 2|rho01|^2. 축약 2×2에서 0.5 ~ 1.
export function purityFromRho(rho) {
  const diag = rho[0][0].re * rho[0][0].re + rho[1][1].re * rho[1][1].re;
  const off = 2 * (rho[0][1].re * rho[0][1].re + rho[0][1].im * rho[0][1].im);
  return diag + off;
}

// 한 번에: { rho, bloch:{x,y,z}, r:|r|, purity, mixedness }.
// mixedness = 2·(1 − purity)  (= 1 − |r|^2), 범위 0~1.
export function reducedDensityInfo(state, q) {
  const rho = reducedDensityMatrix(state, q);
  const bloch = blochVectorFromRho(rho);
  const r = Math.hypot(bloch.x, bloch.y, bloch.z);
  const p = purityFromRho(rho);
  return { rho, bloch, r, purity: p, mixedness: 2 * (1 - p) };
}
