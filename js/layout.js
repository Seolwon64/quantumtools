// 워크스페이스 리사이즈 (칼럼-메이저): 세로 스플리터 1개(왼쪽↔오른쪽 칼럼) +
// 칼럼별 가로 스플리터 2개(왼쪽: 팔레트↔구, 오른쪽: 회로↔확률).
// 각 칼럼의 상/하 분할 비율은 서로 독립적으로 조절된다.
const STORAGE_KEY = "bloch-layout-v3";

const COL_MIN = 18;
const COL_MAX = 55;
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
    if (
      typeof parsed.col1 !== "number" ||
      typeof parsed.rowLeft !== "number" ||
      typeof parsed.rowRight !== "number"
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
  const leftCol = document.getElementById("ws-left");
  const rightCol = document.getElementById("ws-right");

  const stored = loadStored();
  const sizes = {
    col1: stored ? clamp(stored.col1, COL_MIN, COL_MAX) : 27,
    rowLeft: stored ? clamp(stored.rowLeft, ROW_MIN, ROW_MAX) : 50,
    rowRight: stored ? clamp(stored.rowRight, ROW_MIN, ROW_MAX) : 50,
  };

  function apply() {
    workspace.style.setProperty("--col1", `${sizes.col1}%`);
    workspace.style.setProperty("--row-left", `${sizes.rowLeft}%`);
    workspace.style.setProperty("--row-right", `${sizes.rowRight}%`);
  }
  apply();

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sizes));
    } catch {
      // localStorage 사용 불가 - 무시
    }
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

  bindSplitter("col-splitter", "col", (ev) => {
    const rect = workspace.getBoundingClientRect();
    sizes.col1 = clamp(((ev.clientX - rect.left) / rect.width) * 100, COL_MIN, COL_MAX);
  });

  bindSplitter("row-splitter-left", "row", (ev) => {
    const rect = leftCol.getBoundingClientRect();
    sizes.rowLeft = clamp(((ev.clientY - rect.top) / rect.height) * 100, ROW_MIN, ROW_MAX);
  });

  bindSplitter("row-splitter-right", "row", (ev) => {
    const rect = rightCol.getBoundingClientRect();
    sizes.rowRight = clamp(((ev.clientY - rect.top) / rect.height) * 100, ROW_MIN, ROW_MAX);
  });
}
