// QASM / Qiskit 코드 패널.
//
// 동기화는 **단방향 + 명시적 적용**이다. 회로가 바뀌면 코드는 자동으로 갱신되지만,
// 코드→회로는 Apply(또는 Ctrl/Cmd+Enter)로만 간다. 타이핑 중에는 코드가 거의 항상
// 문법 오류 상태라 자동 반영하면 회로가 깨지고 Undo 스택도 타이핑 단위로 오염된다.
//
// 패널은 오버레이가 아니라 **레이아웃에 참여**한다 — 왼쪽 열 자리를 차지하고, 넓히면
// 오른쪽 열이 좁아질 뿐 Circuit·Probabilities 는 가려지지 않는다. 코드를 고치면서
// 회로·상태벡터·확률을 동시에 보는 게 이 기능의 목적이기 때문이다.

import { toQASM, toQiskit } from "./export.js";
import { parseQASM, normalizeCircuit } from "./qasm.js";

const STORAGE_KEY = "bloch-code-panel-v1";
const MIN_PCT = 27; // 왼쪽 열 기본 폭
const MAX_PCT = 50; // 이 이상 넓히면 Circuit 이 쓸모없이 좁아진다

function loadWidth() {
  try {
    const v = Number(localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(v) && v >= MIN_PCT && v <= MAX_PCT) return v;
  } catch { /* localStorage 사용 불가 — 기본값 */ }
  return MIN_PCT;
}

function saveWidth(pct) {
  try { localStorage.setItem(STORAGE_KEY, String(pct)); } catch { /* 무시 */ }
}

export function initCodePanel({ circuit, scene, els, onOpen, showToast }) {
  const {
    panel, resizer, wsLeft, workspace,
    tabQasm, tabQiskit, apply, copy, close,
    text, gutter, errorLine, pre, readonlyBox, editor,
    banner, conflict, reload, keep, badge, status,
  } = els;

  let open = false;
  let tab = "qasm";
  let modified = false;
  let conflicted = false;
  let widthPct = loadWidth();
  let lastCode = "";

  // ---------- 폭 ----------
  function applyWidth() {
    panel.style.width = `${widthPct}%`;
  }

  resizer.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    resizer.setPointerCapture(e.pointerId);
    document.body.classList.add("is-col-resizing");
    const rect = workspace.getBoundingClientRect();
    const move = (ev) => {
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      widthPct = Math.min(MAX_PCT, Math.max(MIN_PCT, pct));
      applyWidth();
    };
    const up = () => {
      resizer.removeEventListener("pointermove", move);
      resizer.removeEventListener("pointerup", up);
      document.body.classList.remove("is-col-resizing");
      saveWidth(widthPct);
    };
    resizer.addEventListener("pointermove", move);
    resizer.addEventListener("pointerup", up);
  });

  // ---------- 코드 생성 ----------
  function generate() {
    const snap = circuit.getSnapshot();
    const fn = tab === "qasm" ? toQASM : toQiskit;
    return fn(snap.qubitCount, snap.grid, snap.clbitCount);
  }

  function renderGutter() {
    const n = text.value.split("\n").length;
    gutter.textContent = Array.from({ length: n }, (_, i) => i + 1).join("\n");
    gutter.scrollTop = text.scrollTop;
  }

  function setBanner(warnings) {
    if (!warnings.length) { banner.classList.add("hidden"); banner.textContent = ""; return; }
    banner.classList.remove("hidden");
    banner.textContent = warnings.join(" ");
  }

  /** 회로 → 코드. modified 상태에서는 부르지 않는다(사용자 편집을 덮어쓰지 않는다). */
  function refresh() {
    const { code, warnings } = generate();
    lastCode = code;
    if (tab === "qasm") {
      text.value = code;
      renderGutter();
      clearError();
    } else {
      pre.textContent = code;
    }
    setBanner(warnings);
  }

  function setModified(value) {
    modified = value;
    badge.classList.toggle("hidden", !value);
    updateApplyState();
  }

  /**
   * 편집이 없으면 Apply 는 아무 일도 하지 않아야 한다 — 눌러도 Undo 스택이 쌓이면 안 된다.
   * 네이티브 `disabled` 대신 aria-disabled 를 쓰는 이유: disabled 요소는 브라우저가
   * 마우스 이벤트를 막아 "왜 못 누르는지" 툴팁이 아예 뜨지 않는다(이 프로젝트의 기존 규약).
   */
  function updateApplyState() {
    const off = tab !== "qasm" || !modified;
    apply.classList.toggle("is-disabled", off);
    apply.setAttribute("aria-disabled", String(off));
    apply.title = off
      ? "Nothing to apply — edit the code first"
      : "Apply to circuit (Ctrl+Enter)";
  }

  // ---------- 에러 표시 ----------
  function clearError() {
    errorLine.classList.add("hidden");
    status.textContent = "";
    status.classList.remove("is-error");
  }

  function showError(line, message) {
    status.textContent = message;
    status.classList.add("is-error");
    // 줄 하이라이트: textarea 뒤 같은 메트릭의 띠를 그 줄 위치로 옮긴다.
    const cs = getComputedStyle(text);
    const lh = parseFloat(cs.lineHeight) || 18;
    errorLine.style.height = `${lh}px`;
    errorLine.style.transform = `translateY(${(line - 1) * lh - text.scrollTop}px)`;
    errorLine.classList.remove("hidden");
    // 해당 줄을 선택해 보이게 한다(스크롤도 따라간다).
    const lines = text.value.split("\n");
    const start = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
    text.focus();
    text.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0));
  }

  // ---------- Apply ----------
  function doApply() {
    if (tab !== "qasm") return;
    if (!modified) return; // 편집이 없으면 회로를 건드리지 않는다(Undo 스택도 그대로)

    const parsed = parseQASM(text.value);
    if (!parsed.ok) {
      // 파싱 실패 시 회로는 **전혀** 바뀌지 않는다 — parseQASM 이 부분 결과를 주지 않는다.
      showError(parsed.line, parsed.message);
      return;
    }
    clearError();

    // 정규화로 모양이 달라지는지 미리 본다(안내를 띄울지 결정하기 위해).
    const { changed } = normalizeCircuit(parsed.qubitCount, parsed.grid);
    circuit.loadCircuit(parsed.qubitCount, parsed.grid, parsed.clbitCount);
    setModified(false);
    conflicted = false;
    conflict.classList.add("hidden");
    refresh();

    const notes = [];
    if (changed.emptyColumns) notes.push("empty columns removed");
    if (changed.controlDots) notes.push("control dots folded into gate controls");
    // 실제로 바뀐 게 없으면 안내도 없다 — 매번 뜨면 읽히지 않는다.
    status.textContent = notes.length
      ? `Circuit was normalized: ${notes.join(", ")}.`
      : "Applied.";
  }

  // ---------- 탭 ----------
  function setTab(next) {
    tab = next;
    tabQasm.classList.toggle("is-active", next === "qasm");
    tabQiskit.classList.toggle("is-active", next === "qiskit");
    tabQasm.setAttribute("aria-selected", String(next === "qasm"));
    tabQiskit.setAttribute("aria-selected", String(next === "qiskit"));
    editor.classList.toggle("hidden", next !== "qasm");
    readonlyBox.classList.toggle("hidden", next === "qasm");
    // Qiskit 탭에는 편집 가능해 보이는 UI를 두지 않는다 — Apply 를 아예 감춘다.
    apply.classList.toggle("hidden", next !== "qasm");
    updateApplyState();
    if (next === "qiskit" || !modified) refresh();
  }

  tabQasm.addEventListener("click", () => setTab("qasm"));
  tabQiskit.addEventListener("click", () => setTab("qiskit"));

  // ---------- 열기 / 닫기 ----------
  function openPanel() {
    if (open) return;
    open = true;
    onOpen?.(); // 메뉴 드로어가 열려 있으면 닫는다
    panel.hidden = false;
    resizer.hidden = false;
    applyWidth();
    wsLeft.classList.add("is-hidden-by-code");
    scene.setPaused(true); // 숨어 있는 동안 GPU를 놀린다(캔버스는 DOM에 그대로 있다)
    setModified(false);
    conflicted = false;
    conflict.classList.add("hidden");
    setTab("qasm");
    refresh();
    text.focus();
  }

  function closePanel({ force = false } = {}) {
    if (!open) return;
    if (modified && !force) {
      const ok = window.confirm("You have unapplied code edits. Close anyway?");
      if (!ok) return;
    }
    open = false;
    panel.hidden = true;
    resizer.hidden = true;
    wsLeft.classList.remove("is-hidden-by-code");
    scene.setPaused(false); // resize() 를 먼저 부른 뒤 루프를 재개한다(scene.js)
    setModified(false);
  }

  close.addEventListener("click", () => closePanel());
  apply.addEventListener("click", (e) => {
    // aria-disabled 는 클릭을 막지 않으므로 여기서 막는다.
    if (apply.getAttribute("aria-disabled") === "true") { e.preventDefault(); return; }
    doApply();
  });
  copy.addEventListener("click", async () => {
    // 경고 주석은 code 문자열 안에 있다 — 붙여넣은 사람도 차이를 알 수 있어야 한다.
    const value = tab === "qasm" ? text.value : pre.textContent;
    try {
      await navigator.clipboard.writeText(value);
      showToast?.(tab === "qasm" ? "OpenQASM 2.0 copied" : "Qiskit code copied");
    } catch {
      showToast?.("Copy failed");
    }
  });

  // ---------- 편집 ----------
  text.addEventListener("input", () => {
    setModified(true);
    renderGutter();
    clearError();
  });
  text.addEventListener("scroll", () => {
    gutter.scrollTop = text.scrollTop;
    if (!errorLine.classList.contains("hidden")) errorLine.style.top = `${-text.scrollTop}px`;
  });

  text.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); doApply(); return; }
    // Tab 은 들여쓰기. 단 Shift+Tab 은 포커스 이동으로 남긴다 —
    // 아니면 키보드 사용자가 에디터에서 빠져나갈 방법이 없다.
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      const { selectionStart: s, selectionEnd: t } = text;
      text.setRangeText("  ", s, t, "end");
      setModified(true);
      renderGutter();
    }
  });

  // ---------- 회로 변경 알림 ----------
  function onCircuitChanged() {
    if (!open) return;
    if (modified) {
      // 사용자의 편집을 덮어쓰지 않는다. 어느 쪽을 살릴지는 사용자가 고른다.
      conflicted = true;
      conflict.classList.remove("hidden");
      return;
    }
    refresh();
  }

  reload.addEventListener("click", () => {
    conflicted = false;
    conflict.classList.add("hidden");
    setModified(false);
    refresh();
  });
  keep.addEventListener("click", () => {
    conflicted = false;
    conflict.classList.add("hidden");
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && open) {
      // 에디터 안에서 눌러도 닫힌다(모달이 아니므로 다른 Esc 핸들러와 충돌하지 않는다).
      e.preventDefault();
      closePanel();
    }
  });

  applyWidth();
  return { open: openPanel, close: closePanel, isOpen: () => open, onCircuitChanged };
}
