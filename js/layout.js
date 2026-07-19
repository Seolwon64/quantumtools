// 2x2 워크스페이스 그리드를 드래그로 리사이즈. 세로 스플리터가 칼럼 비율을,
// 가로 스플리터가 로우 비율을 조정하며, 두 핸들만으로 4개 패널 크기를 모두 제어한다.
const STORAGE_KEY = "bloch-layout-v1";

const COL_MIN = 22;
const COL_MAX = 60;
const ROW_MIN = 25;
const ROW_MAX = 75;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function loadStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed.col1 !== "number" || typeof parsed.row1 !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function save(col1, row1) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ col1, row1 }));
  } catch {
    // localStorage 사용 불가 - 무시
  }
}

export function initResizableLayout() {
  const workspace = document.getElementById("workspace");
  const colSplitter = document.getElementById("col-splitter");
  const rowSplitter = document.getElementById("row-splitter");

  const stored = loadStored();
  let col1 = stored ? clamp(stored.col1, COL_MIN, COL_MAX) : 36;
  let row1 = stored ? clamp(stored.row1, ROW_MIN, ROW_MAX) : 50;

  function apply() {
    workspace.style.setProperty("--col1", `${col1}%`);
    workspace.style.setProperty("--row1", `${row1}%`);
  }
  apply();

  function startDrag(splitter, axis, onMove) {
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
        save(col1, row1);
      }
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    });
  }

  startDrag(colSplitter, "col", (ev) => {
    const rect = workspace.getBoundingClientRect();
    const pct = ((ev.clientX - rect.left) / rect.width) * 100;
    col1 = clamp(pct, COL_MIN, COL_MAX);
  });

  startDrag(rowSplitter, "row", (ev) => {
    const rect = workspace.getBoundingClientRect();
    const pct = ((ev.clientY - rect.top) / rect.height) * 100;
    row1 = clamp(pct, ROW_MIN, ROW_MAX);
  });
}
