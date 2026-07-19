// 큐비트(행) x 칼럼(열) 그리드 회로 컨트롤러. 상태 계산, 스텝 재생, localStorage 지속성.
// 다중 큐비트 게이트는 타겟 큐비트 셀에만 placement를 저장하고,
// controls/partner 필드로 관여하는 다른 큐비트를 기록한다.
import {
  initialState,
  applyGate,
  applyUnitary,
  applySwap,
  applyRXX,
  applyRZZ,
  applyReset,
  uMatrix,
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

function emptyGrid(qubitCount) {
  return Array.from({ length: MAX_COLUMNS }, () => new Array(qubitCount).fill(null));
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

// placement가 관여하는 모든 큐비트 (타겟 + 컨트롤 + 파트너)
export function involvedQubits(cell, targetQubit) {
  const qubits = [targetQubit];
  if (Array.isArray(cell.controls)) qubits.push(...cell.controls);
  if (typeof cell.partner === "number") qubits.push(cell.partner);
  return qubits;
}

function isValidPlacement(cell, targetQubit, qubitCount) {
  const info = GATE_INFO[cell.gate];
  if (!info || !info.ready) return false;
  const qubits = involvedQubits(cell, targetQubit);
  if (new Set(qubits).size !== qubits.length) return false;
  if (qubits.some((q) => q < 0 || q >= qubitCount)) return false;
  if (info.kind === "controlled" && (cell.controls?.length ?? 0) !== info.controls) return false;
  if ((info.kind === "swap" || info.kind === "pair-param") && typeof cell.partner !== "number") return false;
  return true;
}

// onChange(snapshot), onAnimateStep(fromBloch, toBloch) => Promise<void>
// initial: 공유 URL에서 디코딩한 {qubitCount, grid} — 있으면 localStorage보다 우선.
export function createCircuitController({ onChange, onAnimateStep, initial }) {
  let qubitCount = DEFAULT_QUBITS;
  let grid = emptyGrid(qubitCount);

  const stored = initial ?? loadStored();
  if (stored) {
    qubitCount = stored.qubitCount;
    grid = emptyGrid(qubitCount);
    for (let col = 0; col < Math.min(MAX_COLUMNS, stored.grid.length); col++) {
      for (let q = 0; q < qubitCount; q++) {
        const cell = stored.grid[col]?.[q];
        if (cell && isValidPlacement(cell, q, qubitCount)) grid[col][q] = cell;
      }
    }
  }

  // 칼럼 안에서 q를 점유 중인 placement의 타겟 큐비트를 찾는다 (없으면 -1)
  function occupantTarget(column, q) {
    for (let t = 0; t < qubitCount; t++) {
      const cell = grid[column][t];
      if (cell && involvedQubits(cell, t).includes(q)) return t;
    }
    return -1;
  }

  let selectedQubit = 0;
  let stepIndex = usedColumnCount(grid);
  let isPlaying = false;
  let isAnimating = false;

  function stateAt(step) {
    let state = initialState(qubitCount);
    for (let col = 0; col < step; col++) {
      // 칼럼의 CTRL 점은 같은 칼럼의 단일 타겟 게이트들에 컨트롤로 부여된다.
      const dotControls = [];
      for (let q = 0; q < qubitCount; q++) {
        if (grid[col][q]?.gate === "CTRL") dotControls.push(q);
      }
      for (let q = 0; q < qubitCount; q++) {
        const cell = grid[col][q];
        if (!cell) continue;
        const info = GATE_INFO[cell.gate];
        switch (info.kind) {
          case "fixed":
          case "param":
            state = applyGate(state, cell.gate, q, { theta: cell.theta, controlQubits: dotControls });
            break;
          case "param3":
            state = applyUnitary(state, q, uMatrix(cell.theta, cell.phi, cell.lambda), dotControls);
            break;
          case "controlled":
            state = applyGate(state, info.base, q, {
              controlQubits: [...cell.controls, ...dotControls],
            });
            break;
          case "swap":
            state = applySwap(state, q, cell.partner);
            break;
          case "pair-param":
            state = cell.gate === "RXX"
              ? applyRXX(state, q, cell.partner, cell.theta)
              : applyRZZ(state, q, cell.partner, cell.theta);
            break;
          case "reset":
            state = applyReset(state, q);
            break;
          case "dot":
          case "noop":
            break;
        }
      }
    }
    return state;
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

  // params: { theta?, phi?, lambda?, controls?, partner? }
  function placeGate(column, qubit, gateName, params = {}) {
    if (isAnimating || isPlaying) return;
    if (column < 0 || column >= MAX_COLUMNS) return;
    const cell = { gate: gateName };
    if (params.theta !== undefined) cell.theta = params.theta;
    if (params.phi !== undefined) cell.phi = params.phi;
    if (params.lambda !== undefined) cell.lambda = params.lambda;
    if (params.controls !== undefined) cell.controls = params.controls;
    if (params.partner !== undefined) cell.partner = params.partner;
    if (!isValidPlacement(cell, qubit, qubitCount)) return;
    // 관여하는 모든 큐비트 자리가 비어 있어야 배치 가능 (자기 자신이 점유 중이면 교체)
    for (const q of involvedQubits(cell, qubit)) {
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
        // 컨트롤/파트너가 삭제된 큐비트를 가리키는 placement는 함께 제거
        if (cell && isValidPlacement(cell, q, next)) newGrid[col][q] = cell;
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
