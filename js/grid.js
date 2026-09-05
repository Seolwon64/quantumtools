// 회로 그리드 DOM. 셀·연결선·고전선·스텝 인디케이터를 실측 좌표로 그리고, 드롭·클릭을 받는다.
//
// **컨트롤러보다 먼저** 초기화한다 — render 가 buildCircuitGrid 를 부르고, 그 render 는
// createCircuitController 안의 notify() 에서 이미 한 번 돈다. 그래서 circuit 은 값이
// 아니라 getCircuit getter 로 받는다.
// **initPlayback 보다는 뒤**다 — 그리드를 다시 지을 때마다 attachIndicator 로 새 인디케이터를
// 등록해야 하고, stepIndicatorX 로 그 위치를 정하기 때문이다(분해 계획서 위험 6번).
// 팝오버 셋은 컨트롤러 **뒤**에 배선되므로 진입점이 화살표로 감싸 넘긴다(값이면 TDZ).
import { GATE_INFO } from "./quantum.js";
import { MAX_COLUMNS, involvedQubits } from "./circuit.js";

// 주입되는 의존. initGrid 전에는 undefined 다.
let getCircuit, scene, circuitGrid;
let GATE_CATEGORY, MEASURE_SVG, showTransientTip, attachGateHover;
let attachIndicator, stepIndicatorX, openMenuForCell, clearSelection;
// 팝오버 셋은 옮긴 블록이 이 이름 그대로 부르므로 같은 이름의 모듈 변수로 받는다.
let openPlacePopover, openControlPopover, openConditionPopover;

/**
 * 의존을 주입하고 공개 API 를 돌려준다. **컨트롤러를 만들기 전에, initPlayback 뒤에** 부른다.
 *
 * 매개변수를 죄다 개명한 것은 취향이 아니다 — 최상위 let 과 같은 이름을 쓰면 매개변수가
 * 그것을 가려 모듈 변수가 영원히 undefined 로 남는다(4단계 chartTooltip).
 * check-shadowing.mjs 는 매개변수를 보지 않으므로 이 규칙은 사람이 지킨다.
 * e·cell·column·qubit·gateName·info·snapshot·snap·res·opt 도 피한다 — 아래로 옮겨 온
 * 리스너 다섯이 그 이름들로 지역 변수를 선언한다.
 */
export function initGrid({ getCircuit: gc, scene: sc, gateCategory: gcat,
    measureSvg: msvg, showTransientTip: transTip, attachGateHover: gateHover,
    attachIndicator: attachInd, stepIndicatorX: stepX,
    openMenuForCell: menuForCell, clearSelection: clearSel, popover, els }) {
  getCircuit = gc;
  scene = sc;
  GATE_CATEGORY = gcat;
  MEASURE_SVG = msvg;
  showTransientTip = transTip;
  attachGateHover = gateHover;
  attachIndicator = attachInd;
  stepIndicatorX = stepX;
  openMenuForCell = menuForCell;
  clearSelection = clearSel;
  circuitGrid = els.circuitGrid;
  ({ openPlacePopover, openControlPopover, openConditionPopover } = popover);

  circuitGrid.addEventListener("dragover", (e) => {
    const cell = e.target.closest(".grid-cell");
    if (!cell) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    cell.classList.add("drag-over");
  });

  circuitGrid.addEventListener("dragleave", (e) => {
    const cell = e.target.closest(".grid-cell");
    if (cell) cell.classList.remove("drag-over");
  });

  circuitGrid.addEventListener("drop", (e) => {
    const cell = e.target.closest(".grid-cell");
    if (!cell) return;
    e.preventDefault();
    cell.classList.remove("drag-over");
    const gateName = e.dataTransfer.getData("text/plain");
    const info = GATE_INFO[gateName];
    if (!info || info.ready === false) return;
    const snapshot = getCircuit().getSnapshot();
    if (snapshot.qubitCount < (info.minQubits ?? 1)) return;
    const column = Number(cell.dataset.col);
    const qubit = Number(cell.dataset.qubit);

    // "•"(Control) 드롭. 두 경로 모두 컨트롤러의 같은 부착 로직을 거쳐 동일한 셀을 만든다:
    //  - 게이트가 있는 셀 위 → 그 게이트를 제어형으로 변환(제어 큐비트는 빈 와이어에 자동 배치)
    //  - 빈 셀 → 같은 열의 최근접 게이트에 그 큐비트를 제어로 부착(기존 경로)
    if (gateName === "CTRL") {
      scene.clearTrail();
      if (!cell.dataset.role) { // 빈 칸: 같은 열의 최근접 게이트에 부착(기존 경로)
        const res = getCircuit().addControl(column, qubit);
        if (!res.ok) showTransientTip(cell, res.reason);
        return;
      }
      const opt = getCircuit().controlOptions(column, qubit);
      if (!opt.ok) { showTransientTip(cell, opt.reason); return; } // 팝오버를 띄우기 전에 거부
      if (opt.candidates.length === 1) { // 선택지가 없는 선택은 불필요한 클릭 → 즉시 배치
        const res = getCircuit().addControlToGate(column, qubit, opt.candidates[0]);
        if (!res.ok) showTransientTip(cell, res.reason);
        return;
      }
      openControlPopover(column, qubit, opt.candidates, e.clientX, e.clientY);
      return;
    }

    // "if" 드롭: 이미 놓인 게이트에 고전 조건(c[k]==1)을 붙인다. •와 같은 조작 방식.
    if (gateName === "IF") {
      if (!cell.dataset.role) { showTransientTip(cell, "Drop “if” on a gate to make it conditional"); return; }
      const snap = getCircuit().getSnapshot();
      if (snap.clbitCount === 0) { showTransientTip(cell, "There are no classical bits — add one first"); return; }
      openConditionPopover(column, qubit, snap.clbitCount, e.clientX, e.clientY);
      return;
    }

    const needsPopover =
      info.kind === "param" || info.kind === "param3" ||
      info.kind === "controlled" || info.kind === "swap" || info.kind === "pair-param" ||
      info.kind === "decomposed" || info.kind === "cswap";
    if (needsPopover) {
      openPlacePopover(column, qubit, gateName, e.clientX, e.clientY, snapshot.qubitCount);
    } else {
      scene.clearTrail();
      getCircuit().placeGate(column, qubit, gateName, {});
    }
  });

  // [1] 게이트 좌클릭 → 컨텍스트 메뉴(우클릭과 동일). 게이트는 삭제되지 않고 정보 패널도
  // 자동으로 뜨지 않는다 — 정보는 메뉴의 "Show info"로만 연다.
  // 제어점(•) 클릭은 기존대로 그 제어만 제거한다.
  circuitGrid.addEventListener("click", (e) => {
    const cell = e.target.closest(".grid-cell");
    if (!cell) return;
    const column = Number(cell.dataset.col);
    const qubit = Number(cell.dataset.qubit);
    scene.clearTrail();
    if (cell.dataset.role === "control") {
      getCircuit().removeControl(column, qubit);
      return;
    }
    if (cell.dataset.role) {
      e.stopPropagation(); // 이 클릭이 document로 가면 방금 연 메뉴가 바로 닫힌다
      openMenuForCell(column, qubit, e.clientX, e.clientY);
    } else {
      clearSelection();
    }
  });

  // 우클릭도 계속 동작한다
  circuitGrid.addEventListener("contextmenu", (e) => {
    const cell = e.target.closest(".grid-cell");
    if (!cell || !cell.dataset.role) return; // 빈 칸은 브라우저 기본 메뉴를 그대로 둔다
    e.preventDefault();
    openMenuForCell(Number(cell.dataset.col), Number(cell.dataset.qubit), e.clientX, e.clientY);
  });

  return { buildCircuitGrid };
}

// buildCircuitGrid 에는 export 를 붙이지 않는다. 공개 경로가 둘이면 initGrid 전에 직접
// import 해서 부를 수 있고, 그때 주입 의존은 전부 undefined 다.

// 격자 좌표는 **CSS를 베껴 쓰지 않고 DOM에서 실측한다.**
// 예전에는 GRID_PAD_LEFT/ROW_PITCH 같은 상수로 CSS 치수를 손으로 옮겨 적었는데,
// 간격 시스템 도입(ab4683a)이 padding 2→4px, gap 6→8px로 바꾸면서 상수만 낡아
// **연결선이 게이트 중심에서 가로 2px, 행마다 세로 2px씩 어긋났다.**
// 아래 두 함수가 유일한 좌표 출처다 — 연결선·제어점·⊕·×·고전선·배지·스텝 인디케이터가
// 전부 여기서 나오므로 CSS를 어떻게 바꿔도 다시 어긋날 수 없다.

/** .circuit-grid 기준으로 요소의 중심 좌표. 정수로 스냅해 1~2px 선이 번지지 않게 한다. */
function gridCenter(el, gridRect) {
  const r = el.getBoundingClientRect();
  return {
    x: Math.round(r.left - gridRect.left + r.width / 2),
    y: Math.round(r.top - gridRect.top + r.height / 2),
  };
}

/** (col, row)의 셀 요소. row는 큐비트 인덱스이며, 고전 행은 clbit-row에서 찾는다. */
function cellAt(col, row, qubitCount) {
  if (row < qubitCount) {
    return circuitGrid.querySelector(`.grid-cell[data-col="${col}"][data-qubit="${row}"]`);
  }
  return circuitGrid.querySelector(`.clbit-row .grid-cell[data-col="${col}"]`);
}

// ---------- 회로 그리드 ----------

function buildCircuitGrid(snapshot) {
  circuitGrid.innerHTML = "";

  // 칼럼별 역할 맵: qubit -> { type: "target"|"control", cell, primary }
  // canonical 셀은 홈 행(targets[0])에만 저장되며, 관여 큐비트는 targets/controls로 표시.
  const roleMaps = [];
  for (let col = 0; col < MAX_COLUMNS; col++) {
    const roles = new Map();
    for (let t = 0; t < snapshot.qubitCount; t++) {
      const cell = snapshot.grid[col]?.[t];
      if (!cell) continue;
      const decomposed = GATE_INFO[cell.gate]?.kind === "decomposed";
      cell.targets.forEach((tq, i) => {
        // RCCX/RC3X: targets의 마지막 = ⊕ 타깃, 앞쪽 = 컨트롤 점으로 그린다.
        if (decomposed && i < cell.targets.length - 1) {
          roles.set(tq, { type: "control", cell, primary: false });
        } else {
          roles.set(tq, { type: "target", cell, primary: decomposed || i === 0 });
        }
      });
      for (const q of cell.controls ?? []) roles.set(q, { type: "control", cell, primary: false });
    }
    roleMaps.push(roles);
  }

  for (let q = 0; q < snapshot.qubitCount; q++) {
    const row = document.createElement("div");
    row.className = "qubit-row";

    const label = document.createElement("span");
    label.className = "qubit-label";
    label.textContent = `q[${q}]`;
    row.appendChild(label);

    const wire = document.createElement("div");
    wire.className = "qubit-wire";
    for (let col = 0; col < MAX_COLUMNS; col++) {
      const cell = document.createElement("div");
      cell.className = "grid-cell";
      cell.dataset.col = String(col);
      cell.dataset.qubit = String(q);

      const role = roleMaps[col].get(q);
      if (role) {
        const info = GATE_INFO[role.cell.gate];
        // controlled-Z는 CZ 표준 표기(•—•)라 타깃도 채운 점으로 그린다.
        const controlledZ = role.cell.gate === "Z" && (role.cell.controls?.length ?? 0) > 0;
        // 셀의 역할을 DOM에 기록: 드롭 분기(게이트 위 vs 빈 칸)와 제어점 드래그가 참조한다.
        cell.dataset.role = role.type;
        if (role.type === "control" || (role.type === "target" && controlledZ)) {
          const dot = document.createElement("div");
          dot.className = "ctrl-dot";
          attachGateHover(dot, role.cell);
          cell.appendChild(dot);
        } else {
          const chip = document.createElement("div");
          chip.className = `placed-gate cat-${GATE_CATEGORY[role.cell.gate] ?? "structural"}`;
          if (info?.kind === "decomposed") chip.classList.add("placed-advanced"); // RCCX/RC3X 시각 구분
          if (role.cell.gate === "MEASURE") {
            chip.innerHTML = MEASURE_SVG;
          } else {
            const label = role.cell.gate === "SWAP" ? "×" : (info.targetLabel ?? info.label);
            chip.textContent = label;
            // ⊕(CNOT/Toffoli 타깃)·×(SWAP)는 박스가 아니라 와이어 위 기호 → 배경 없이 그려
            // 아래 레이어의 연결선이 기호 중심까지 이어져 보이게 한다([1] 표준 표기).
            if (label === "⊕" || label === "×") chip.classList.add("placed-symbol");
          }
          attachGateHover(chip, role.cell);
          cell.appendChild(chip);
        }
      }
      wire.appendChild(cell);
    }
    row.appendChild(wire);
    circuitGrid.appendChild(row);
  }

  // 고전 레지스터 와이어(이중선). 고전 비트가 0개면 아예 그리지 않는다.
  const clRow = snapshot.qubitCount; // 큐비트 행들 바로 아래
  if (snapshot.clbitCount > 0) {
    const row = document.createElement("div");
    row.className = "qubit-row clbit-row";
    const label = document.createElement("span");
    label.className = "qubit-label clbit-label";
    label.textContent = `c / ${snapshot.clbitCount}`; // IBM Composer식 묶음 표기
    label.title = `Classical register: ${snapshot.clbitCount} bit(s)`;
    row.appendChild(label);
    const wire = document.createElement("div");
    wire.className = "qubit-wire clbit-wire";
    for (let col = 0; col < MAX_COLUMNS; col++) {
      const cell = document.createElement("div");
      cell.className = "grid-cell";
      cell.dataset.col = String(col); // 고전선·배지도 큐비트 행과 같은 방식으로 좌표를 실측한다
      wire.appendChild(cell);
    }
    row.appendChild(wire);
    circuitGrid.appendChild(row);
  }

  // 여기서부터는 실제 배치된 셀을 측정한다. 위 루프가 모든 행을 append한 뒤이므로
  // 레이아웃이 확정돼 있다. gridRect는 한 번만 읽어 강제 리플로를 1회로 묶는다.
  const gridRect = circuitGrid.getBoundingClientRect();

  // 다중 큐비트 게이트의 세로 연결선.
  // x는 **게이트가 놓인 셀의 실제 중심**이다 — 블록·제어점과 같은 요소에서 나온 값이라
  // 정의상 어긋날 수 없다(예전엔 상수로 따로 계산해 2px 틀어졌다).
  for (let col = 0; col < MAX_COLUMNS; col++) {
    for (let t = 0; t < snapshot.qubitCount; t++) {
      const cell = snapshot.grid[col]?.[t];
      if (!cell) continue;
      const qubits = involvedQubits(cell);
      if (qubits.length < 2) continue;
      const minQ = Math.min(...qubits);
      const maxQ = Math.max(...qubits);
      const topCell = cellAt(col, minQ, snapshot.qubitCount);
      const botCell = cellAt(col, maxQ, snapshot.qubitCount);
      if (!topCell || !botCell) continue;
      const a = gridCenter(topCell, gridRect);
      const b = gridCenter(botCell, gridRect);
      const line = document.createElement("div");
      line.className = "gate-connector";
      line.style.left = `${a.x - 1}px`; // 폭 2px(짝수)이라 정수 좌표에서 이미 선명하다
      line.style.top = `${a.y}px`;
      line.style.height = `${b.y - a.y}px`;
      circuitGrid.appendChild(line);
    }
  }

  // 고전 와이어로 가는 이중선: Measure의 기록(cbit) / 조건부 연산의 조건(cif).
  // 한 열에 여러 개가 내려올 수 있으므로(예: 텔레포테이션의 두 측정) 좌우로 벌려 겹치지 않게 한다.
  if (snapshot.clbitCount > 0) {
    const clAnchor = cellAt(0, clRow, snapshot.qubitCount);
    const clY = clAnchor ? gridCenter(clAnchor, gridRect).y : 0;
    for (let col = 0; col < MAX_COLUMNS; col++) {
      const links = [];
      for (let t = 0; t < snapshot.qubitCount; t++) {
        const cell = snapshot.grid[col]?.[t];
        if (!cell) continue;
        const p = cell.params ?? {};
        const bit = cell.gate === "MEASURE" ? p.cbit : p.cif;
        if (bit === undefined) continue;
        const isMeasure = cell.gate === "MEASURE";
        const fromQ = isMeasure ? cell.targets[0] : Math.max(...involvedQubits(cell));
        links.push({ bit, isMeasure, fromQ });
      }
      if (!links.length) continue;
      const colAnchor = cellAt(col, 0, snapshot.qubitCount);
      if (!colAnchor) continue;
      const baseX = gridCenter(colAnchor, gridRect).x;
      links.forEach((l, i) => {
        const x = Math.round(baseX + (i - (links.length - 1) / 2) * 15); // 여러 개면 나란히
        const fromCell = cellAt(col, l.fromQ, snapshot.qubitCount);
        if (!fromCell) return;
        const top = gridCenter(fromCell, gridRect).y;
        const link = document.createElement("div");
        link.className = "cl-connector";
        link.style.left = `${x - 2}px`; // 폭 4px(짝수)
        link.style.top = `${top}px`;
        link.style.height = `${clY - top}px`;
        circuitGrid.appendChild(link);
        const badge = document.createElement("div");
        badge.className = "cl-bit-badge" + (l.isMeasure ? "" : " cl-bit-cond");
        badge.textContent = String(l.bit);
        badge.style.left = `${x}px`;
        badge.style.top = `${clY}px`;
        badge.title = l.isMeasure
          ? `Measurement result is written to c[${l.bit}]`
          : `Applied only when c[${l.bit}] is 1`;
        circuitGrid.appendChild(badge);
      });
    }
  }

  // [5] 스텝 인디케이터(현재 재생 위치). innerHTML 재구성으로 매번 새로 만들고 현재 스텝에 둔다.
  const ind = document.createElement("div");
  ind.className = "step-indicator";
  // 인디케이터는 첫 행 위에서 마지막 큐비트 행 아래까지 걸친다 — 행 높이도 실측한다.
  const firstCell = cellAt(0, 0, snapshot.qubitCount);
  const lastCell = cellAt(0, Math.max(0, snapshot.qubitCount - 1), snapshot.qubitCount);
  const indH =
    firstCell && lastCell
      ? gridCenter(lastCell, gridRect).y - gridCenter(firstCell, gridRect).y + firstCell.offsetHeight
      : 0;
  ind.style.height = `${Math.max(0, indH - 8)}px`;
  ind.style.transform = `translateX(${stepIndicatorX(snapshot.stepIndex)}px)`;
  ind.classList.toggle("hidden", snapshot.totalSteps === 0);
  circuitGrid.appendChild(ind);
  attachIndicator(ind);
}
