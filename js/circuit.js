// 큐비트(행) x 칼럼(열) 그리드 회로 컨트롤러. 상태 계산, 스텝 재생, localStorage 지속성.
//
// 정규(canonical) placement 셀:  { gate, targets:number[], controls:number[], params:{} }
//   - CNOT  = { gate:"X", targets:[t], controls:[c] }
//   - CCX   = { gate:"X", targets:[t], controls:[c0,c1] }
//   - CZ    = { gate:"Z", targets:[t], controls:[c] }
//   - CSWAP = { gate:"SWAP", targets:[a,b], controls:[c] }
// 셀은 홈 행 = targets[0] 위치(grid[col][targets[0]])에만 저장하고, 나머지 관여 큐비트는
// targets/controls 필드로 기록한다. 컨트롤은 임의 개수를 가질 수 있다.
import {
  initialState,
  applyPlacement,
  qubitBlochVector,
  basisProbabilities,
  densityMatrix,
  GATE_INFO,
} from "./quantum.js";

export const MIN_QUBITS = 2;
export const MAX_QUBITS = 6;
export const DEFAULT_QUBITS = 4;
export const MAX_COLUMNS = 12;

const STORAGE_KEY = "bloch-composer-v1";

// 타깃 2개를 갖는 게이트, 컨트롤을 붙일 수 없는 게이트 [4]
const TWO_TARGET = new Set(["SWAP", "RXX", "RZZ"]);
const NON_CONTROLLABLE = new Set(["MEASURE", "RESET", "BARRIER", "CTRL"]);

function emptyGrid(qubitCount) {
  return Array.from({ length: MAX_COLUMNS }, () => new Array(qubitCount).fill(null));
}

// placement가 관여하는 모든 큐비트 (targets ∪ controls)
export function involvedQubits(cell) {
  return [...(cell.targets ?? []), ...(cell.controls ?? [])];
}

// 구버전 셀({gate:"CNOT", controls, partner, theta,...}) → canonical. 이미 canonical이면 정규화만.
// homeRow: 그 셀이 저장돼 있던 행(구버전은 타깃 행).
export function migrateCell(cell, homeRow) {
  if (Array.isArray(cell.targets)) {
    return {
      gate: cell.gate,
      targets: cell.targets.slice(),
      controls: (cell.controls ?? []).slice(),
      params: { ...(cell.params ?? {}) },
    };
  }
  const params = {};
  if (cell.theta !== undefined) params.theta = cell.theta;
  if (cell.phi !== undefined) params.phi = cell.phi;
  if (cell.lambda !== undefined) params.lambda = cell.lambda;

  const info = GATE_INFO[cell.gate];
  if (!info) return { gate: cell.gate, targets: [homeRow], controls: [], params };

  switch (info.kind) {
    case "controlled": // CNOT/CCX/CZ/RCCX/RC3X → base(X/Z) + controls
      return { gate: info.base, targets: [homeRow], controls: (cell.controls ?? []).slice(), params: {} };
    case "swap":
      return { gate: "SWAP", targets: [homeRow, cell.partner], controls: [], params: {} };
    case "pair-param": // RXX/RZZ
      return { gate: cell.gate, targets: [homeRow, cell.partner], controls: [], params };
    default: // fixed / param / param3 / dot / reset / noop
      return { gate: cell.gate, targets: [homeRow], controls: [], params };
  }
}

function isValidPlacement(cell, qubitCount) {
  const info = GATE_INFO[cell.gate];
  if (!info || !info.ready) return false;
  const targets = cell.targets ?? [];
  const controls = cell.controls ?? [];
  if (targets.length === 0) return false;
  const all = [...targets, ...controls];
  if (new Set(all).size !== all.length) return false;
  if (all.some((q) => q < 0 || q >= qubitCount)) return false;
  if (NON_CONTROLLABLE.has(cell.gate) && controls.length > 0) return false; // [4]
  if (TWO_TARGET.has(cell.gate) ? targets.length !== 2 : targets.length !== 1) return false;
  return true;
}

// 순수 시뮬레이션: 그리드의 처음 `steps` 칼럼을 적용한 상태벡터를 반환한다.
// 칼럼 CTRL(•) 점은 같은 칼럼 게이트들에 추가 컨트롤로 부여된다.
export function simulate(qubitCount, grid, steps) {
  const limit = steps === undefined ? usedColumnCount(grid) : steps;
  let state = initialState(qubitCount);
  for (let col = 0; col < limit; col++) {
    const dotControls = [];
    for (let q = 0; q < qubitCount; q++) {
      if (grid[col][q]?.gate === "CTRL") dotControls.push(q);
    }
    for (let q = 0; q < qubitCount; q++) {
      const cell = grid[col][q];
      if (!cell || cell.gate === "CTRL") continue;
      state = applyPlacement(state, cell, dotControls);
    }
  }
  return state;
}

function loadStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.qubitCount !== "number" || !Array.isArray(parsed.grid)) return null;
    if (parsed.qubitCount < MIN_QUBITS || parsed.qubitCount > MAX_QUBITS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function save(qubitCount, grid) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ qubitCount, grid }));
  } catch {
    // localStorage 사용 불가 - 무시
  }
}

function usedColumnCount(grid) {
  for (let col = MAX_COLUMNS - 1; col >= 0; col--) {
    if (grid[col].some((cell) => cell)) return col + 1;
  }
  return 0;
}

// onChange(snapshot), onAnimateStep(fromBloch, toBloch) => Promise<void>
// initial: 공유 URL에서 디코딩한 {qubitCount, grid}(이미 canonical) — 있으면 localStorage보다 우선.
export function createCircuitController({ onChange, onAnimateStep, initial }) {
  let qubitCount = DEFAULT_QUBITS;
  let grid = emptyGrid(qubitCount);

  const stored = initial ?? loadStored();
  if (stored) {
    qubitCount = stored.qubitCount;
    grid = emptyGrid(qubitCount);
    for (let col = 0; col < Math.min(MAX_COLUMNS, stored.grid.length); col++) {
      for (let q = 0; q < qubitCount; q++) {
        const raw = stored.grid[col]?.[q];
        if (!raw) continue;
        const cell = migrateCell(raw, q); // 구버전 셀도 canonical로 변환
        if (isValidPlacement(cell, qubitCount)) grid[col][cell.targets[0]] = cell;
      }
    }
  }

  // 칼럼 안에서 q를 점유 중인 placement의 홈(타깃) 행을 찾는다 (없으면 -1)
  function occupantTarget(column, q) {
    for (let t = 0; t < qubitCount; t++) {
      const cell = grid[column][t];
      if (cell && involvedQubits(cell).includes(q)) return t;
    }
    return -1;
  }

  let selectedQubit = 0;
  let stepIndex = usedColumnCount(grid);
  let isPlaying = false;
  let isAnimating = false;

  function stateAt(step) {
    return simulate(qubitCount, grid, step);
  }

  function snapshot() {
    const totalSteps = usedColumnCount(grid);
    const state = stateAt(stepIndex);
    return {
      qubitCount,
      grid,
      selectedQubit,
      stepIndex,
      totalSteps,
      isPlaying,
      isAnimating,
      canAddQubit: qubitCount < MAX_QUBITS,
      canRemoveQubit: qubitCount > MIN_QUBITS,
      bloch: qubitBlochVector(state, selectedQubit),
      probabilities: basisProbabilities(state, qubitCount),
      densityMatrix: densityMatrix(state),
    };
  }

  function notify() {
    save(qubitCount, grid);
    onChange(snapshot());
  }

  // UI는 팔레트 게이트명(CNOT/CCX/CZ/SWAP/RXX/…) + params(controls/partner/theta…)를 그대로 넘긴다.
  // 여기서 canonical 셀로 변환해 저장한다(홈 = targets[0] = qubit).
  function placeGate(column, qubit, gateName, params = {}) {
    if (isAnimating || isPlaying) return;
    if (column < 0 || column >= MAX_COLUMNS) return;
    const uiCell = { gate: gateName };
    if (params.theta !== undefined) uiCell.theta = params.theta;
    if (params.phi !== undefined) uiCell.phi = params.phi;
    if (params.lambda !== undefined) uiCell.lambda = params.lambda;
    if (params.controls !== undefined) uiCell.controls = params.controls;
    if (params.partner !== undefined) uiCell.partner = params.partner;
    const cell = migrateCell(uiCell, qubit);
    if (!isValidPlacement(cell, qubitCount)) return;
    // 관여하는 모든 큐비트 자리가 비어 있어야 배치 가능 (자기 자신이 점유 중이면 교체)
    for (const q of involvedQubits(cell)) {
      const occupant = occupantTarget(column, q);
      if (occupant !== -1 && occupant !== qubit) return;
    }
    grid[column][qubit] = cell;
    stepIndex = usedColumnCount(grid);
    notify();
  }

  function removeGate(column, qubit) {
    if (isAnimating || isPlaying) return;
    if (!grid[column]) return;
    const target = occupantTarget(column, qubit);
    if (target === -1) return;
    grid[column][target] = null;
    stepIndex = Math.min(stepIndex, usedColumnCount(grid));
    notify();
  }

  // "•" 부착: controlQubit을 같은 칼럼의 (가장 가까운) 게이트 controls 배열에 추가한다.
  // 시뮬레이션 코드는 건드리지 않고 데이터 모델(controls)만 수정한다.
  // 반환: { ok, reason } — 실패 시 이유를 UI 툴팁으로 표시할 수 있게 한다.
  function addControl(column, controlQubit) {
    if (isAnimating || isPlaying) return { ok: false, reason: "Busy" };
    if (column < 0 || column >= MAX_COLUMNS) return { ok: false, reason: "Invalid column" };
    if (occupantTarget(column, controlQubit) !== -1) return { ok: false, reason: "Cell already occupied" };
    const homes = [];
    for (let t = 0; t < qubitCount; t++) {
      if (grid[column][t] && grid[column][t].gate !== "CTRL") homes.push(t);
    }
    if (homes.length === 0) return { ok: false, reason: "No gate in this column to control" };
    homes.sort((a, b) => Math.abs(a - controlQubit) - Math.abs(b - controlQubit));
    const home = homes[0];
    const cell = grid[column][home];
    if (NON_CONTROLLABLE.has(cell.gate)) return { ok: false, reason: `${cell.gate} cannot be controlled` };
    const newCell = { ...cell, controls: [...cell.controls, controlQubit] };
    if (!isValidPlacement(newCell, qubitCount)) return { ok: false, reason: "Invalid placement" };
    grid[column][home] = newCell;
    stepIndex = usedColumnCount(grid);
    notify();
    return { ok: true };
  }

  // 제어점 제거: controlQubit이 어떤 게이트의 controls면 그 항목만 뺀다.
  // 반환: 제거했으면 true (클릭이 제어점이었음), 아니면 false.
  function removeControl(column, controlQubit) {
    if (isAnimating || isPlaying) return false;
    if (!grid[column]) return false;
    for (let t = 0; t < qubitCount; t++) {
      const cell = grid[column][t];
      if (cell && (cell.controls ?? []).includes(controlQubit)) {
        grid[column][t] = { ...cell, controls: cell.controls.filter((c) => c !== controlQubit) };
        stepIndex = Math.min(stepIndex, usedColumnCount(grid));
        notify();
        return true;
      }
    }
    return false;
  }

  function clear() {
    if (isAnimating || isPlaying) return;
    grid = emptyGrid(qubitCount);
    stepIndex = 0;
    notify();
  }

  function setQubitCount(next) {
    if (isAnimating || isPlaying) return;
    if (next < MIN_QUBITS || next > MAX_QUBITS || next === qubitCount) return;
    const newGrid = emptyGrid(next);
    for (let col = 0; col < MAX_COLUMNS; col++) {
      for (let q = 0; q < Math.min(qubitCount, next); q++) {
        const cell = grid[col][q];
        // 컨트롤/타깃이 삭제된 큐비트를 가리키는 placement는 함께 제거
        if (cell && isValidPlacement(cell, next)) newGrid[col][q] = cell;
      }
    }
    qubitCount = next;
    grid = newGrid;
    if (selectedQubit >= qubitCount) selectedQubit = qubitCount - 1;
    stepIndex = Math.min(stepIndex, usedColumnCount(grid));
    notify();
  }

  function selectQubit(q) {
    if (isAnimating || isPlaying) return;
    if (q < 0 || q >= qubitCount || q === selectedQubit) return;
    selectedQubit = q;
    notify();
  }

  function reset() {
    if (isAnimating || isPlaying) return;
    stepIndex = 0;
    notify();
  }

  async function stepForward() {
    const totalSteps = usedColumnCount(grid);
    if (isAnimating || isPlaying || stepIndex >= totalSteps) return;
    isAnimating = true;
    notify();
    const from = qubitBlochVector(stateAt(stepIndex), selectedQubit);
    const to = qubitBlochVector(stateAt(stepIndex + 1), selectedQubit);
    await onAnimateStep(from, to);
    stepIndex += 1;
    isAnimating = false;
    notify();
  }

  async function stepBackward() {
    if (isAnimating || isPlaying || stepIndex <= 0) return;
    isAnimating = true;
    notify();
    const from = qubitBlochVector(stateAt(stepIndex), selectedQubit);
    const to = qubitBlochVector(stateAt(stepIndex - 1), selectedQubit);
    await onAnimateStep(from, to);
    stepIndex -= 1;
    isAnimating = false;
    notify();
  }

  async function play() {
    const totalSteps = usedColumnCount(grid);
    if (isAnimating || isPlaying || totalSteps === 0) return;
    if (stepIndex >= totalSteps) stepIndex = 0;
    isPlaying = true;
    notify();
    while (stepIndex < totalSteps) {
      if (!isPlaying) break;
      isAnimating = true;
      notify();
      const from = qubitBlochVector(stateAt(stepIndex), selectedQubit);
      const to = qubitBlochVector(stateAt(stepIndex + 1), selectedQubit);
      await onAnimateStep(from, to);
      stepIndex += 1;
      isAnimating = false;
      notify();
    }
    isPlaying = false;
    notify();
  }

  function pause() {
    isPlaying = false;
  }

  notify();

  return {
    MIN_QUBITS,
    MAX_QUBITS,
    MAX_COLUMNS,
    getSnapshot: snapshot,
    placeGate,
    removeGate,
    addControl,
    removeControl,
    clear,
    setQubitCount,
    selectQubit,
    reset,
    stepForward,
    stepBackward,
    play,
    pause,
  };
}
