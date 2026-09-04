// 스텝 재생 전환 애니메이션과 재생 위치 인디케이터. 시각적 트윈만 하고 양자 상태는 만들지 않는다.
//
// 의존은 initPlayback 으로 주입받는다. circuit 과 sphereMode 는 **getter** 로 받는데,
// 컨트롤러가 생성 도중 onChange 를 부르므로(circuit.js 끝의 notify) 이 모듈이 컨트롤러보다
// **먼저** 초기화돼야 하기 때문이다. sphereMode 는 런타임에 바뀌므로 값으로 받을 수 없다.

// 주입되는 의존. initPlayback 전에는 undefined 다.
let getSnapshot, getSphereMode, scene, probDisplay, buildProbTween, circuitGrid, probList;

/** 의존을 주입하고 공개 API 를 돌려준다. **컨트롤러를 만들기 전에** 부른다. */
export function initPlayback({ getSnapshot: gs, getSphereMode: gm, scene: s, probDisplay: pd, buildProbTween: bt, els }) {
  getSnapshot = gs;
  getSphereMode = gm;
  scene = s;
  probDisplay = pd;
  buildProbTween = bt;
  circuitGrid = els.circuitGrid;
  probList = els.probList;
  return { runStepTransition, delay, stepPause, stepIndicatorX, attachIndicator };
}

/** 그리드를 다시 지은 뒤 새 인디케이터 엘리먼트를 등록한다. */
export function attachIndicator(el) {
  stepIndicatorEl = el;
  highlightedCol = -1; // 셀이 새로 만들어져 하이라이트 클래스는 사라졌다
}

// ---------- 스텝 재생 전환 애니메이션 ([1] 시각적 트윈만, U^t 미사용) ----------
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// 스텝당 전환/정지 시간. 속도 선택 UI를 없애고 기존 "Normal" 값으로 고정한다
// (≈1초/스텝 — 예전 500ms보다 느린 이 값을 유지해야 한다).
const STEP_DURATION = 700;
const STEP_PAUSE = 300;
const stepDuration = () => (reducedMotion ? 0 : STEP_DURATION);
const stepPause = () => STEP_PAUSE;

// [5] 스텝 인디케이터: 스텝 k = 적용된 열 k → 열 k의 왼쪽 경계 x.
let stepIndicatorEl = null;
let highlightedCol = -1;
function stepIndicatorX(step) {
  // 열 k의 **왼쪽 경계**. 애니메이션 중에도 불리므로 그리드를 다시 짓지 않고 셀만 읽는다.
  const gridRect = circuitGrid.getBoundingClientRect();
  const cell = circuitGrid.querySelector(`.grid-cell[data-col="${step}"][data-qubit="0"]`);
  if (cell) return Math.round(cell.getBoundingClientRect().left - gridRect.left) - 2;
  // step이 마지막 열을 넘어선 경우(전 스텝 재생 완료): 마지막 셀의 오른쪽 끝에 세운다.
  const cells = circuitGrid.querySelectorAll('.grid-cell[data-qubit="0"]');
  const last = cells[cells.length - 1];
  return last ? Math.round(last.getBoundingClientRect().right - gridRect.left) - 2 : 0;
}
function setStepIndicator(x) {
  if (stepIndicatorEl) stepIndicatorEl.style.transform = `translateX(${x}px)`;
}
function highlightColumn(col) {
  if (col === highlightedCol) return;
  if (highlightedCol >= 0) {
    for (const c of circuitGrid.querySelectorAll(`.grid-cell[data-col="${highlightedCol}"]`)) c.classList.remove("step-col-active");
  }
  if (col >= 0) {
    for (const c of circuitGrid.querySelectorAll(`.grid-cell[data-col="${col}"]`)) c.classList.add("step-col-active");
  }
  highlightedCol = col;
}

// 한 스텝 전환을 rAF로 트윈한다([6]). 확률 막대 + 스텝 인디케이터 + (모드에 따라) 블로흐/ Q-sphere.
function runStepTransition(tr) {
  const duration = stepDuration();
  const W = probList.clientWidth, H = probList.clientHeight;
  // 확률 패널이 고전 비트를 보고 있으면 큐비트 기저 막대를 트윈하지 않는다 —
  // 축이 다른 두 분포를 보간하는 셈이라 라벨과 막대가 어긋난다. 전환 후 다시 그려진다.
  const chartIsQubits = probDisplay(getSnapshot()).kind === "qubits";
  const tween = (W > 40 && H > 40 && chartIsQubits) ? buildProbTween(tr.fromProbs, tr.toProbs, tr.qubitCount, W, H) : null;
  if (tween) { probList.innerHTML = ""; probList.appendChild(tween.svg); }

  // 구/노드: Bloch 모드는 화살표 트윈, Q-sphere 모드는 짧은 크로스페이드([3], 위치·색 보간 없음)
  if (getSphereMode() === "bloch") {
    if (duration <= 0) scene.setVectorInstant(tr.toBloch);
    else scene.animateVectorTo(tr.fromBloch, tr.toBloch, duration);
  } else {
    scene.crossfadeQSphere(tr.toProbs, tr.qubitCount, duration <= 0 ? 0 : Math.min(200, duration));
  }

  const fromX = stepIndicatorX(tr.fromStep);
  const toX = stepIndicatorX(tr.toStep);
  highlightColumn(Math.min(tr.fromStep, tr.toStep)); // 적용 중인 열 강조

  return new Promise((resolve) => {
    const finish = () => { if (tween) tween.update(1); setStepIndicator(toX); resolve(); };
    if (duration <= 0) { finish(); return; }
    const start = performance.now();
    function frame(now) {
      const raw = Math.min(1, (now - start) / duration);
      const e = easeInOutCubic(raw);
      if (tween) tween.update(e);
      setStepIndicator(fromX + (toX - fromX) * e);
      if (raw < 1) requestAnimationFrame(frame);
      else finish();
    }
    requestAnimationFrame(frame);
  });
}
