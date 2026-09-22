// 워크스페이스 리사이즈 (3열 2행 타일링): 세로 스플리터 2개 + 가로 스플리터 1개.
// 행 비율은 세 열이 공유하므로 가로 스플리터는 칼럼마다가 아니라 전체에 하나뿐이다.
//
// 열은 폭 셋이 아니라 **누적 경계 둘**(edge1, edge2)로 들고 있다 — 세 폭의 합이 100 이라는
// 불변식을 계산이 아니라 표현이 보장한다. 폭 셋을 따로 저장하면 드래그마다 합을 다시
// 맞춰야 하고, 한 번만 어긋나도 마지막 열이 조용히 잘린다.
import { tokenPx } from "./tokens.js";

// v3(칼럼-메이저의 col1/rowLeft/rowRight)과 값 모양이 다르다. 키를 올려 구버전을 아예
// 읽지 않는다 — 검증기가 걸러 주기를 기대하지 않는다.
const STORAGE_KEY = "bloch-layout-v4";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * 두 행의 기하를 px 로 잰다. { availablePx, maxTopPx } 또는 측정 불가면 null.
 *
 * **상단 행의 최대는 두 경로에서 지켜져야 한다** — 회로 내용이 자동으로 밀어 올리는 쪽
 * (main.js 의 minHeight 상한)과 사용자가 스플리터를 끄는 쪽. 하나만 막으면 나머지로 뚫려
 * 확률 차트가 부서진다. 그래서 공식을 여기 한 번만 쓰고 둘이 같이 읽는다.
 *
 * 확률 크롬(툴바·푸터·패딩)은 **측정한다.** 고정값으로 두면 좁은 화면에서 툴바가
 * 줄바꿈할 때 어긋난다. .prob-chart 가 flex:1 이라 패널이 커지면 차트만 커지므로
 * 차분이 일정하고 되먹임이 없다(.circuit-scroll 과 같은 구조).
 */
export function rowGeometry() {
  const grid = document.getElementById("ws-grid");
  const probPanel = document.querySelector(".panel-probability");
  const probChart = document.querySelector(".prob-chart");
  if (!grid || !probPanel || !probChart) return null;
  const availablePx = grid.clientHeight - tokenPx("--space-3"); // 행 간격 트랙을 뺀 나머지
  const probChrome = probPanel.getBoundingClientRect().height - probChart.clientHeight;
  if (availablePx <= 0 || probChrome <= 0) return null; // 레이아웃 전 — 부르는 쪽이 재시도한다
  return { availablePx, maxTopPx: availablePx - (probChrome + tokenPx("--prob-chart-min")) };
}

function loadStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed.edge1 !== "number" ||
      typeof parsed.edge2 !== "number" ||
      typeof parsed.row !== "number"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function initResizableLayout() {
  const workspace = document.getElementById("workspace");
  const palette = document.querySelector(".panel-palette");
  const circuit = document.querySelector(".panel-circuit");
  const sphere = document.querySelector(".panel-sphere");
  const probability = document.querySelector(".panel-probability");

  // 비율 기본값과 폭 한계는 style.css 가 정한다 — 정의처는 한 곳.
  // (행의 **최대**만은 토큰이 아니라 아래 maxRowFr() 이 잰다. 아래 주석 참고.)
  // tokenPx 는 "18fr" 에서 숫자 18 만 읽는다.
  const colMin = tokenPx("--col-min");
  const rowMin = tokenPx("--row-min");

  // 상단 행의 최대는 토큰이 아니라 **그때그때 잰다** — 창 크기가 바뀌면 값이 바뀌고,
  // 비율(옛 --row-max: 75fr)로는 낮은 화면에서 하단이 확률 최소 아래로 내려갔다.
  // 측정 불가면 제한 없음(100)으로 두어 드래그가 멈추지는 않게 한다.
  function maxRowFr() {
    const geo = rowGeometry();
    if (!geo) return 100;
    return Math.max(0, (geo.maxTopPx / geo.availablePx) * 100);
  }

  const sizes = {
    edge1: tokenPx("--col-1"),
    edge2: tokenPx("--col-1") + tokenPx("--col-2"),
    row: tokenPx("--row-top"),
  };
  const stored = loadStored();
  if (stored) {
    sizes.edge1 = clamp(stored.edge1, colMin, 100 - 2 * colMin);
    sizes.edge2 = clamp(stored.edge2, sizes.edge1 + colMin, 100 - colMin);
    // 저장값도 같은 클램프를 탄다 — 큰 화면에서 저장한 비율을 작은 화면에서 열면
    // 확률이 최소 아래로 눌린 채 복원된다.
    sizes.row = clamp(stored.row, rowMin, maxRowFr());
  }

  function apply() {
    // **값에 단위를 반드시 붙인다.** 숫자만 넣으면 트랙이 minmax(0, 18) 이 되어
    // grid-template-columns 선언 **전체가 무효**가 되고 패널 여섯이 한 줄로 쌓인다.
    // 콘솔에는 아무것도 뜨지 않아 화면만 보고는 원인을 찾기 어렵다.
    workspace.style.setProperty("--col-1", `${sizes.edge1}fr`);
    workspace.style.setProperty("--col-2", `${sizes.edge2 - sizes.edge1}fr`);
    workspace.style.setProperty("--col-3", `${100 - sizes.edge2}fr`);
    workspace.style.setProperty("--row-top", `${sizes.row}fr`);
    workspace.style.setProperty("--row-bottom", `${100 - sizes.row}fr`);
  }
  apply();

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sizes));
    } catch {
      // localStorage 사용 불가 - 무시
    }
  }

  // 포인터 위치를 **두 패널이 실제로 차지한 폭/높이** 안의 비율로 바꾼다(§9 와 같은 원칙 —
  // CSS 트랙 치수를 JS 에서 다시 계산하지 않는다). 코드 패널이 1열을 접어도 이 값은
  // 실측이라 그대로 맞고, 간격 폭을 알 필요도 없다.
  function ratioX(ev, first, second) {
    const a = first.getBoundingClientRect();
    const b = second.getBoundingClientRect();
    const pool = a.width + b.width;
    return pool > 0 ? (ev.clientX - a.left) / pool : 0;
  }

  function ratioY(ev, first, second) {
    const a = first.getBoundingClientRect();
    const b = second.getBoundingClientRect();
    const pool = a.height + b.height;
    return pool > 0 ? (ev.clientY - a.top) / pool : 0;
  }

  function bindSplitter(id, axis, onMove) {
    const splitter = document.getElementById(id);
    splitter.addEventListener("pointerdown", (e) => {
      splitter.setPointerCapture(e.pointerId);
      splitter.classList.add("is-active");
      document.body.style.userSelect = "none";
      document.body.style.cursor = axis === "col" ? "col-resize" : "row-resize";

      function handleMove(ev) {
        onMove(ev);
        apply();
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
  }

  // 1열↔2열: 3열은 건드리지 않으므로 두 열이 나눠 갖는 몫은 edge2 그대로다.
  bindSplitter("col-splitter-1", "col", (ev) => {
    const next = ratioX(ev, palette, circuit) * sizes.edge2;
    sizes.edge1 = clamp(next, colMin, sizes.edge2 - colMin);
  });

  // 2열↔3열: 1열은 건드리지 않으므로 남은 몫은 100 - edge1 이다.
  bindSplitter("col-splitter-2", "col", (ev) => {
    const next = sizes.edge1 + ratioX(ev, circuit, sphere) * (100 - sizes.edge1);
    sizes.edge2 = clamp(next, sizes.edge1 + colMin, 100 - colMin);
  });

  // 행 경계는 전 열 공용이다. 기준은 2열 — 1열은 코드 패널이 열리면 숨겨져 실측값이 0 이 된다.
  // 최대는 드래그 시점에 다시 잰다(창 크기가 바뀌었을 수 있다). 화면이 아주 낮아 최대가
  // 최소보다 작아지면 clamp 가 최대를 돌려주는데, 그게 맞다 — 확률이 읽히는 바닥이
  // 상단 행의 최소보다 우선한다.
  bindSplitter("row-splitter", "row", (ev) => {
    sizes.row = clamp(ratioY(ev, circuit, probability) * 100, rowMin, maxRowFr());
  });
}
