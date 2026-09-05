// 게이트 컨텍스트 메뉴와 게이트 정보 패널. 선택 상태(selectedGate/infoTarget/expandedInfo)를 소유한다.
//
// **컨트롤러보다 먼저** 초기화한다 — render 가 invalidateSelection · renderGateInfo ·
// markSelection 을 부르고, 그 render 는 createCircuitController 안의 notify() 에서 이미
// 한 번 돈다. 그래서 circuit 은 값이 아니라 getCircuit getter 로 받는다.
// 팝오버 다섯은 컨트롤러 **뒤**에 배선되므로 진입점이 화살표로 감싸 넘긴다(값이면 TDZ).
import { GATE_INFO } from "./quantum.js";
import { homeOf, cellAtHome, involvedQubits } from "./circuit.js";
import { gateMatrix, formatComplex, symbolicComplex, gateDescription, decompositionSteps } from "./gatematrix.js";
import { icon } from "./icons.js";

// 고전 조건을 붙일 수 없는 게이트(비유니터리 마커 + 분해가 고정된 상대위상 게이트)
const NON_CONDITIONABLE = new Set(["MEASURE", "RESET", "BARRIER", "CTRL", "IF", "RCCX", "RC3X"]);

// 주입되는 의존. initGateMenu 전에는 undefined 다.
let getCircuit, scene, showToast, showTooltip, hideTooltip, standardGateName;
let gatePalette, gateInfoEl, gateInfoClose, paletteTitle, gateMenu, circuitGrid;
// 팝오버 다섯은 옮긴 블록이 이 이름 그대로 부르므로 같은 이름의 모듈 변수로 받는다.
let openControlPopover, openConditionPopover, openMeasureBitPopover,
    openRemoveControlPopover, openParamEditor;

/**
 * 의존을 주입하고 공개 API 를 돌려준다. **컨트롤러를 만들기 전에** 부른다.
 *
 * 매개변수 이름을 죄다 줄여 쓴 것은 취향이 아니다 — 최상위 let 과 같은 이름을 쓰면
 * 매개변수가 그것을 가려 모듈 변수가 영원히 undefined 로 남는다(4단계 chartTooltip).
 * check-shadowing.mjs 는 매개변수를 보지 않으므로 이 규칙은 사람이 지킨다.
 * e 와 t 도 피한다 — 아래로 옮겨 온 Delete 리스너가 (e) 를 받고 const t 를 선언한다.
 */
export function initGateMenu({ getCircuit: gc, scene: sc, showToast: stoast,
    showTooltip: sht, hideTooltip: hht, standardGateName: sgn, popover, els }) {
  getCircuit = gc;
  scene = sc;
  showToast = stoast;
  showTooltip = sht;
  hideTooltip = hht;
  standardGateName = sgn;
  gatePalette = els.gatePalette;
  gateInfoEl = els.gateInfoEl;
  gateInfoClose = els.gateInfoClose;
  paletteTitle = els.paletteTitle;
  gateMenu = els.gateMenu;
  circuitGrid = els.circuitGrid;
  ({ openControlPopover, openConditionPopover, openMeasureBitPopover,
     openRemoveControlPopover, openParamEditor } = popover);

  gateInfoClose.addEventListener("click", closeGateInfo);

  // Esc: 메뉴가 열려 있으면 메뉴부터, 아니면 게이트 정보를 닫는다(팔레트로 복귀).
  // 회로는 어느 쪽도 바뀌지 않는다.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (gateMenuOpen()) closeGateMenu();
    else if (infoTarget) closeGateInfo();
  });
  document.addEventListener("click", (e) => {
    if (gateMenuOpen() && !gateMenu.contains(e.target)) closeGateMenu();
  });

  // [6] 삭제 빠른 경로: 선택된 게이트를 Delete/Backspace로 제거한다(메뉴가 열린 상태 포함 —
  // 메뉴를 열면 그 게이트가 선택되므로 그대로 키를 눌러 지울 수 있다). 좌클릭 삭제가 없어진 대신의 경로.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Delete" && e.key !== "Backspace") return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    if (!selectedGate) return;
    e.preventDefault();
    scene.clearTrail();
    closeGateMenu();
    getCircuit().removeGate(selectedGate.column, selectedGate.home);
    selectedGate = null;
    infoTarget = null; // 지운 게이트의 정보가 남아 있지 않게
  });

  return { openMenuForCell, markSelection, renderGateInfo, clearSelection, invalidateSelection };
}

// 아래 다섯에는 export 를 붙이지 않는다. 공개 경로가 둘이면 initGateMenu 전에 직접
// import 해서 부를 수 있고, 그때 주입 의존은 전부 undefined 다.

/** 빈 칸을 눌렀을 때처럼 선택을 통째로 푼다. */
function clearSelection() {
  selectedGate = null; // 빈 칸 클릭 → 선택 해제
  markSelection();
}

/** 회로가 바뀌어 선택/정보 대상이 사라졌으면 해제한다. render 가 부른다. */
function invalidateSelection(snapshot) {
  if (selectedGate && !cellAtHome(snapshot, selectedGate)) selectedGate = null;
  if (infoTarget && !cellAtHome(snapshot, infoTarget)) { infoTarget = null; expandedInfo = null; }
}

// ---------- [2] 선택한 게이트 정보 (상태벡터 아래 패널) ----------

// 선택은 셀의 홈 좌표로 들고 있는다. 회로가 바뀌면 render에서 유효성을 다시 확인한다.
let selectedGate = null; // { column, home }

// "Show info"로 정보를 열 때만 설정된다. null이면 Operations 패널은 팔레트를 보여준다.
let infoTarget = null; // { column, home }

function openGateInfo(column, home) {
  infoTarget = { column, home };
  renderGateInfo(getCircuit().getSnapshot());
}

function closeGateInfo() {
  infoTarget = null;
  expandedInfo = null;
  renderGateInfo(getCircuit().getSnapshot());
}

function markSelection() {
  for (const el of circuitGrid.querySelectorAll(".selected")) el.classList.remove("selected");
  if (!selectedGate) return;
  const { column, home } = selectedGate;
  const snapshot = getCircuit().getSnapshot();
  const cell = snapshot.grid[column]?.[home];
  if (!cell) return;
  for (const q of involvedQubits(cell)) {
    const el = circuitGrid.querySelector(`.grid-cell[data-col="${column}"][data-qubit="${q}"] > *`);
    if (el) el.classList.add("selected");
  }
}

const radToDeg = (rad) => (rad * 180) / Math.PI;
// θ/φ/λ를 "π/2 (90°)" 처럼 라디안+도로 함께 보여준다.
const PI_FRACTIONS = [
  [Math.PI, "π"], [Math.PI / 2, "π/2"], [Math.PI / 3, "π/3"], [Math.PI / 4, "π/4"],
  [Math.PI / 6, "π/6"], [Math.PI * 2, "2π"], [Math.PI * 1.5, "3π/2"], [Math.PI * 0.75, "3π/4"],
];
function formatAngle(rad) {
  const hit = PI_FRACTIONS.find(([v]) => Math.abs(Math.abs(rad) - v) < 1e-6);
  const sym = hit ? `${rad < 0 ? "−" : ""}${hit[1]}` : `${rad.toFixed(3)} rad`;
  return `${sym} (${Math.round(radToDeg(rad))}°)`;
}

// 라벨(위/왼쪽 기저 켓)이 붙은 행렬 그리드. 대각 성분은 옅은 배경으로 구분한다.
function buildMatrixGrid(m) {
  const grid = document.createElement("div");
  grid.className = "mx-grid";
  grid.style.gridTemplateColumns = `auto repeat(${m.size}, auto)`;
  const add = (cls, text) => {
    const el = document.createElement("div");
    el.className = cls;
    el.textContent = text;
    grid.appendChild(el);
    return el;
  };
  add("mx-corner", "");
  for (const label of m.basisLabels) add("mx-collabel", label); // 열 라벨(위)
  for (let r = 0; r < m.size; r++) {
    add("mx-rowlabel", m.basisLabels[r]); // 행 라벨(왼쪽)
    for (let c2 = 0; c2 < m.size; c2++) {
      const z = m.rows[r][c2];
      const cell = add("mx-cell" + (r === c2 ? " mx-diag" : ""), formatComplex(z));
      if (Math.abs(z.re) < 5e-4 && Math.abs(z.im) < 5e-4) cell.classList.add("mx-zero");
      const sym = symbolicComplex(z);
      if (sym) {
        cell.title = sym; // 알려진 값이면 기호 표기를 병기(툴팁)
        cell.addEventListener("mouseenter", () => showTooltip(cell, sym));
        cell.addEventListener("mouseleave", hideTooltip);
      }
    }
  }
  return grid;
}

// Operations 패널의 팔레트 ↔ 게이트 정보 전환. infoTarget이 있을 때만 정보가 보인다.
function renderGateInfo(snapshot) {
  const cell = cellAtHome(snapshot, infoTarget);
  if (!cell) {
    infoTarget = null;
    gateInfoEl.classList.add("hidden");
    gateInfoEl.innerHTML = "";
    gatePalette.classList.remove("hidden");
    gateInfoClose.classList.add("hidden");
    paletteTitle.textContent = "Operations";
    return;
  }
  gateInfoEl.classList.remove("hidden");
  gatePalette.classList.add("hidden"); // 표시 중에는 팔레트 대신 정보가 보인다
  gateInfoClose.classList.remove("hidden");
  paletteTitle.textContent = "Gate info";
  gateInfoEl.innerHTML = "";
  const row = (html) => {
    const d = document.createElement("div");
    d.className = "gate-info-row";
    d.innerHTML = html;
    gateInfoEl.appendChild(d);
    return d;
  };

  const title = document.createElement("div");
  title.className = "gate-info-title";
  title.textContent = standardGateName(cell);
  gateInfoEl.appendChild(title);

  row(gateDescription(cell));

  // 적용 대상
  const targets = cell.targets ?? [];
  const controls = cell.controls ?? [];
  const qList = (arr) => arr.map((q) => `q[${q}]`).join(", ");
  if (GATE_INFO[cell.gate]?.kind === "decomposed") {
    row(`<b>Controls</b> ${qList(targets.slice(0, -1))} · <b>Target</b> ${qList(targets.slice(-1))}`);
  } else {
    row(`<b>Target</b> ${qList(targets)}${controls.length ? ` · <b>Controls</b> ${qList(controls)}` : ""}`);
  }

  // 파라미터(라디안 + 도)
  const params = cell.params ?? {};
  const names = [["theta", "θ"], ["phi", "φ"], ["lambda", "λ"]];
  const shown = names.filter(([k]) => params[k] !== undefined);
  if (shown.length) row(shown.map(([k, sym]) => `<b>${sym}</b> ${formatAngle(params[k])}`).join(" · "));

  // 행렬
  const m = gateMatrix(cell);
  if (m.ok) {
    gateInfoEl.appendChild(buildMatrixGrid(m));
    const note = document.createElement("div");
    note.className = "gate-info-note";
    note.textContent = m.localOrder; // 예: local |c t⟩ = |q0 q1⟩
    gateInfoEl.appendChild(note);
  } else if (m.tooLarge) {
    row(`Matrix is ${m.size}x${m.size} (too large to display)`);
    const note = document.createElement("div");
    note.className = "gate-info-note";
    note.textContent = m.localOrder;
    gateInfoEl.appendChild(note);
  } else {
    row(m.reason);
  }

  // [4] 분해 표시 + Apply expansion
  if (expandedInfo && expandedInfo.column === infoTarget.column && expandedInfo.home === infoTarget.home) {
    const steps = decompositionSteps(cell);
    if (steps) {
      const hint = document.createElement("div");
      hint.className = "gate-info-note";
      hint.textContent = "Definition (read-only)";
      gateInfoEl.appendChild(hint);
      const list = document.createElement("div");
      list.className = "gate-info-steps";
      for (const s of steps) {
        const chip = document.createElement("span");
        chip.className = "gate-info-step";
        chip.textContent = s.text;
        list.appendChild(chip);
      }
      gateInfoEl.appendChild(list);
      const apply = document.createElement("button");
      apply.className = "pill-btn-primary";
      apply.textContent = "Apply expansion";
      apply.addEventListener("click", () => {
        const { column, home } = infoTarget;
        const res = getCircuit().expandGate(column, home);
        expandedInfo = null;
        if (!res.ok) { showToast(res.reason); return; }
        infoTarget = null; // 원래 게이트가 사라졌으니 정보를 닫고 팔레트로 돌아간다
        selectedGate = null;
        showToast(`Expanded into ${res.columns} steps — Undo (Ctrl+Z) to revert`);
      });
      gateInfoEl.appendChild(apply);
    }
  }
}
let expandedInfo = null; // { column, home } — "Expand definition"을 누른 셀

// ---------- [3] 컨텍스트 메뉴 (가로 아이콘 바) ----------

// 아이콘은 인라인 SVG로만 넣는다 — 이모지는 플랫폼마다 렌더링이 다르고 크기 제어가 안 된다.
// 한 세트로 보이도록 24 뷰박스 · stroke-width 1.9 · round 캡으로 통일한다.
// 컨텍스트 메뉴 아이콘 → Lucide 이름 매핑.
// 예전에는 여기서 SVG를 직접 그렸는데(제어점·고전선 등 회로 표기를 흉내낸 형태),
// 손으로 그린 도형은 그리드도 스트로크도 Lucide와 달라 **한 세트로 보이지 않았다**.
// 의미는 aria-label과 툴팁이 전달하므로 아이콘은 Lucide 표준형을 쓴다.
const MENU_ICONS = {
  info: "info",                    // Show info
  edit: "pencil",                  // Edit parameters
  expand: "unfold-horizontal",     // Expand definition — 한 게이트가 여러 열로 펼쳐진다
  ctrlAdd: "circle-plus",          // Add control
  ctrlRemove: "circle-minus",      // Remove control
  clbit: "binary",                 // Set classical bit / Add condition (if)
  trash: "trash-2",                // Delete
};

let menuIndex = 0;

// 메뉴가 붙인 리스너의 수명 손잡이. 예전에는 openGateMenu 가 gateMenu 에 keydown 을
// 붙이기만 하고 여기서 떼지 않아, 열 때마다 하나씩 쌓였다. gateMenu 는 <body> 직속
// 요소라 innerHTML = "" 로는 **자식만** 지워지고 자신에게 붙은 리스너는 그대로 남는다.
// 그렇게 쌓인 옛 핸들러들이 공유 menuIndex 를 연달아 덮어써서 방향키 한 번에 포커스가
// 열어본 횟수만큼 건너뛰었다. 분리된 옛 버튼의 .focus() 는 조용한 무동작이라 콘솔
// 에러가 0이었고, 그래서 눈으로도 잡히지 않았다.
// 붙이는 곳과 떼는 곳이 떨어져 있던 것이 원인이므로 수명을 이 손잡이 하나로 묶는다 —
// 나중에 메뉴에 리스너를 더 붙여도 같은 signal 에 실으면 여기서 함께 끊긴다.
let menuKeys = null;

function closeGateMenu() {
  menuKeys?.abort(); // 이 메뉴가 붙인 리스너를 전부 해제
  menuKeys = null;
  gateMenu.classList.add("hidden");
  gateMenu.innerHTML = "";
  hideTooltip(); // 아이콘 툴팁이 남아 떠 있지 않게
}
const gateMenuOpen = () => !gateMenu.classList.contains("hidden");

function openGateMenu(column, home, clientX, clientY) {
  closeGateMenu();
  const snapshot = getCircuit().getSnapshot();
  const cell = snapshot.grid[column]?.[home];
  if (!cell) return;
  const info = GATE_INFO[cell.gate];
  const params = cell.params ?? {};
  const hasParams = ["theta", "phi", "lambda"].some((k) => params[k] !== undefined);
  const controls = cell.controls ?? [];
  const steps = decompositionSteps(cell);
  // 분해가 없는 이유: 진짜 기본 게이트인지, 이 앱에 정의가 없을 뿐인지 구분해 안내한다.
  const primitive = info?.kind === "fixed" || info?.kind === "param" || info?.kind === "param3";
  const opts = getCircuit().controlOptions(column, home);

  // group: 관련 항목끼리 묶어 구분선을 넣는다 — [정보/편집] | [제어] | [삭제]
  const items = [
    { label: "Show info", icon: "info", group: 0, run: () => { expandedInfo = null; openGateInfo(column, home); } },
    {
      label: "Edit parameters", icon: "edit", group: 0, enabled: hasParams,
      why: "No parameters (only RX, RY, RZ, P, U have parameters)",
      run: () => openParamEditor(column, home, cell, clientX, clientY),
    },
    {
      label: "Expand definition", icon: "expand", group: 0, enabled: !!steps,
      why: primitive ? "Primitive gate — no decomposition" : "No decomposition defined for this gate",
      run: () => { expandedInfo = { column, home }; openGateInfo(column, home); },
    },
    {
      label: "Add control", icon: "ctrlAdd", group: 1, enabled: opts.ok,
      why: opts.ok ? null : (opts.reason === "No free wire in this column for a control" ? "No free wire in this column" : opts.reason),
      run: () => {
        if (opts.candidates.length === 1) {
          const res = getCircuit().addControlToGate(column, home, opts.candidates[0]);
          if (!res.ok) showToast(res.reason);
        } else openControlPopover(column, home, opts.candidates, clientX, clientY);
      },
    },
    {
      label: "Remove control", icon: "ctrlRemove", group: 1, enabled: controls.length > 0,
      why: "This gate has no controls",
      run: () => {
        if (controls.length === 1) getCircuit().removeControl(column, controls[0]);
        else openRemoveControlPopover(column, controls, clientX, clientY);
      },
    },
    // 고전 레지스터: Measure는 기록 대상 비트를, 그 밖의 게이트는 조건 비트를 고른다.
    cell.gate === "MEASURE"
      ? {
          label: "Set classical bit", icon: "clbit", group: 1, enabled: snapshot.clbitCount > 0,
          why: "There are no classical bits",
          run: () => openMeasureBitPopover(column, home, snapshot.clbitCount, clientX, clientY),
        }
      : {
          label: params.cif === undefined ? "Add condition (if)" : "Change / remove condition",
          icon: "clbit", group: 1,
          enabled: snapshot.clbitCount > 0 && !NON_CONDITIONABLE.has(cell.gate),
          why: snapshot.clbitCount === 0 ? "There are no classical bits" : `${cell.gate} cannot be conditioned`,
          run: () => openConditionPopover(column, home, snapshot.clbitCount, clientX, clientY),
        },
    // 파괴적 동작은 맨 오른쪽에 구분선으로 분리한다
    { label: "Delete", icon: "trash", group: 2, danger: true, run: () => { getCircuit().removeGate(column, home); selectedGate = null; infoTarget = null; } },
  ];

  const buttons = [];
  items.forEach((item, i) => {
    if (i > 0 && item.group !== items[i - 1].group) {
      const sep = document.createElement("div");
      sep.className = "gate-menu-sep";
      gateMenu.appendChild(sep);
    }
    const btn = document.createElement("button");
    btn.className = "gate-menu-item" + (item.danger ? " is-danger" : "");
    btn.innerHTML = icon(MENU_ICONS[item.icon]);
    const off = item.enabled === false;
    // `disabled` 속성을 쓰지 않는다 — 브라우저가 disabled 요소의 마우스 이벤트를 막아
    // "왜 못 쓰는지" 툴팁이 아예 뜨지 않기 때문. aria-disabled로 표현하고 클릭만 막는다.
    // 라벨이 아이콘으로 바뀌어 사유 툴팁이 더 중요해졌다.
    if (off) {
      btn.classList.add("is-disabled");
      btn.setAttribute("aria-disabled", "true");
    }
    // 아이콘만으로는 의미를 알 수 없으므로 이름(또는 비활성 사유)을 반드시 노출한다.
    const tip = off ? (item.why ?? item.label) : item.label;
    btn.setAttribute("aria-label", off && item.why ? `${item.label} — ${item.why}` : item.label);
    btn.tabIndex = -1; // roving tabindex: 방향키로 이동(비활성도 포커스는 받는다)
    btn.addEventListener("mouseenter", () => showTooltip(btn, tip));
    btn.addEventListener("mouseleave", hideTooltip);
    btn.addEventListener("focus", () => showTooltip(btn, tip));
    btn.addEventListener("click", (e) => {
      e.stopPropagation(); // document로 가면 "바깥 클릭"이 방금 연 팝오버/메뉴를 즉시 닫는다
      if (off) return;
      closeGateMenu();
      scene.clearTrail();
      item.run();
    });
    gateMenu.appendChild(btn);
    buttons.push(btn);
  });

  gateMenu.classList.remove("hidden");
  // 선택한 게이트 근처에 띄우되 화면 밖으로 나가지 않게 보정한다(오른쪽 끝 게이트도 잘리지 않게).
  const rect = gateMenu.getBoundingClientRect();
  const left = Math.min(Math.max(8, clientX - rect.width / 2), window.innerWidth - rect.width - 8);
  const above = clientY - rect.height - 12;
  gateMenu.style.left = `${left}px`;
  gateMenu.style.top = `${above >= 8 ? above : Math.min(clientY + 16, window.innerHeight - rect.height - 8)}px`;

  // 좌우 방향키로 이동, Enter/Space로 실행. 비활성 항목도 **건너뛰지 않고** 포커스를 받아
  // 사유 툴팁을 볼 수 있게 한다(실행만 막힌다).
  menuIndex = 0;
  const focusAt = (i) => {
    menuIndex = (i + buttons.length) % buttons.length;
    buttons.forEach((b, j) => {
      b.classList.toggle("active", j === menuIndex);
      b.tabIndex = j === menuIndex ? 0 : -1;
    });
    buttons[menuIndex].focus();
  };
  if (buttons.length) focusAt(0);
  menuKeys = new AbortController();
  gateMenu.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); focusAt(menuIndex + 1); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); focusAt(menuIndex - 1); }
  }, { signal: menuKeys.signal });
}


// 게이트를 선택 상태로 만들고(= Delete 키의 대상) 메뉴를 연다. 정보 패널은 건드리지 않는다.
function openMenuForCell(column, qubit, clientX, clientY) {
  const snapshot = getCircuit().getSnapshot();
  const home = homeOf(snapshot, column, qubit);
  if (home === -1) return;
  hideTooltip();
  selectedGate = { column, home };
  markSelection();
  openGateMenu(column, home, clientX, clientY);
}
