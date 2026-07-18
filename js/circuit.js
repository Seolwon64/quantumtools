// 큐비트(행) x 칼럼(열) 그리드 회로 컨트롤러. 상태 계산, 스텝 재생, localStorage 지속성.
import { initialState, applyGate, qubitBlochVector, basisProbabilities, GATE_INFO } from "./quantum.js";

export const MIN_QUBITS = 2;
export const MAX_QUBITS = 6;
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

// onChange(snapshot), onAnimateStep(fromBloch, toBloch) => Promise<void>
export function createCircuitController({ onChange, onAnimateStep }) {
  let qubitCount = MIN_QUBITS;
  let grid = emptyGrid(qubitCount);

  const stored = loadStored();
  if (stored) {
    qubitCount = stored.qubitCount;
    grid = emptyGrid(qubitCount);
    for (let col = 0; col < Math.min(MAX_COLUMNS, stored.grid.length); col++) {
      for (let q = 0; q < qubitCount; q++) {
        const cell = stored.grid[col]?.[q];
        if (cell && GATE_INFO[cell.gate]?.ready) grid[col][q] = cell;
      }
    }
  }

  let selectedQubit = 0;
  let stepIndex = usedColumnCount(grid);
  let isPlaying = false;
  let isAnimating = false;

  function stateAt(step) {
    let state = initialState(qubitCount);
    for (let col = 0; col < step; col++) {
      for (let q = 0; q < qubitCount; q++) {
        const cell = grid[col][q];
        if (cell) state = applyGate(state, cell.gate, q, { theta: cell.theta });
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
    };
  }

  function notify() {
    save(qubitCount, grid);
    onChange(snapshot());
  }

  function placeGate(column, qubit, gateName, theta) {
    if (isAnimating || isPlaying) return;
    if (column < 0 || column >= MAX_COLUMNS) return;
    if (qubit < 0 || qubit >= qubitCount) return;
    if (!GATE_INFO[gateName]?.ready) return;
    grid[column][qubit] = theta === undefined ? { gate: gateName } : { gate: gateName, theta };
    stepIndex = usedColumnCount(grid);
    notify();
  }

  function removeGate(column, qubit) {
    if (isAnimating || isPlaying) return;
    if (!grid[column] || !grid[column][qubit]) return;
    grid[column][qubit] = null;
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
        newGrid[col][q] = grid[col][q];
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
