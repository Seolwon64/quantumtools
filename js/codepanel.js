// QASM / Qiskit 코드 밴드 — 3×2 그리드 아래 전폭. 탭·에디터·Apply 와 펼침 상태·저장을 맡는다.
//
// 동기화는 **단방향 + 명시적 적용**이다. 회로가 바뀌면 코드는 자동으로 갱신되지만,
// 코드→회로는 Apply(또는 Ctrl/Cmd+Enter)로만 간다. 타이핑 중에는 코드가 거의 항상
// 문법 오류 상태라 자동 반영하면 회로가 깨지고 Undo 스택도 타이핑 단위로 오염된다.
//
// 밴드는 오버레이가 아니라 **레이아웃에 참여**한다 — 그리드 아래에 붙어, 펼치면 그리드 높이가
// 줄 뿐 어느 패널도 가려지지 않는다. 코드를 고치면서 회로·상태벡터·확률을 동시에 보는 게 이
// 기능의 목적이다. 높이·상한·기본 펼침 판정은 layout.js 가 행 배분과 같은 자리에서 한다.
// 머리글 줄은 접혀도 늘 보인다(코드로 들어가는 입구). 대화상자가 아니므로 포커스 트랩이 없다.

import { toQASM, toQiskit } from "./export.js";
import { parseQASM, normalizeCircuit } from "./qasm.js";
import { bandStartsOpen } from "./layout.js";
import { icon } from "./icons.js";

// v1 은 드로어 폭(%) 하나였다. 이제 값의 뜻이 밴드 펼침·높이(px)·탭으로 바뀌어 키를 올리고
// 구버전은 읽지 않는다.
const STORAGE_KEY = "bloch-code-panel-v2";

/** 저장값을 필드마다 따로 검증한다 — 하나가 깨져도 나머지는 살린다. 없는 필드는 없는 채로 둔다. */
function loadStored() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object") return {};
    const out = {};
    if (typeof parsed.expanded === "boolean") out.expanded = parsed.expanded;
    if (Number.isFinite(parsed.height)) out.height = parsed.height;
    if (parsed.tab === "qasm" || parsed.tab === "qiskit") out.tab = parsed.tab;
    return out;
  } catch {
    return {};
  }
}

export function initCodePanel({ circuit, layout, els, onOpen, showToast }) {
  const {
    panel, toggle, body,
    tabQasm, tabQiskit, apply, copy,
    text, gutter, mirror, errorLine, pre, readonlyBox, editor,
    banner, conflict, reload, keep, badge, status,
  } = els;

  let expanded = false;
  let tab = "qasm";
  let modified = false;
  // 사용자가 밴드를 한 번이라도 만졌다 — 로드 시 기본 펼침 판정을 건너뛴다.
  let userTouched = false;
  let errorLineNo = 0;

  // 사용자가 정한 것만 저장한다. 로드 시 자동 판정은 여기에 들어오지 않는다 — 들어오면
  // 다음 로드부터 그 화면의 판정이 아니라 첫 화면의 판정이 굳는다.
  const stored = loadStored();
  const persisted = { ...stored };
  function persist(fields) {
    Object.assign(persisted, fields);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted)); } catch { /* 저장 불가 — 무시 */ }
  }

  // ---------- 코드 생성 ----------
  function generate() {
    const snap = circuit.getSnapshot();
    const fn = tab === "qasm" ? toQASM : toQiskit;
    return fn(snap.qubitCount, snap.grid, snap.clbitCount);
  }

  /**
   * 거터 번호가 **화면 줄**을 따라가게 한다. 긴 줄은 줄바꿈되어 한 논리 줄이 여러 화면 줄을
   * 차지하므로, 숨은 미러에 논리 줄마다 블록을 만들어 높이를 재고 번호마다 그 높이를 준다.
   * 미러 폭은 textarea.clientWidth 실측이다 — scrollbar-gutter 는 스크롤 컨테이너에만 걸려
   * CSS 로 맞추면 미러가 스크롤바 폭만큼 넓어져 줄바꿈 지점이 달라진다.
   * 보이지 않을 때는 잴 수 없으므로 건너뛰고, 보일 때(펼침·탭 전환·크기 변화) 다시 부른다.
   */
  function renderGutter() {
    if (body.hidden || editor.classList.contains("hidden")) return;
    mirror.style.width = `${text.clientWidth}px`;
    const lines = document.createDocumentFragment();
    for (const line of text.value.split("\n")) {
      const block = document.createElement("div");
      block.textContent = line; // textContent — 코드가 HTML 로 해석되지 않는다
      lines.appendChild(block);
    }
    mirror.replaceChildren(lines);
    // 높이는 소수(rect)로 잰다. 줄높이가 17.6px 이라 offsetHeight(정수 18)를 쓰면 줄마다 0.4px 씩
    // 밀려 21줄째에서 번호가 6px 어긋났다(텔레포테이션 실측).
    const numbers = document.createDocumentFragment();
    [...mirror.children].forEach((block, i) => {
      const n = document.createElement("div");
      n.textContent = String(i + 1);
      n.style.height = `${block.getBoundingClientRect().height}px`;
      numbers.appendChild(n);
    });
    gutter.replaceChildren(numbers);
    gutter.scrollTop = text.scrollTop;
    if (!errorLine.classList.contains("hidden")) placeErrorLine();
  }

  function setBanner(warnings) {
    if (!warnings.length) { banner.classList.add("hidden"); banner.textContent = ""; return; }
    banner.classList.remove("hidden");
    banner.textContent = warnings.join(" ");
  }

  /**
   * 회로 → 코드. modified 상태에서는 부르지 않는다(사용자 편집을 덮어쓰지 않는다).
   * **접혀 있어도 부른다.** Copy 는 접힌 머리글에서도 누를 수 있어서, 펼칠 때까지 미뤄 두면
   * 숨은 textarea 의 낡은 코드가 복사됐다(접힌 채 Reload 뒤 실측). 거터만은 보일 때 잰다.
   */
  function refresh() {
    const { code, warnings } = generate();
    if (tab === "qasm") {
      text.value = code;
      clearError();
      renderGutter();
    } else {
      pre.textContent = code;
    }
    setBanner(warnings);
  }

  function setModified(value) {
    modified = value;
    badge.classList.toggle("hidden", !value);
    // 편집이 시작되면 경고 배너를 감춘다. 배너는 **우리가 생성한 코드**에 대한 설명인데,
    // 사용자가 손댄 순간 더 이상 그 코드가 아니다.
    // (이걸 안 하면: 텔레포테이션에서 코드를 고친 뒤 다른 프리셋으로 바꿔도 — modified 라
    //  refresh 가 건너뛰어지므로 — 조건 경고가 남아 "superdense 인데 if 경고가 뜬다"로 보인다.)
    if (value) setBanner([]);
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

  // ---------- 펼침 / 접힘 ----------
  // DOM 만 바꾸는 함수와 사용자 경로를 나눈다. 로드 시 기본 펼침 판정은 밴드를 한 번 펼쳐
  // 높이를 재는데, 그게 사용자 경로를 타면 저장·포커스가 따라와 판정이 굳는다.
  function showBody(shown) {
    expanded = shown;
    body.hidden = !shown;
    panel.classList.toggle("is-collapsed", !shown);
    toggle.setAttribute("aria-expanded", String(shown));
    const label = shown ? "Hide code" : "Show code";
    toggle.setAttribute("aria-label", label);
    toggle.title = label;
    // 밴드는 화면 아래에 붙어 있다 — 펼침은 위로(chevron-up), 접힘은 아래로(chevron-down).
    toggle.innerHTML = icon(shown ? "chevron-down" : "chevron-up");
  }

  function focusCode() {
    (tab === "qasm" ? text : pre).focus();
  }

  function expand({ focus = false } = {}) {
    userTouched = true;
    if (!expanded) {
      showBody(true);
      persist({ expanded: true });
      // 밴드 높이가 바뀌었으니 같은 호출 안에서 그리드·행을 다시 맞추고(강제 레이아웃),
      // 그 뒤에야 미러가 실제 폭을 잰다.
      layout.relayout();
      renderGutter();
    }
    if (focus) focusCode();
  }

  function collapse() {
    userTouched = true;
    if (!expanded) return;
    // 포커스가 숨길 몸통 안에 있으면 펼침 버튼으로 옮긴다 — 숨은 요소에 포커스가 남으면
    // 키보드 사용자가 제자리를 잃는다.
    const hadFocus = body.contains(document.activeElement);
    showBody(false);
    persist({ expanded: false });
    layout.relayout();
    if (hadFocus) toggle.focus();
  }

  toggle.addEventListener("click", () => (expanded ? collapse() : expand()));

  // ---------- 에러 표시 ----------
  function clearError() {
    errorLineNo = 0;
    errorLine.classList.add("hidden");
    status.textContent = "";
    status.classList.remove("is-error");
  }

  // 에러 띠는 미러에서 잰 그 줄의 위치·높이를 따른다 — 줄바꿈된 줄이면 띠도 그만큼 두껍다.
  // 위치·높이 모두 소수로 잰다(offsetTop·offsetHeight 는 정수라 아래 줄일수록 밀린다 — renderGutter 주석).
  function placeErrorLine() {
    const block = mirror.children[errorLineNo - 1];
    if (!block) return;
    const rect = block.getBoundingClientRect();
    const top = rect.top - mirror.getBoundingClientRect().top;
    errorLine.style.height = `${rect.height}px`;
    errorLine.style.transform = `translateY(${top - text.scrollTop}px)`;
  }

  function showError(line, message) {
    status.textContent = message;
    status.classList.add("is-error");
    errorLineNo = line;
    errorLine.classList.remove("hidden");
    placeErrorLine();
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
      // 접힌 머리글에서 Apply 했다면 에러를 보여 줄 상태 줄이 몸통 안에 숨어 있다 — 펼쳐서
      // 보인다. 사용자가 누른 결과라 "저절로 펼치지 않는다"에 걸리지 않는다.
      expand();
      showError(parsed.line, parsed.message);
      return;
    }
    clearError();

    // 정규화로 모양이 달라지는지 미리 본다(안내를 띄울지 결정하기 위해).
    const { changed } = normalizeCircuit(parsed.qubitCount, parsed.grid);
    circuit.loadCircuit(parsed.qubitCount, parsed.grid, parsed.clbitCount);
    setModified(false);
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
    else renderGutter(); // 편집 중인 QASM 으로 돌아왔다 — 감춰져 있던 동안 못 잰 거터를 잰다
  }

  // 접힌 채 탭을 누르면 펼친다. 탭만 바뀌고 아무것도 안 보이면 눌러도 반응이 없는 것처럼 보인다.
  for (const [btn, name] of [[tabQasm, "qasm"], [tabQiskit, "qiskit"]]) {
    btn.addEventListener("click", () => {
      if (tab !== name) {
        setTab(name);
        persist({ tab: name });
      }
      expand();
    });
  }

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
    clearError();
    renderGutter();
  });
  text.addEventListener("scroll", () => {
    gutter.scrollTop = text.scrollTop;
    if (!errorLine.classList.contains("hidden")) placeErrorLine();
  });

  // Tab 은 가로채지 않는다(예전엔 공백 두 칸 들여쓰기였다). QASM 은 들여쓰기에 뜻이 없고
  // 내보낸 코드도 들여쓰지 않는데, 에디터가 밴드의 마지막 컨트롤이라 Tab 을 가로채면 앞으로는
  // 밴드 밖으로 나갈 길이 없었다.
  text.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); doApply(); }
  });

  // 폭이 바뀌면 줄바꿈 지점이 바뀐다. 쓰기는 한 프레임 미룬다 — 거터 폭(번호 자릿수)이 바뀌면
  // textarea 폭도 따라 바뀌어, 같은 프레임에 쓰면 ResizeObserver loop 경고가 날 수 있다.
  let gutterScheduled = false;
  new ResizeObserver(() => {
    if (gutterScheduled) return;
    gutterScheduled = true;
    requestAnimationFrame(() => {
      gutterScheduled = false;
      renderGutter();
    });
  }).observe(text);
  document.fonts?.ready.then(() => renderGutter());

  // ---------- 회로 변경 알림 ----------
  // 접혀 있어도 돈다. 편집이 있으면 충돌 줄을 띄운다 — 몸통 밖이라 접힌 상태에서도 보인다.
  function onCircuitChanged() {
    if (modified) {
      // 사용자의 편집을 덮어쓰지 않는다. 어느 쪽을 살릴지는 사용자가 고른다.
      conflict.classList.remove("hidden");
      return;
    }
    refresh();
  }

  reload.addEventListener("click", () => {
    conflict.classList.add("hidden");
    setModified(false);
    refresh();
  });
  keep.addEventListener("click", () => {
    conflict.classList.add("hidden");
  });

  // ---------- 복원과 기본 펼침 ----------
  // Apply 의 비활성 표시는 처음부터 맞아야 한다. 드로어 시절에는 열 때마다 setModified·setTab 이
  // 이걸 불렀는데, 밴드는 늘 보이고 "여는" 순간이 없어 편집 전 Apply 가 눌리는 것처럼 보였다.
  updateApplyState();
  if (stored.tab) setTab(stored.tab);
  layout.band.onHeightChange((height) => {
    userTouched = true;
    persist({ height });
  });
  layout.band.setHeight(stored.height);
  showBody(stored.expanded === true);
  refresh(); // 접혀 있어도 — Copy 가 처음부터 지금 회로의 코드를 복사해야 한다
  if (expanded) {
    layout.relayout();
    renderGutter();
  }

  /**
   * 저장된 펼침 상태가 없을 때만, 로드 시 **한 번** 정한다. 이후 회로를 편집하는 동안 저절로
   * 접히거나 펼쳐지지 않는다. 판정은 layout.js 의 bandStartsOpen(rowPlan 입력)이 한다.
   * 밴드를 실제로 펼쳐 높이를 재고, 아니라고 하면 다시 접는다 — 한 태스크 안에서 끝나
   * 페인트·ResizeObserver 는 최종 상태만 본다. 웹폰트 뒤에 재야 크롬 측정이 맞다.
   * DOM 만 바꾸는 showBody 를 쓴다 — 저장·포커스·배지 갱신이 없다(결정은 저장하지 않는다).
   */
  function decideDefaultExpansion() {
    if (userTouched || stored.expanded !== undefined) return;
    const rows = layout.measureRows();
    if (!rows) return;
    const collapsedPx = panel.getBoundingClientRect().height;
    showBody(true);
    const deltaPx = panel.getBoundingClientRect().height - collapsedPx;
    if (!bandStartsOpen(rows, deltaPx, layout.rowOffset())) {
      showBody(false);
      return;
    }
    layout.relayout();
    renderGutter();
  }
  if (stored.expanded === undefined) {
    document.fonts.ready.then(() => requestAnimationFrame(decideDefaultExpansion));
  }

  return {
    /** 메뉴의 Code editor: 펼치고 코드 영역에 포커스한다. */
    open() {
      onOpen?.(); // 메뉴 드로어가 열려 있으면 닫는다
      expand({ focus: true });
    },
    isExpanded: () => expanded,
    onCircuitChanged,
  };
}
