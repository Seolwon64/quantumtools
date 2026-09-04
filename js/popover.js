// 배치·컨트롤·고전비트·파라미터 팝오버. 넷 다 같은 #place-popover DOM 을 재사용한다.
//
// 의존은 initPopover 로 주입받는다 — 이 모듈이 main.js 를 import 하면 순환이 되고,
// 최상위에서 DOM 을 잡으면 import 순서가 곧 실행 순서가 되기 때문이다(codepanel.js 와 같은 방식).
import { homeOf } from "./circuit.js";
import { GATE_INFO } from "./quantum.js";
import { icon } from "./icons.js";

// 주입되는 의존. initPopover 전에는 undefined 다.
let circuit, scene, showToast, standardGateName, placePopover;

/** 의존을 주입하고 공개 API 를 돌려준다. circuit 이 만들어진 뒤에 부른다. */
export function initPopover({ circuit: c, scene: s, showToast: t, standardGateName: g, els }) {
  circuit = c;
  scene = s;
  showToast = t;
  standardGateName = g;
  placePopover = els.placePopover;

  // Esc / 바깥 클릭으로 취소. 취소 경로는 컨트롤러를 전혀 호출하지 않으므로 회로도 undo 스택도 그대로다.
  const popoverOpen = () => !placePopover.classList.contains("hidden");
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && popoverOpen()) closePlacePopover();
  });
  document.addEventListener("click", (e) => {
    if (popoverOpen() && !placePopover.contains(e.target)) closePlacePopover();
  });

  return {
    closePlacePopover,
    openPlacePopover,
    openControlPopover,
    openConditionPopover,
    openMeasureBitPopover,
    openRemoveControlPopover,
    openParamEditor,
  };
}

// ---------- 배치 팝오버 (각도/컨트롤/파트너 선택) ----------

let pendingPlacement = null;

function closePlacePopover() {
  placePopover.classList.add("hidden");
  placePopover.innerHTML = "";
  pendingPlacement = null;
}


function radToDegRound(rad) {
  return Math.round((rad * 180) / Math.PI);
}

// θ/φ/λ 각도 슬라이더 행을 팝오버에 붙이고 input 요소들을 돌려준다.
// 배치 팝오버와 "Edit parameters" 편집 팝오버가 같은 UI를 쓰도록 공용화한 부분.
function buildSliderRows(names, initialDegrees) {
  const inputs = [];
  names.forEach((name, i) => {
    const row = document.createElement("div");
    row.className = "slider-row";
    const label = document.createElement("span");
    label.className = "slider-label";
    const valueSpan = document.createElement("span");
    valueSpan.className = "slider-value";
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "360";
    slider.step = "1";
    const deg = ((initialDegrees[i] ?? 0) % 360 + 360) % 360;
    slider.value = String(deg);
    label.textContent = name;
    valueSpan.textContent = `${deg}°`;
    slider.addEventListener("input", () => { valueSpan.textContent = `${slider.value}°`; });
    row.append(label, slider, valueSpan);
    placePopover.appendChild(row);
    inputs.push(slider);
  });
  return inputs;
}

function openPlacePopover(column, qubit, gateName, clientX, clientY, qubitCount) {
  const info = GATE_INFO[gateName];
  // controlled(CNOT/CCX/…)·decomposed(RCCX/RC3X)·cswap는 컨트롤을 고른다.
  const needControls = info.kind === "controlled" || info.kind === "decomposed" || info.kind === "cswap" ? (info.controls ?? 0) : 0;
  // swap/pair-param/cswap는 파트너(두 번째 타깃)를 고른다. CSWAP는 파트너+컨트롤 둘 다.
  const needPartner = info.kind === "swap" || info.kind === "pair-param" || info.kind === "cswap" ? 1 : 0;
  const sliderNames =
    info.kind === "param" || info.kind === "pair-param" ? ["θ"]
    : info.kind === "param3" ? ["θ", "φ", "λ"]
    : [];

  pendingPlacement = { column, qubit, gateName, partner: [], control: [] };
  placePopover.innerHTML = "";

  const title = document.createElement("div");
  title.className = "place-popover-title";
  title.textContent = `${info.label} → q[${qubit}]`;
  placePopover.appendChild(title);

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "pill-btn-primary";
  confirmBtn.textContent = "Apply";

  function updateConfirm() {
    confirmBtn.disabled =
      pendingPlacement.partner.length !== needPartner || pendingPlacement.control.length !== needControls;
  }

  const selectedElsewhere = (role, q) =>
    (role === "partner" ? pendingPlacement.control : pendingPlacement.partner).includes(q);

  // role별 독립 선택 행. CSWAP는 파트너 행 + 컨트롤 행 둘 다 렌더된다(서로 겹치지 않게).
  function buildPicker(role, count, labelText) {
    const pickLabel = document.createElement("div");
    pickLabel.className = "place-popover-hint";
    pickLabel.textContent = labelText;
    placePopover.appendChild(pickLabel);

    const pickRow = document.createElement("div");
    pickRow.className = "qpick-row";
    for (let q = 0; q < qubitCount; q++) {
      if (q === qubit) continue;
      const btn = document.createElement("button");
      btn.className = "qpick-btn";
      btn.textContent = `q[${q}]`;
      btn.addEventListener("click", () => {
        const list = pendingPlacement[role];
        const idx = list.indexOf(q);
        if (idx >= 0) {
          list.splice(idx, 1);
          btn.classList.remove("selected");
        } else if (!selectedElsewhere(role, q) && list.length < count) {
          list.push(q);
          btn.classList.add("selected");
        }
        updateConfirm();
      });
      pickRow.appendChild(btn);
    }
    placePopover.appendChild(pickRow);
  }

  if (needPartner > 0) {
    buildPicker("partner", needPartner, needControls > 0 ? "Select swap target qubit" : "Select partner qubit");
  }
  if (needControls > 0) {
    buildPicker("control", needControls, `Select ${needControls} control qubit${needControls > 1 ? "s" : ""}`);
  }

  const sliderInputs = buildSliderRows(
    sliderNames,
    sliderNames.map((name) => (name === "θ" ? radToDegRound(info.defaultTheta ?? Math.PI / 2) : 0))
  );

  const actions = document.createElement("div");
  actions.className = "place-popover-actions";
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "icon-btn";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", closePlacePopover);

  confirmBtn.addEventListener("click", () => {
    if (!pendingPlacement) return;
    const params = {};
    const toRad = (v) => (Number(v) * Math.PI) / 180;
    if (sliderNames.length === 1) params.theta = toRad(sliderInputs[0].value);
    if (sliderNames.length === 3) {
      params.theta = toRad(sliderInputs[0].value);
      params.phi = toRad(sliderInputs[1].value);
      params.lambda = toRad(sliderInputs[2].value);
    }
    if (needControls > 0) params.controls = pendingPlacement.control.slice();
    if (needPartner > 0) params.partner = pendingPlacement.partner[0];
    scene.clearTrail();
    circuit.placeGate(pendingPlacement.column, pendingPlacement.qubit, pendingPlacement.gateName, params);
    closePlacePopover();
  });

  actions.append(cancelBtn, confirmBtn);
  placePopover.appendChild(actions);
  updateConfirm();
  showPopoverAt(clientX, clientY);
}

// 팝오버를 포인터 위치에 띄우되 화면 밖으로 나가지 않게 보정한다(배치/컨트롤 팝오버 공용).
function showPopoverAt(clientX, clientY) {
  placePopover.classList.remove("hidden");
  const rect = placePopover.getBoundingClientRect();
  const left = Math.min(clientX, window.innerWidth - rect.width - 16);
  const top = Math.min(clientY, window.innerHeight - rect.height - 16);
  placePopover.style.left = `${Math.max(8, left)}px`;
  placePopover.style.top = `${Math.max(8, top)}px`;
}

// 게이트 위 "•" 드롭: 제어로 쓸 큐비트를 고른다. 후보가 2개 이상일 때만 열린다(1개면 호출부가 즉시 배치).
// 기존 배치 팝오버의 DOM/스타일(.place-popover-*, .qpick-row/.qpick-btn)을 그대로 재사용한다.
function openControlPopover(column, qubit, candidates, clientX, clientY) {
  closePlacePopover();
  placePopover.innerHTML = "";

  const title = document.createElement("div");
  title.className = "place-popover-title";
  title.textContent = `• → q[${qubit}]`;
  const hint = document.createElement("div");
  hint.className = "place-popover-hint";
  hint.textContent = "Select control qubit(s)";
  placePopover.append(title, hint);

  const chosen = new Set([candidates[0]]); // 첫 후보를 기본 선택(가장 흔한 단일 선택을 한 번에)
  const row = document.createElement("div");
  row.className = "qpick-row";
  let index = 0;
  const buttons = candidates.map((q, i) => {
    const btn = document.createElement("button");
    btn.className = "qpick-btn" + (chosen.has(q) ? " selected" : "");
    btn.textContent = `q[${q}]`;
    btn.tabIndex = i === 0 ? 0 : -1; // roving tabindex: 방향키로 이동, Tab은 그룹 단위
    btn.addEventListener("click", () => { focusAt(i); toggle(i); });
    row.appendChild(btn);
    return btn;
  });
  placePopover.appendChild(row);

  function focusAt(i) {
    index = i;
    buttons.forEach((b, j) => { b.tabIndex = j === i ? 0 : -1; });
    buttons[i].focus();
  }
  // 다중 선택: 후보를 토글한다(최소 1개는 선택돼 있어야 Apply 활성).
  function toggle(i) {
    const q = candidates[i];
    if (chosen.has(q)) chosen.delete(q); else chosen.add(q);
    buttons[i].classList.toggle("selected", chosen.has(q));
    applyBtn.disabled = chosen.size === 0;
  }
  // 확정: 취소 경로와 달리 여기서만 컨트롤러를 호출한다. 여러 개라도 undo 한 단계.
  function apply() {
    if (chosen.size === 0) return;
    const res = circuit.addControlToGate(column, qubit, [...chosen]);
    closePlacePopover();
    if (!res.ok) showToast(res.reason);
  }
  // 방향키로 이동, Space로 토글(버튼 기본 동작), Enter로 확정.
  row.addEventListener("keydown", (e) => {
    const back = e.key === "ArrowLeft" || e.key === "ArrowUp";
    const fwd = e.key === "ArrowRight" || e.key === "ArrowDown";
    if (back || fwd) {
      e.preventDefault();
      focusAt((index + (fwd ? 1 : buttons.length - 1)) % buttons.length);
    } else if (e.key === "Enter") {
      e.preventDefault(); // 포커스된 버튼의 click(=토글)으로 새지 않게 하고 확정으로 쓴다
      apply();
    }
  });

  const actions = document.createElement("div");
  actions.className = "place-popover-actions";
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "icon-btn";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", closePlacePopover);
  const applyBtn = document.createElement("button");
  applyBtn.className = "pill-btn-primary";
  applyBtn.textContent = "Apply";
  applyBtn.addEventListener("click", apply);
  actions.append(cancelBtn, applyBtn);
  placePopover.appendChild(actions);

  showPopoverAt(clientX, clientY);
  buttons[0].focus();
}


// 고전 비트 하나를 고르는 팝오버(조건 지정 / 측정 대상 지정 공용).
// 기존 배치 팝오버의 DOM·스타일(.qpick-row/.qpick-btn)을 그대로 재사용한다.
function openBitPopover({ title, hint, count, current, clientX, clientY, onPick, allowNone }) {
  closePlacePopover();
  placePopover.innerHTML = "";
  const t = document.createElement("div");
  t.className = "place-popover-title";
  t.textContent = title;
  const h = document.createElement("div");
  h.className = "place-popover-hint";
  h.textContent = hint;
  placePopover.append(t, h);

  const row = document.createElement("div");
  row.className = "qpick-row";
  for (let k = 0; k < count; k++) {
    const btn = document.createElement("button");
    btn.className = "qpick-btn" + (k === current ? " selected" : "");
    btn.textContent = `c[${k}]`;
    btn.addEventListener("click", () => {
      const res = onPick(k);
      closePlacePopover();
      if (res && !res.ok) showToast(res.reason);
    });
    row.appendChild(btn);
  }
  placePopover.appendChild(row);

  const actions = document.createElement("div");
  actions.className = "place-popover-actions";
  const cancel = document.createElement("button");
  cancel.className = "icon-btn";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", closePlacePopover);
  actions.appendChild(cancel);
  if (allowNone) {
    const none = document.createElement("button");
    none.className = "icon-btn";
    none.textContent = allowNone;
    none.addEventListener("click", () => {
      const res = onPick(null);
      closePlacePopover();
      if (res && !res.ok) showToast(res.reason);
    });
    actions.appendChild(none);
  }
  placePopover.appendChild(actions);
  showPopoverAt(clientX, clientY);
  row.querySelector(".qpick-btn")?.focus();
}

function openConditionPopover(column, qubit, clbitCount, clientX, clientY) {
  const snap = circuit.getSnapshot();
  const home = homeOf(snap, column, qubit);
  const current = home === -1 ? undefined : snap.grid[column][home]?.params?.cif;
  openBitPopover({
    title: "Conditional (if)",
    hint: "Apply this gate only when the bit is 1",
    count: clbitCount,
    current,
    clientX, clientY,
    allowNone: current !== undefined ? "Remove condition" : null,
    onPick: (k) => circuit.setCondition(column, qubit, k),
  });
}

function openMeasureBitPopover(column, qubit, clbitCount, clientX, clientY) {
  const snap = circuit.getSnapshot();
  const home = homeOf(snap, column, qubit);
  const current = home === -1 ? undefined : snap.grid[column][home]?.params?.cbit;
  openBitPopover({
    title: "Measure → classical bit",
    hint: "Where to write the measurement result",
    count: clbitCount,
    current,
    clientX, clientY,
    onPick: (k) => circuit.setClassicalBit(column, qubit, k),
  });
}

// 제어가 여럿일 때 어느 것을 제거할지 고른다 (컨트롤 선택 팝오버와 같은 UI).
function openRemoveControlPopover(column, controls, clientX, clientY) {
  closePlacePopover();
  placePopover.innerHTML = "";
  const title = document.createElement("div");
  title.className = "place-popover-title";
  title.textContent = "Remove control";
  const hint = document.createElement("div");
  hint.className = "place-popover-hint";
  hint.textContent = "Which control to remove?";
  placePopover.append(title, hint);

  const row = document.createElement("div");
  row.className = "qpick-row";
  controls.forEach((q) => {
    const btn = document.createElement("button");
    btn.className = "qpick-btn";
    btn.textContent = `q[${q}]`;
    btn.addEventListener("click", () => {
      circuit.removeControl(column, q);
      closePlacePopover();
    });
    row.appendChild(btn);
  });
  placePopover.appendChild(row);

  const actions = document.createElement("div");
  actions.className = "place-popover-actions";
  const cancel = document.createElement("button");
  cancel.className = "icon-btn";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", closePlacePopover);
  actions.appendChild(cancel);
  placePopover.appendChild(actions);
  showPopoverAt(clientX, clientY);
  row.querySelector(".qpick-btn")?.focus();
}

// 배치된 게이트의 파라미터 편집 — 배치 팝오버의 슬라이더를 그대로 재사용한다.
function openParamEditor(column, home, cell, clientX, clientY) {
  closePlacePopover();
  placePopover.innerHTML = "";
  const params = cell.params ?? {};
  const names = [["theta", "θ"], ["phi", "φ"], ["lambda", "λ"]].filter(([k]) => params[k] !== undefined);

  const title = document.createElement("div");
  title.className = "place-popover-title";
  title.textContent = `${standardGateName(cell)} — parameters`;
  placePopover.appendChild(title);

  const sliders = buildSliderRows(names.map(([, sym]) => sym), names.map(([k]) => radToDegRound(params[k])));

  const actions = document.createElement("div");
  actions.className = "place-popover-actions";
  const cancel = document.createElement("button");
  cancel.className = "icon-btn";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", closePlacePopover);
  const apply = document.createElement("button");
  apply.className = "pill-btn-primary";
  apply.textContent = "Apply";
  apply.addEventListener("click", () => {
    const next = { ...params };
    names.forEach(([k], i) => { next[k] = (Number(sliders[i].value) * Math.PI) / 180; });
    const res = circuit.setParams(column, home, next);
    closePlacePopover();
    if (!res.ok) showToast(res.reason);
  });
  actions.append(cancel, apply);
  placePopover.appendChild(actions);
  showPopoverAt(clientX, clientY);
}
