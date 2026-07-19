// 워크스페이스 리사이즈: 행별 독립 칼럼 스플리터 2개 + 행 스플리터 1개.
// 위 행(팔레트|회로)과 아래 행(구|확률)의 칼럼 비율이 서로 독립적으로 조절된다.
const STORAGE_KEY = "bloch-layout-v2";

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
    if (
      typeof parsed.colTop !== "number" ||
      typeof parsed.colBottom !== "number" ||
      typeof parsed.row1 !== "number"
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
  const topRow = document.getElementById("ws-top");

  const stored = loadStored();
  const sizes = {
    colTop: stored ? clamp(stored.colTop, COL_MIN, COL_MAX) : 36,
    colBottom: stored ? clamp(stored.colBottom, COL_MIN, COL_MAX) : 55,
    row1: stored ? clamp(stored.row1, ROW_MIN, ROW_MAX) : 50,
  };

  function apply() {
    workspace.style.setProperty("--col-top", `${sizes.colTop}%`);
    workspace.style.setProperty("--col-bottom", `${sizes.colBottom}%`);
    workspace.style.setProperty("--row1", `${sizes.row1}%`);
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

  bindSplitter("col-splitter-top", "col", (ev) => {
    const rect = workspace.getBoundingClientRect();
    sizes.colTop = clamp(((ev.clientX - rect.left) / rect.width) * 100, COL_MIN, COL_MAX);
  });

  bindSplitter("col-splitter-bottom", "col", (ev) => {
    const rect = workspace.getBoundingClientRect();
    sizes.colBottom = clamp(((ev.clientX - rect.left) / rect.width) * 100, COL_MIN, COL_MAX);
  });

  bindSplitter("row-splitter", "row", (ev) => {
    const rect = workspace.getBoundingClientRect();
    sizes.row1 = clamp(((ev.clientY - rect.top) / rect.height) * 100, ROW_MIN, ROW_MAX);
  });
}
