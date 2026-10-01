// QASM / Qiskit 코드 밴드 — 3×2 그리드 아래 전폭. 헤더 입구·탭·에디터·Apply 와 펼침 상태·저장을 맡는다.
//
// 동기화는 **단방향 + 명시적 적용**이다. 회로가 바뀌면 코드는 자동으로 갱신되지만,
// 코드→회로는 Apply(또는 Ctrl/Cmd+Enter)로만 간다. 타이핑 중에는 코드가 거의 항상
// 문법 오류 상태라 자동 반영하면 회로가 깨지고 Undo 스택도 타이핑 단위로 오염된다.
//
// 밴드는 오버레이가 아니라 **레이아웃에 참여**한다 — 그리드 아래에 붙어, 펼치면 그리드 높이가
// 줄 뿐 어느 패널도 가려지지 않는다. 높이·상한·기본 펼침 판정은 layout.js 가 행 배분과 같은
// 자리에서 한다. 입구는 헤더의 Code 버튼이고, 접히면 밴드와 그 위 간격이 **0px** 이다 — 다섯
// 패널 모두에 양보하는 최하위가 접힌 채 1순위인 회로를 밀면 안 된다(6단계에서 접힌 머리글
// 63px 가 1536×740 회로를 49px 스크롤시켰다). 예외는 충돌 줄 하나다. 대화상자가 아니므로
// 포커스 트랩이 없다.

import { toQASM, toQiskit } from "./export.js";
import { parseQASM, normalizeCircuit } from "./qasm.js";
import { bandStartsOpen } from "./layout.js";

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

export function initCodePanel({ circuit, layout, els, showToast }) {
  const {
    entry, entryDot, resizer, panel, collapseBtn, body,
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
    if (body.hidden || panel.hidden || editor.classList.contains("hidden")) return;
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
   * **접혀 있어도 부른다.** 펼칠 때까지 미뤄 두면 숨은 textarea 에 낡은 코드가 남는데, 6단계에서
   * 그 낡은 코드가 접힌 머리글의 Copy 로 복사됐다(실측). 갱신을 미루는 분기를 다시 만들지 않는다.
   * 거터만은 보일 때 잰다.
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
    syncBand(); // 입구의 표시 점
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

  // ---------- 보이는 상태 ----------
  /**
   * 밴드·간격·머리글·충돌 줄·헤더 입구의 표시를 **펼침 여부와 충돌 줄 표시 여부** 둘로만 정한다.
   *   펼침        → 밴드·간격·머리글·몸통 보임
   *   접힘 + 충돌  → 밴드는 충돌 줄만(머리글·몸통 없음), 간격은 남되 조작은 CSS 가 끈다
   *   접힘        → 밴드·간격 모두 hidden — 0px
   * DOM 만 바꾼다. 저장·포커스는 부르는 쪽(사용자 경로)이 한다 — 로드 시 측정이 이것만 탄다.
   */
  function syncBand() {
    const conflictShown = !conflict.classList.contains("hidden");
    const shown = expanded || conflictShown;
    panel.hidden = !shown;
    resizer.hidden = !shown;
    panel.classList.toggle("is-collapsed", !expanded);
    body.hidden = !expanded;
    entry.setAttribute("aria-expanded", String(expanded));
    entry.title = expanded ? "Hide code" : "Show code";
    // 접힌 채 적용 안 한 편집이나 충돌이 있으면 입구에 점을 단다. 펼쳐 있으면 밴드 안의
    // Modified 배지와 충돌 줄이 보이므로 끈다. 점이 말하는 것을 이름에도 넣는다 — 점은 보이는
    // 사람에게만 닿는다. 이름은 보이는 글자 "Code" 로 시작해야 한다(말로 부르는 이름과 같게).
    const pending = !expanded && (modified || conflictShown);
    entryDot.hidden = !pending;
    entry.setAttribute("aria-label",
      !pending ? "Code"
        : conflictShown ? "Code, unapplied edits, circuit changed"
          : "Code, unapplied edits");
  }

  function setExpanded(value) {
    expanded = value;
    syncBand();
  }

  function codeArea() {
    return tab === "qasm" ? text : pre;
  }

  /**
   * 바꾸는 동안 밴드 안에 있던 포커스가 숨어 버리면 남는 자리로 옮긴다. 숨은 요소의 포커스는
   * body 로 떨어져 키보드 사용자가 제자리를 잃는다. 밴드가 펼친 채 남으면 코드 영역(밴드에서 하던
   * 일을 이어 간다), 밴드가 숨으면 헤더의 입구로 간다.
   */
  function keepingFocus(change) {
    const before = document.activeElement;
    const inBand = panel.contains(before);
    change();
    if (!inBand || before.offsetParent !== null) return;
    (expanded ? codeArea() : entry).focus();
  }

  function expand({ focus = false } = {}) {
    userTouched = true;
    if (!expanded) {
      setExpanded(true);
      persist({ expanded: true });
      // 밴드 높이가 바뀌었으니 같은 호출 안에서 그리드·행을 다시 맞추고(강제 레이아웃),
      // 그 뒤에야 미러가 실제 폭을 잰다.
      layout.relayout();
      renderGutter();
    }
    if (focus) codeArea().focus();
  }

  function collapse() {
    userTouched = true;
    if (!expanded) return;
    keepingFocus(() => setExpanded(false));
    persist({ expanded: false });
    layout.relayout();
  }

  // 헤더 입구: 펼치면 코드 영역으로 포커스를 옮긴다 — 밴드가 화면 아래라 그리드 전체를 Tab 으로
  // 지나가지 않게. 접으면 누른 버튼에 포커스가 그대로 남는다.
  entry.addEventListener("click", () => (expanded ? collapse() : expand({ focus: true })));
  collapseBtn.addEventListener("click", () => collapse());

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
  // Apply 버튼과 Ctrl+Enter 는 펼친 밴드에만 있다 — 상태 줄이 늘 보이는 자리에서만 적용된다.
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
    showConflict(false);
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

  // 탭은 펼친 밴드의 머리글에만 있다 — 누르면 탭만 바꾼다.
  for (const [btn, name] of [[tabQasm, "qasm"], [tabQiskit, "qiskit"]]) {
    btn.addEventListener("click", () => {
      if (tab === name) return;
      setTab(name);
      persist({ tab: name });
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

  // ---------- 충돌 ----------
  // 충돌 줄은 접힌 밴드가 0px 이 아닌 유일한 경우다. 나타나고 사라질 때 밴드 높이가 바뀌므로
  // 같은 호출 안에서 행을 다시 맞춘다. 사라질 때 그 안의 버튼(Reload·Keep)에 포커스가 있었으면
  // keepingFocus 가 옮긴다 — 접혀 있으면 밴드 전체가 숨는다.
  function showConflict(shown) {
    if (conflict.classList.contains("hidden") === !shown) return;
    keepingFocus(() => {
      conflict.classList.toggle("hidden", !shown);
      syncBand();
    });
    layout.relayout();
  }

  // 접혀 있어도 돈다. 편집이 있으면 충돌 줄을 띄운다 — 머리글·몸통 밖이라 접힌 상태에서도 보인다.
  function onCircuitChanged() {
    if (modified) {
      // 사용자의 편집을 덮어쓰지 않는다. 어느 쪽을 살릴지는 사용자가 고른다.
      showConflict(true);
      return;
    }
    refresh();
  }

  reload.addEventListener("click", () => {
    setModified(false);
    refresh();
    showConflict(false);
  });
  keep.addEventListener("click", () => showConflict(false));

  // ---------- 복원과 기본 펼침 ----------
  // Apply 의 비활성 표시는 처음부터 맞아야 한다. 드로어 시절에는 열 때마다 setModified·setTab 이
  // 이걸 불렀는데, 밴드에는 "여는" 순간이 따로 없어 편집 전 Apply 가 눌리는 것처럼 보였다.
  updateApplyState();
  if (stored.tab) setTab(stored.tab);
  layout.band.onHeightChange((height) => {
    userTouched = true;
    persist({ height });
  });
  layout.band.setHeight(stored.height);
  setExpanded(stored.expanded === true);
  refresh(); // 접혀 있어도 — 펼치는 순간 지금 회로의 코드가 있어야 한다
  if (expanded) {
    layout.relayout();
    renderGutter();
  }

  /**
   * 저장된 펼침 상태가 없을 때만, 로드 시 **한 번** 정한다. 이후 회로를 편집하는 동안 저절로
   * 접히거나 펼쳐지지 않는다. 판정은 layout.js 의 bandStartsOpen(rowPlan 입력)이 한다.
   * Δ 는 "그리드가 잃는 높이"를 그대로 잰다 — 밴드를 실제로 펼친 뒤 두 행 가용 높이의 차이라,
   * 밴드와 그 위 간격이 함께 들어간다. 아니라고 하면 다시 접는다. 한 태스크 안에서 끝나
   * 페인트·ResizeObserver 는 최종 상태만 본다. 웹폰트 뒤에 재야 크롬 측정이 맞다.
   * **DOM 만 바꾸는 setExpanded 를 쓴다** — 저장도 포커스 이동도 없다. 사용자 경로(expand)를 타면
   * 큰 화면에서 로드하는 순간 포커스가 화면 아래 에디터로 가고 브라우저가 스크롤한다.
   */
  function decideDefaultExpansion() {
    if (userTouched || stored.expanded !== undefined) return;
    const before = layout.measureRows();
    if (!before) return;
    setExpanded(true);
    const after = layout.measureRows();
    const deltaPx = after ? before.available - after.available : Infinity;
    if (!bandStartsOpen(before, deltaPx, layout.rowOffset())) {
      setExpanded(false);
      return;
    }
    layout.relayout();
    renderGutter();
  }
  if (stored.expanded === undefined) {
    document.fonts.ready.then(() => requestAnimationFrame(decideDefaultExpansion));
  }

  return {
    isExpanded: () => expanded,
    onCircuitChanged,
  };
}
