// 워크스페이스 리사이즈 (3열 2행 타일링): 열 스플리터 2개 + 행 스플리터 1개와, 상단 행 높이의 우선순위 배분.
// 행 비율은 세 열이 공유하므로 가로 스플리터는 칼럼마다가 아니라 전체에 하나뿐이다.
//
// 열: 1·3열의 비율(--c1·--c3)만 들고 있고 2열은 CSS 가 나머지(1fr)로 준다. 세 폭의 합이
// 그리드와 같다는 불변식을 계산이 아니라 표현이 보장한다 — 폭 셋을 따로 저장하면 드래그마다
// 합을 다시 맞춰야 하고, 한 번만 어긋나도 마지막 열이 조용히 잘린다.
//
// 행: 상단 높이를 **px 로 직접** 정한다(rowPlan). 비율로 나누면 회로 필요량과 무관하게 공간을
// 주고, 회로 패널의 min-height 로 되미는 방식(1부)은 사용자의 스플리터를 되밀어 죽였다.
//
// 이 모듈은 **최상위에서 DOM 을 건드리지 않는다.** 모든 DOM·ResizeObserver 접근은 함수 안에
// 있어 Node 가 임포트할 수 있고(test/layout.test.mjs 가 그 자체로 검사다), main.js 의 DOM const
// 를 참조하지 않으므로 initResizableLayout 이 그 const 들보다 먼저 돌아도 TDZ 가 없다.
import { tokenPx } from "./tokens.js";

// v4(열 누적 경계 edge1/edge2 + 행 비율 row)와 값 모양도 의미도 다르다 — 행이 비율이 아니라
// 체인 기본값으로부터의 px 오프셋이 됐다. 키를 올려 구버전을 아예 읽지 않는다(열 저장값도
// 한 번 초기화된다). 검증기가 걸러 주기를 기대하지 않는다.
const STORAGE_KEY = "bloch-layout-v5";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * 상단 행의 기본 높이와 드래그 범위를 정한다 — 순수 함수(px 입력, px 출력).
 *
 * **모자랄 때는 낮은 순위부터 양보하고, 남을 때는 높은 순위부터 "쓸모 있는 최대"까지 받는다.**
 *   회로    = min(회로 필요 높이, A − 확률 최소)      회로는 콘텐츠 높이가 곧 쓸모 있는 최대
 *   Q-sphere = min(구가 정사각인 높이, A − 확률 최대)  확률이 쓸모 있는 최대를 받은 **뒤에만**
 *   기본값  = max(회로, Q-sphere), 하단 = 나머지(확률 → 상태벡터 → 밀도행렬)
 * 좁은 화면에서는 두 번째 항이 첫 항보다 작아져 1부(회로 항만 있던 식)와 같은 값이 나온다 —
 * 회귀 없음의 근거가 식 안에 있다.
 *
 * 드래그 범위는 [회로 최소, A − 확률 최소]. 하한을 "회로 필요 높이"로 두면 기본값이 곧 하한인
 * 화면(1536×740 이하)에서 스플리터가 거의 안 움직였다. 회로는 스크롤로 물러날 수 있고 확률
 * 차트는 최소 아래에서 부서지므로, **부서지는 쪽을 보호하고 물러날 수 있는 쪽이 양보한다.**
 *
 * @param {object} m 모두 px. available = 두 행 높이(간격 제외), circuitNeeded = 회로 그리드 +
 *   크롬, circuitMin = 크롬 + --circuit-min-content, probMin/probMax = 확률 크롬 +
 *   --prob-chart-min/-max, sphereSquare = 구 캔버스가 정사각이 되는 패널 높이
 * @returns {{ chain: number, min: number, max: number }}
 */
export function rowPlan({ available, circuitNeeded, circuitMin, probMin, probMax, sphereSquare }) {
  const max = available - probMin;
  const circuit = Math.min(circuitNeeded, max);
  const sphere = Math.min(sphereSquare, available - probMax);
  return { chain: Math.max(circuit, sphere), min: circuitMin, max };
}

/**
 * 실제 상단 높이 = clamp(기본값 + 오프셋, 회로 최소, A − 확률 최소).
 * 범위가 뒤집히면(아주 낮은 화면) 상한이 이긴다 — 확률이 읽히는 바닥이 회로 최소보다 우선한다.
 * 음수는 0 으로 막는다: 트랙에 음수 px 가 들어가면 grid-template-rows 선언 전체가 무효가 된다.
 */
export function rowTopPx(plan, offset = 0) {
  return Math.max(0, clamp(plan.chain + offset, plan.min, plan.max));
}

/**
 * 사용자가 원하는 상단 높이를 저장할 오프셋으로 바꾼다. **잘린 뒤의 값**으로 저장한다 —
 * 원하는 값 그대로 두면 범위 밖으로 끈 만큼이 보이지 않는 빚으로 남아, 되돌려 끌 때 핸들이
 * 한참 안 움직인다.
 */
export function rowOffsetFor(plan, desiredTop) {
  return rowTopPx(plan, desiredTop - plan.chain) - plan.chain;
}

/**
 * 체인 입력을 DOM 에서 잰다. 측정 불가(레이아웃 전)면 null.
 *
 * 크롬(툴바·재생·푸터·패딩)은 **실측한다.** 좁은 화면에서 툴바가 줄바꿈하고 회로에 가로
 * 스크롤바가 생기면 크롬이 달라지는데, 상수로 두면(옛 --circuit-chrome 132px) 그만큼 어긋났다.
 * `패널 높이 − 스크롤/차트 영역 높이` 로 재면 스크롤 영역이 flex:1 이라 패널이 커져도 차분이
 * 일정해 행 배분이 측정값을 바꾸는 고리가 없다. clientHeight 는 가로 스크롤바를 빼므로
 * 스크롤바가 자동으로 크롬에 들어온다.
 * 구 패널은 여백 없이 캔버스가 패널을 채우고 툴바·하단 줄이 위에 떠 있어, 크롬은 테두리와
 * (하단 줄이 접혔을 때) 캔버스 아래 예약분뿐이다.
 */
function measureRows(els) {
  const available = els.grid.clientHeight - tokenPx("--space-3"); // 행 간격 트랙을 뺀 나머지
  const circuitChrome = els.circuitPanel.getBoundingClientRect().height - els.circuitScroll.clientHeight;
  const probChrome = els.probPanel.getBoundingClientRect().height - els.probChart.clientHeight;
  const sphereBox = els.sphereBox.getBoundingClientRect();
  const sphereChrome = els.spherePanel.getBoundingClientRect().height - sphereBox.height;
  if (available <= 0 || circuitChrome <= 0 || probChrome <= 0) return null;
  return {
    available,
    circuitNeeded: els.circuitGrid.scrollHeight + circuitChrome,
    circuitMin: circuitChrome + tokenPx("--circuit-min-content"),
    probMin: probChrome + tokenPx("--prob-chart-min"),
    probMax: probChrome + tokenPx("--prob-chart-max"),
    sphereSquare: sphereBox.width + sphereChrome,
  };
}

function loadStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // 범위는 따로 검사하지 않는다 — 비율은 CSS 트랙이 px 최소·최대로, 오프셋은 rowTopPx 가
    // 자르므로 어떤 유한한 값도 레이아웃을 깨지 못한다.
    if (![parsed.c1, parsed.c3, parsed.rowOffset].every(Number.isFinite)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 스플리터를 배선하고 저장값을 복원한다. 반환하는 relayout() 은 회로가 바뀔 때마다
 * main.js 의 render 가 부른다 — 회로 필요 높이는 render 를 거쳐서만 바뀐다.
 */
export function initResizableLayout() {
  const workspace = document.getElementById("workspace");
  const els = {
    grid: document.getElementById("ws-grid"),
    palette: document.querySelector(".panel-palette"),
    circuitPanel: document.querySelector(".panel-circuit"),
    circuitScroll: document.querySelector(".circuit-scroll"),
    circuitGrid: document.getElementById("circuit-grid"),
    spherePanel: document.querySelector(".panel-sphere"),
    sphereBox: document.getElementById("sphere-container"),
    probPanel: document.querySelector(".panel-probability"),
    probChart: document.querySelector(".prob-chart"),
  };

  // 기본 비율은 style.css 가 정한다 — 정의처는 한 곳. 오프셋 0 = 체인 기본값 그대로.
  const sizes = { c1: tokenPx("--c1"), c3: tokenPx("--c3"), rowOffset: 0 };
  const stored = loadStored();
  if (stored) Object.assign(sizes, { c1: stored.c1, c3: stored.c3, rowOffset: stored.rowOffset });

  function applyColumns() {
    // **단위 없이 쓴다.** 트랙 식이 calc() 안에서 길이에 곱하므로 "18fr" 이면 식이 무효가
    // 되고 grid-template-columns 선언 전체가 버려져 패널 여섯이 한 줄로 쌓인다.
    workspace.style.setProperty("--c1", String(sizes.c1));
    workspace.style.setProperty("--c3", String(sizes.c3));
  }
  applyColumns();

  function relayout({ retry = true } = {}) {
    const m = measureRows(els);
    if (!m) {
      // 첫 호출은 레이아웃 전일 수 있다. 여기서 포기하면 다음 트리거 전까지 기본값(반반)에
      // 머무르므로 다음 프레임에 딱 한 번 다시 잰다(재시도가 또 재시도를 예약하지 않게).
      if (retry) requestAnimationFrame(() => relayout({ retry: false }));
      return;
    }
    // **px 로 쓴다.** 트랙이 minmax(0, var(--row-top)) 라 px·fr 모두 유효하지만 단위 없는 수는
    // 무효다. 하단은 CSS 의 1fr 이 나머지를 받는다.
    workspace.style.setProperty("--row-top", `${rowTopPx(rowPlan(m), sizes.rowOffset)}px`);
  }

  // 크롬은 render 를 거치지 않는 경로로도 바뀐다 — Hide 0%, 샘플링 Run/Reset, Show all,
  // 코드 패널 열기/닫기, 열 드래그, 창 크기. 그래서 경로를 쫓지 않고 **크롬을 이루는 요소
  // 자체**를 관찰한다. 이 요소들의 크기는 내용과 열 폭으로만 정해지고 행 배분에 의존하지 않아
  // (#ws-grid 는 뷰포트·코드 패널로만 바뀐다) 관찰 → 재배분 → 관찰의 고리가 없다.
  // 열 드래그는 2열 폭을 바꾸고 그게 두 툴바 폭을 바꿔 여기 걸리므로 따로 부르지 않는다.
  // 쓰기는 한 프레임 미룬다 — 같은 프레임에 행을 바꾸면 형제 패널이 다시 바뀌어
  // ResizeObserver loop 경고가 날 수 있다. 여러 항목이 한 번에 와도 재배분은 한 번이다.
  let scheduled = false;
  const observer = new ResizeObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      relayout();
    });
  });
  for (const selector of ["#ws-grid", ".circuit-toolbar", ".playback-controls", ".prob-toolbar", ".prob-footer"]) {
    const el = document.querySelector(selector);
    if (el) observer.observe(el);
  }
  // 첫 렌더는 웹폰트 전에 돌 수 있다(대체 글꼴로 잰 크롬). 폰트가 오면 툴바 크기가 바뀌어
  // 대개 위 관찰이 잡지만, 높이가 우연히 같아도 다시 재도록 명시적으로 한 번 더 부른다.
  document.fonts?.ready.then(() => relayout());

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sizes));
    } catch {
      // localStorage 사용 불가 - 무시
    }
  }

  // 드래그는 **누른 순간의 실측 폭/높이 + 포인터 이동량**으로 계산한다. 저장 비율에서 출발하면
  // CSS 가 최대에서 잘라 둔 열을 끌 때 비율이 보이지 않게 먼저 줄어야 해 핸들이 한참 안 움직이고,
  // 포인터 위치를 폭으로 바로 바꾸면 스플리터 중심과 열 끝의 반 간격만큼 잡는 순간 튄다.
  function bindSplitter(id, axis, onStart, onMove) {
    const splitter = document.getElementById(id);
    splitter.addEventListener("pointerdown", (e) => {
      // 누름의 기본 동작(텍스트 선택·네이티브 드래그 준비)을 막는다. 안 막으면 첫 이동으로 열이
      // 넓어진 뒤 **누른 자리에 온 팔레트 칩**(draggable)을 Chrome 이 드래그로 집어 들어
      // pointercancel 로 스플리터 드래그가 끊겼다(1열을 오른쪽으로 끌 때 실측, 칩 dragstart).
      e.preventDefault();
      splitter.setPointerCapture(e.pointerId);
      splitter.classList.add("is-active");
      document.body.style.userSelect = "none";
      document.body.style.cursor = axis === "col" ? "col-resize" : "row-resize";
      const start = onStart();

      function handleMove(ev) {
        onMove(start, axis === "col" ? ev.clientX - e.clientX : ev.clientY - e.clientY);
      }
      function handleUp() {
        splitter.classList.remove("is-active");
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        save();
      }
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    });
    return splitter;
  }

  // 세 열 트랙 몫 = 세 패널의 실제 폭 합. CSS 식의 (100% − 간격 둘)과 같은 양이고, 코드 패널이
  // 1열을 접으면 팔레트가 0 이 되어 그대로 맞는다 — 간격 폭을 JS 에서 다시 계산하지 않는다.
  function columnStart() {
    const pool = [els.palette, els.circuitPanel, els.spherePanel]
      .reduce((sum, el) => sum + el.getBoundingClientRect().width, 0);
    return {
      pool,
      col1: els.palette.getBoundingClientRect().width,
      col3: els.spherePanel.getBoundingClientRect().width,
      col2Min: tokenPx("--col-2-min"),
    };
  }

  // 1열↔2열: 3열은 그대로이므로 1열의 상한은 자기 최대와 "2열 최소를 남기는 폭" 중 작은 쪽.
  // 클램프는 CSS 트랙과 **같은 토큰**을 읽는다 — 드래그로 CSS 가 자를 비율을 저장하지 않는다.
  bindSplitter("col-splitter-1", "col", columnStart, (s, dx) => {
    const px = clamp(s.col1 + dx, tokenPx("--col-1-min"),
      Math.min(tokenPx("--col-1-max"), s.pool - s.col2Min - s.col3));
    sizes.c1 = (px / s.pool) * 100;
    applyColumns();
  });

  // 2열↔3열: 오른쪽으로 끌면 3열이 **줄어든다**(3열의 왼쪽 끝을 움직인다).
  bindSplitter("col-splitter-2", "col", columnStart, (s, dx) => {
    const px = clamp(s.col3 - dx, tokenPx("--col-3-min"),
      Math.min(tokenPx("--col-3-max"), s.pool - s.col2Min - s.col1));
    sizes.c3 = (px / s.pool) * 100;
    applyColumns();
  });

  // 행 경계는 전 열 공용이다. 기준은 2열(회로) — 1열은 코드 패널이 열리면 숨겨져 실측값이 0 이 된다.
  // 체인과 범위는 누른 순간에 다시 잰다(창 크기·회로가 바뀌었을 수 있다). 측정 불가면 끌지 않는다.
  const rowSplitter = bindSplitter("row-splitter", "row",
    () => {
      const m = measureRows(els);
      return m && { plan: rowPlan(m), top: els.circuitPanel.getBoundingClientRect().height };
    },
    (s, dy) => {
      if (!s) return;
      sizes.rowOffset = rowOffsetFor(s.plan, s.top + dy);
      workspace.style.setProperty("--row-top", `${rowTopPx(s.plan, sizes.rowOffset)}px`);
    });

  // 더블클릭 = 체인 기본값으로 복귀. 보이지 않는 제스처라 index.html 의 title 이 알려 준다.
  rowSplitter.addEventListener("dblclick", () => {
    sizes.rowOffset = 0;
    relayout();
    save();
  });

  relayout();
  return { relayout };
}
