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

  // 기본값도 한계도 style.css 가 정한다(§9 의 --circuit-chrome 과 같은 이유 — 정의처는 한 곳).
  // tokenPx 는 "18fr" 에서 숫자 18 만 읽는다.
  const colMin = tokenPx("--col-min");
  const rowMin = tokenPx("--row-min");
  const rowMax = tokenPx("--row-max");

  const sizes = {
    edge1: tokenPx("--col-1"),
    edge2: tokenPx("--col-1") + tokenPx("--col-2"),
    row: tokenPx("--row-top"),
  };
  const stored = loadStored();
  if (stored) {
    sizes.edge1 = clamp(stored.edge1, colMin, 100 - 2 * colMin);
    sizes.edge2 = clamp(stored.edge2, sizes.edge1 + colMin, 100 - colMin);
    sizes.row = clamp(stored.row, rowMin, rowMax);
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
  bindSplitter("row-splitter", "row", (ev) => {
    sizes.row = clamp(ratioY(ev, circuit, probability) * 100, rowMin, rowMax);
  });
}
