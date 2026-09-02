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
  basisProbabilities,
  GATE_INFO,
  decompositionOf,
} from "./quantum.js";
import { qubitBlochVector } from "./density.js";
import { resolveDeferred } from "./classical.js";
import { runTrajectory, makeRng, randomSeed, needsTrajectorySampling } from "./trajectory.js";

export const MIN_QUBITS = 2;
export const MAX_QUBITS = 6;
export const DEFAULT_QUBITS = 4;
export const MAX_COLUMNS = 12;

const STORAGE_KEY = "bloch-composer-v1";

// 게이트별 타깃 개수(기본 1). RCCX/RC3X는 모든 관여 큐비트를 targets에 담는다(controls 경로 안 탐).
const TARGET_COUNT = { SWAP: 2, RXX: 2, RYY: 2, RZZ: 2, RCCX: 3, RC3X: 4 };
// 컨트롤(•)을 부착할 수 없는 게이트: 측정류 + 이미 고정된 상대위상 게이트
const NON_CONTROLLABLE = new Set(["MEASURE", "RESET", "BARRIER", "CTRL"]);
const FIXED_MULTI = new Set(["RCCX", "RC3X"]); // 컨트롤 부착 거부(분해가 이미 고정)

// 이 게이트에 "•"를 붙일 수 없는 이유(붙일 수 있으면 null). 후보 계산과 실제 부착이 같은 문구를 쓰도록
// 한 곳에서만 정의한다 — 팝오버를 띄우기 전 검사와 확정 시 검사가 어긋나지 않게.
function controlRejection(cell) {
  if (NON_CONTROLLABLE.has(cell.gate)) return `${cell.gate} cannot be controlled`;
  if (FIXED_MULTI.has(cell.gate)) return `${cell.gate} is a fixed relative-phase gate — add its qubits via placement, not the • control`;
  return null;
}

function emptyGrid(qubitCount) {
  return Array.from({ length: MAX_COLUMNS }, () => new Array(qubitCount).fill(null));
}

// placement가 관여하는 모든 큐비트 (targets ∪ controls)
export function involvedQubits(cell) {
  return [...(cell.targets ?? []), ...(cell.controls ?? [])];
}

// 스냅샷만 읽는 순수 조회 둘. 스냅샷을 만드는 곳이 여기라 여기 둔다 —
// UI 쪽에 두면 팝오버·메뉴가 서로를 import 하게 되어 순환이 생긴다.

// 열에서 qubit을 점유한 placement의 홈 행. 없으면 -1.
export function homeOf(snapshot, column, qubit) {
  for (let t = 0; t < snapshot.qubitCount; t++) {
    const cell = snapshot.grid[column]?.[t];
    if (cell && involvedQubits(cell).includes(qubit)) return t;
  }
  return -1;
}

// { column, home } 선택자가 가리키는 셀. 회로가 바뀌어 사라졌으면 null.
export function cellAtHome(snapshot, sel) {
  if (!sel) return null;
  return snapshot.grid[sel.column]?.[sel.home] ?? null;
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
    case "decomposed": // RCCX/RC3X: 관여 큐비트를 targets=[...controls, target] 순서로 보존(구 v1 gate명이 유지되어 복원됨)
      return { gate: cell.gate, targets: [...(cell.controls ?? []), homeRow], controls: [], params: {} };
    case "controlled": // CNOT/CCX/CZ → base(X/Z) + controls
      return { gate: info.base, targets: [homeRow], controls: (cell.controls ?? []).slice(), params: {} };
    case "swap":
      return { gate: "SWAP", targets: [homeRow, cell.partner], controls: [], params: {} };
    case "cswap": // CSWAP 프리셋 → SWAP + control (CNOT/CCX 프리셋과 동일한 전개)
      return { gate: "SWAP", targets: [homeRow, cell.partner], controls: (cell.controls ?? []).slice(), params: {} };
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
  if (FIXED_MULTI.has(cell.gate) && controls.length > 0) return false; // RCCX/RC3X는 controls를 안 씀
  if (targets.length !== (TARGET_COUNT[cell.gate] ?? 1)) return false;
  return true;
}

// 순수 시뮬레이션: 그리드의 처음 `steps` 칼럼을 적용한 상태벡터를 반환한다.
// 칼럼 CTRL(•) 점은 같은 칼럼 게이트들에 추가 컨트롤로 부여된다.
// 고전 조건(params.cif)은 지연 측정 변환으로 양자 제어가 된다 — 변환 불가한 회로는 **예외를 던진다**
// (조용히 틀린 상태를 돌려주지 않는다). 조건이 없는 회로는 그리드가 그대로 쓰여 결과가 불변이다.
export function simulate(qubitCount, grid, steps, clbitCount = qubitCount) {
  const resolved = resolveDeferred(qubitCount, clbitCount, grid);
  if (resolved.error) throw new Error(resolved.error);
  return simulateResolved(qubitCount, resolved.grid, steps);
}

// 이미 지연 측정 변환을 마친 그리드를 실행한다. 변환을 두 번 적용하면 조건부 셀에 제어가
// 중복으로 붙어 잘못된 검증 실패가 나므로, 변환은 딱 한 번만 거치게 분리해 둔다.
function simulateResolved(qubitCount, grid, steps) {
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

function save(qubitCount, clbitCount, grid) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ qubitCount, clbitCount, grid }));
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
export function createCircuitController({ onChange, onAnimateStep, onStepPause, initial }) {
  let qubitCount = DEFAULT_QUBITS;
  let clbitCount = DEFAULT_QUBITS; // 고전 비트 수 — 큐비트 수와 독립, 기본은 같게
  let grid = emptyGrid(qubitCount);

  const stored = initial ?? loadStored();
  if (stored) {
    qubitCount = stored.qubitCount;
    // 고전 비트 수가 없는 구버전 저장/URL은 큐비트 수와 같게 연다(기존 링크 무손상)
    clbitCount = typeof stored.clbitCount === "number"
      ? Math.max(0, Math.min(MAX_QUBITS, stored.clbitCount))
      : qubitCount;
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
  // Inspect 는 "단계별로 들여다보는 모드"일 뿐이다 — 계산 방식을 정하지 않는다.
  // **중간 측정이 있으면 Inspect 와 무관하게 궤적으로 계산한다**(지연 측정 값은 틀리다).
  // 시드는 회로가 바뀌어도 유지한다 — 게이트를 고쳤을 때 결과가 달라지면 그게 편집
  // 때문인지 새 난수 때문인지 구분할 수 있어야 하고, 되감기도 결정론적이어야 한다.
  let inspectMode = false;
  let trajectorySeed = randomSeed();
  let isPlaying = false;
  let isAnimating = false;
  let runtimeError = null; // 재생/스텝 중 예상치 못한 예외가 났을 때 사용자에게 보여줄 사유

  // 컨트롤러 내부의 유일한 상태 접근점. **예외를 던지지 않고** { state, error }를 돌려준다
  // (예상 가능한 실패를 예외로 만들면 호출부마다 try/catch가 필요해지고, 하나라도 빠지면
  //  재생 루프가 죽어 앱이 조작 불가 상태로 남는다 — 실제로 그 버그가 있었다).
  function stateAt(step) {
    if (needsTrajectorySampling(qubitCount, grid)) {
      // 궤적 경로는 지연 측정 변환을 타지 않으므로 그 제약(측정된 큐비트 재조작)도 없다.
      // 같은 시드를 매번 처음부터 먹이므로 같은 step 이면 항상 같은 상태가 나온다.
      const { state, clbits } = runTrajectory(qubitCount, clbitCount, grid, step, makeRng(trajectorySeed));
      return { state, clbits, error: null };
    }
    const resolved = resolveDeferred(qubitCount, clbitCount, grid);
    if (resolved.error) return { state: initialState(qubitCount), error: resolved.error };
    return { state: simulateResolved(qubitCount, resolved.grid, step), clbits: null, error: null };
  }

  // 회로가 시뮬레이션 가능한지 — addControl/setParams 등과 같은 { ok, reason } 패턴.
  function validate() {
    // 궤적 실행은 어떤 측정 패턴이든 정확히 다룬다 — 지연 변환 제약이 적용되지 않는다.
    if (needsTrajectorySampling(qubitCount, grid)) return { ok: true };
    const { error } = resolveDeferred(qubitCount, clbitCount, grid);
    return error ? { ok: false, reason: error } : { ok: true };
  }

  function snapshot() {
    const totalSteps = usedColumnCount(grid);
    // 지연 측정으로 표현할 수 없는 회로는 상태를 계산하지 않고 사유를 올린다.
    // UI가 숫자 대신 사유를 보여주므로 아래 placeholder 상태가 결과로 제시되는 일은 없다.
    const { state, clbits, error } = stateAt(stepIndex);
    const deferredError = error ?? runtimeError;
    return {
      qubitCount,
      clbitCount,
      deferredError,
      inspectMode,
      // 이 회로가 궤적으로 계산되는가. UI 가 "One trajectory" 라벨·Inspect 토글·축 라벨을
      // 이 값으로 가른다(Inspect 켜짐 여부와 별개다).
      usesTrajectory: needsTrajectorySampling(qubitCount, grid),
      hasMeasurement: gridHasMeasurement(qubitCount, grid),
      clbits, // 궤적 경로에서 이 스텝까지 기록된 고전 비트 값(지연 경로에서는 null)
      grid,
      selectedQubit,
      stepIndex,
      totalSteps,
      isPlaying,
      isAnimating,
      canAddQubit: qubitCount < MAX_QUBITS,
      canRemoveQubit: qubitCount > MIN_QUBITS,
      canAddClbit: clbitCount < MAX_QUBITS,
      canRemoveClbit: clbitCount > 0,
      canUndo: undoStack.length > 0,
      canRedo: redoStack.length > 0,
      bloch: qubitBlochVector(state, selectedQubit),
      probabilities: basisProbabilities(state, qubitCount),
      state, // DM 뷰가 선택 큐비트의 축소 밀도행렬을 계산할 원본 상태벡터
    };
  }

  // 렌더(onChange)에서 터진 예외가 컨트롤러 상태를 오염시키거나 재생 루프를 죽이지 못하게 막는다.
  function notify() {
    try {
      save(qubitCount, clbitCount, grid);
      onChange(snapshot());
    } catch (err) {
      console.error("Render failed:", err);
    }
  }

  // 재생/스텝 실행을 감싸는 안전망. 어떤 예외가 나더라도 finally에서 플래그를 반드시 풀어
  // UI가 조작 불가 상태로 남지 않게 한다 — 이 수정의 핵심 불변식이다.
  async function runPlayback(fn) {
    try {
      runtimeError = null;
      await fn();
    } catch (err) {
      console.error("Playback stopped:", err);
      runtimeError = err?.message ?? String(err);
    } finally {
      isPlaying = false;
      isAnimating = false;
      notify();
    }
  }

  // ---------- Undo/Redo 히스토리 ----------
  // 회로가 작으므로 전체 스냅샷({qubitCount, grid})을 저장한다(diff 없음). 최대 50단계.
  const MAX_HISTORY = 50;
  const undoStack = [];
  const redoStack = [];

  function cloneGrid(g) {
    return g.map((col) =>
      col.map((cell) =>
        cell
          ? {
              gate: cell.gate,
              targets: [...cell.targets],
              controls: [...(cell.controls ?? [])],
              params: { ...(cell.params ?? {}) },
            }
          : null
      )
    );
  }
  function captureState() {
    return { qubitCount, clbitCount, grid: cloneGrid(grid) };
  }
  // 회로 변경 직전에 호출: 현재 상태를 undo 스택에 넣고 redo 스택을 비운다(새 분기).
  function pushUndo() {
    undoStack.push(captureState());
    if (undoStack.length > MAX_HISTORY) undoStack.shift(); // 오래된 것부터 버림
    redoStack.length = 0;
  }
  function restoreState(snap) {
    qubitCount = snap.qubitCount;
    if (typeof snap.clbitCount === "number") clbitCount = snap.clbitCount;
    grid = cloneGrid(snap.grid);
    if (selectedQubit >= qubitCount) selectedQubit = qubitCount - 1;
    stepIndex = Math.min(stepIndex, usedColumnCount(grid));
  }
  function undo() {
    if (isAnimating || isPlaying || undoStack.length === 0) return;
    redoStack.push(captureState());
    restoreState(undoStack.pop());
    notify();
  }
  function redo() {
    if (isAnimating || isPlaying || redoStack.length === 0) return;
    undoStack.push(captureState());
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    restoreState(redoStack.pop());
    notify();
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
    // Measure는 기본적으로 같은 인덱스의 고전 비트에 기록한다(q2 → c2). 범위를 벗어나면 마지막 비트로.
    if (cell.gate === "MEASURE" && clbitCount > 0 && cell.params.cbit === undefined) {
      cell.params.cbit = Math.min(cell.targets[0], clbitCount - 1);
    }
    // 홈 = targets[0] (단일 타깃은 qubit과 동일; RCCX/RC3X는 첫 컨트롤이 홈)
    const home = cell.targets[0];
    // 관여하는 모든 큐비트 자리가 비어 있어야 배치 가능 (자기 자신이 점유 중이면 교체)
    for (const q of involvedQubits(cell)) {
      const occupant = occupantTarget(column, q);
      if (occupant !== -1 && occupant !== home) return;
    }
    pushUndo();
    grid[column][home] = cell;
    stepIndex = usedColumnCount(grid);
    notify();
  }

  function removeGate(column, qubit) {
    if (isAnimating || isPlaying) return;
    if (!grid[column]) return;
    const target = occupantTarget(column, qubit);
    if (target === -1) return;
    pushUndo();
    grid[column][target] = null;
    stepIndex = Math.min(stepIndex, usedColumnCount(grid));
    notify();
  }

  // 제어 부착의 **유일한** 변형 지점. 부착 대상 게이트(home)를 호출자가 명시한다.
  // 두 배치 경로(빈 칸 드롭 / 게이트 위 드롭)가 모두 이 함수만 거치므로, 같은 큐비트를 가리키면
  // 결과 셀이 완전히 동일해진다. 시뮬레이션 코드는 건드리지 않고 데이터 모델(controls)만 수정.
  // 여러 개를 한 번에 붙여도 **undo는 한 단계**다(한 번의 사용자 동작이므로 pushUndo도 한 번).
  function attachControlsTo(column, home, controlQubits) {
    const cell = grid[column][home];
    if (!cell) return { ok: false, reason: "No gate in this column to control" };
    const rejection = controlRejection(cell);
    if (rejection) return { ok: false, reason: rejection };
    if (controlQubits.length === 0) return { ok: false, reason: "Select at least one control qubit" };
    const newCell = { ...cell, controls: [...cell.controls, ...controlQubits] };
    if (!isValidPlacement(newCell, qubitCount)) return { ok: false, reason: "Invalid placement" };
    pushUndo();
    grid[column][home] = newCell;
    stepIndex = usedColumnCount(grid);
    notify();
    return { ok: true };
  }
  const attachControlTo = (column, home, controlQubit) => attachControlsTo(column, home, [controlQubit]);

  // "•"를 **빈 칸**에 드롭: controlQubit을 같은 칼럼의 (가장 가까운) 게이트 controls에 추가한다.
  // 최근접 규칙은 기존 동작 그대로 유지한다(제어를 특정 큐비트에 정확히 놓고 싶을 때의 경로).
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
    return attachControlTo(column, homes[0], controlQubit);
  }

  // "•"를 **게이트 위**에 드롭했을 때: 팝오버를 띄우기 전에 검사하고 제어 후보 큐비트를 모은다.
  // 회로도 undo 스택도 건드리지 않는다(취소해도 아무 흔적이 남지 않는 근거).
  // 드롭 지점이 타깃이든 제어점이든 똑같이 "이 게이트에 제어 추가"로 처리한다 — CZ는 •—•로 그려져
  // 두 점이 화면상 구별 불가능하고, CCZ는 세 큐비트에 대칭이라 어느 점에 붙여도 결과가 같다.
  // 후보는 드롭한 큐비트가 아니라 **열 전체** 기준이므로 어느 점에 드롭해도 동일한 목록이 나온다.
  // 반환: { ok:true, home, candidates:[q…] } | { ok:false, reason }
  function controlOptions(column, qubit) {
    if (isAnimating || isPlaying) return { ok: false, reason: "Busy" };
    if (column < 0 || column >= MAX_COLUMNS) return { ok: false, reason: "Invalid column" };
    const home = occupantTarget(column, qubit);
    if (home === -1) return { ok: false, reason: "No gate here" };
    const cell = grid[column][home];
    // 대상 게이트 없이 놓인 순수 CTRL 점에는 제어를 붙일 수 없다.
    if (cell.gate === "CTRL") return { ok: false, reason: "A control cannot be controlled" };
    const rejection = controlRejection(cell);
    if (rejection) return { ok: false, reason: rejection };
    // 후보 = 같은 열에서 아무도 쓰지 않는 와이어 전부(오름차순). span 안/바깥을 구분하지 않는다.
    const candidates = [];
    for (let q = 0; q < qubitCount; q++) if (occupantTarget(column, q) === -1) candidates.push(q);
    if (candidates.length === 0) return { ok: false, reason: "No free wire in this column for a control" };
    return { ok: true, home, candidates };
  }

  // 팝오버에서 고른 큐비트(들)로 확정. 후보를 다시 계산해 검증한 뒤 공통 부착 지점에 위임한다.
  // 여러 개를 고를 수 있다 — 한 번에 붙여 undo 한 단계로 묶는다.
  // 선택 순서와 무관하게 같은 셀이 나오도록 **오름차순으로 정규화**해서 덧붙인다
  // (기존 controls는 재정렬하지 않는다 — 누적 순서/직렬화 출력이 흔들리지 않게).
  function addControlToGate(column, qubit, controlQubits) {
    const picked = (Array.isArray(controlQubits) ? controlQubits : [controlQubits]).slice().sort((a, b) => a - b);
    const opt = controlOptions(column, qubit);
    if (!opt.ok) return opt;
    if (new Set(picked).size !== picked.length) return { ok: false, reason: "Duplicate control qubit" };
    if (!picked.every((q) => opt.candidates.includes(q))) return { ok: false, reason: "That wire is not free" };
    return attachControlsTo(column, opt.home, picked); // 기존 제어가 있으면 누적된다
  }

  // Measure가 기록할 고전 비트를 바꾼다. bit=null이면 기록하지 않음(표시만).
  function setClassicalBit(column, qubit, bit) {
    if (isAnimating || isPlaying) return { ok: false, reason: "Busy" };
    const home = occupantTarget(column, qubit);
    if (home === -1) return { ok: false, reason: "No gate here" };
    const cell = grid[column][home];
    if (cell.gate !== "MEASURE") return { ok: false, reason: "Only Measure writes to a classical bit" };
    if (bit !== null && (bit < 0 || bit >= clbitCount)) return { ok: false, reason: "That classical bit doesn't exist" };
    pushUndo();
    const params = { ...(cell.params ?? {}) };
    if (bit === null) delete params.cbit; else params.cbit = bit;
    grid[column][home] = { ...cell, params };
    notify();
    return { ok: true };
  }

  // 게이트에 고전 조건(c[bit]==1일 때만 적용)을 붙이거나(bit=숫자) 뗀다(bit=null).
  // 시뮬레이션에서는 지연 측정 변환으로 양자 제어가 된다.
  function setCondition(column, qubit, bit) {
    if (isAnimating || isPlaying) return { ok: false, reason: "Busy" };
    const home = occupantTarget(column, qubit);
    if (home === -1) return { ok: false, reason: "No gate here" };
    const cell = grid[column][home];
    if (bit !== null) {
      if (clbitCount === 0) return { ok: false, reason: "There are no classical bits — add one first" };
      if (bit < 0 || bit >= clbitCount) return { ok: false, reason: "That classical bit doesn't exist" };
      if (NON_CONTROLLABLE.has(cell.gate)) return { ok: false, reason: `${cell.gate} cannot be conditioned` };
      if (FIXED_MULTI.has(cell.gate)) return { ok: false, reason: `${cell.gate} cannot be conditioned` };
    }
    pushUndo();
    const params = { ...(cell.params ?? {}) };
    if (bit === null) delete params.cif; else params.cif = bit;
    grid[column][home] = { ...cell, params };
    notify();
    return { ok: true };
  }

  // 배치된 게이트의 파라미터만 교체한다(targets/controls·홈 위치는 그대로).
  // 컨텍스트 메뉴 "Edit parameters"용. 셀 구조는 바뀌지 않는다.
  function setParams(column, qubit, params) {
    if (isAnimating || isPlaying) return { ok: false, reason: "Busy" };
    if (!grid[column]) return { ok: false, reason: "Invalid column" };
    const home = occupantTarget(column, qubit);
    if (home === -1) return { ok: false, reason: "No gate here" };
    const cell = grid[column][home];
    pushUndo();
    grid[column][home] = { ...cell, params: { ...params } };
    notify();
    return { ok: true };
  }

  // "Apply expansion": 게이트를 코드에 정의된 분해(quantum.js의 STEPS)로 실제 교체한다.
  // 분해 스텝 하나당 한 열을 쓰고, 뒤 열들은 그만큼 밀린다. pushUndo 한 번 → Undo 한 단계로 복원.
  function expandGate(column, qubit) {
    if (isAnimating || isPlaying) return { ok: false, reason: "Busy" };
    if (!grid[column]) return { ok: false, reason: "Invalid column" };
    const home = occupantTarget(column, qubit);
    if (home === -1) return { ok: false, reason: "No gate here" };
    const cell = grid[column][home];
    const steps = decompositionOf(cell.gate);
    if (!steps) return { ok: false, reason: "No decomposition is defined for this gate" };

    const extra = steps.length - 1; // 원래 열 1개를 steps.length개로 늘린다
    const used = usedColumnCount(grid);
    if (used + extra > MAX_COLUMNS) {
      return { ok: false, reason: `Needs ${steps.length} columns — not enough room` };
    }
    const next = emptyGrid(qubitCount);
    for (let col = 0; col < column; col++) next[col] = grid[col].slice();
    // 같은 열의 다른 게이트들은 첫 확장 열에 남긴다(분해가 건드리는 큐비트와 겹치지 않는다).
    for (let t = 0; t < qubitCount; t++) if (t !== home && grid[column][t]) next[column][t] = grid[column][t];
    // 분해 스텝을 한 열씩 배치. on/control은 cell.targets의 인덱스다.
    const targets = cell.targets;
    steps.forEach((s, i) => {
      const t = targets[s.on];
      next[column + i][t] = {
        gate: s.gate,
        targets: [t],
        controls: s.control === undefined ? [] : [targets[s.control]],
        params: {},
      };
    });
    // 뒤 열들을 extra만큼 민다
    for (let col = column + 1; col < MAX_COLUMNS; col++) {
      const dest = col + extra;
      if (dest >= MAX_COLUMNS) {
        if (grid[col].some(Boolean)) return { ok: false, reason: "Not enough columns to expand" };
        continue;
      }
      next[dest] = grid[col].slice();
    }
    pushUndo();
    grid = next;
    stepIndex = usedColumnCount(grid);
    notify();
    return { ok: true, columns: steps.length };
  }

  // 제어점 제거: controlQubit이 어떤 게이트의 controls면 그 항목만 뺀다.
  // 반환: 제거했으면 true (클릭이 제어점이었음), 아니면 false.
  function removeControl(column, controlQubit) {
    if (isAnimating || isPlaying) return false;
    if (!grid[column]) return false;
    for (let t = 0; t < qubitCount; t++) {
      const cell = grid[column][t];
      if (cell && (cell.controls ?? []).includes(controlQubit)) {
        pushUndo();
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
    pushUndo(); // Clear all은 undo로 되돌릴 수 있어야 한다(이 기능의 주 목적)
    grid = emptyGrid(qubitCount);
    stepIndex = 0;
    notify();
  }

  // 프리셋/공유 회로 로드: 현재 회로를 통째로 교체한다. 큐비트 수도 자동 설정.
  // pushUndo로 반드시 undo 스택에 기록 → 실수로 눌러도 Undo로 되돌릴 수 있다.
  function loadCircuit(nextQubitCount, nextGrid, nextClbitCount) {
    if (isAnimating || isPlaying) return;
    const n = Math.max(MIN_QUBITS, Math.min(MAX_QUBITS, nextQubitCount | 0));
    pushUndo();
    // 고전 비트 수가 없는(구버전) 회로는 큐비트 수와 같게 연다
    clbitCount = typeof nextClbitCount === "number"
      ? Math.max(0, Math.min(MAX_QUBITS, nextClbitCount))
      : n;
    const ng = emptyGrid(n);
    for (let col = 0; col < Math.min(MAX_COLUMNS, nextGrid.length); col++) {
      for (let q = 0; q < n; q++) {
        const raw = nextGrid[col]?.[q];
        if (!raw) continue;
        const cell = migrateCell(raw, q); // 이미 canonical이면 정규화만
        if (isValidPlacement(cell, n)) ng[col][cell.targets[0]] = cell;
      }
    }
    qubitCount = n;
    grid = ng;
    if (selectedQubit >= qubitCount) selectedQubit = qubitCount - 1;
    stepIndex = usedColumnCount(grid);
    notify();
  }

  // 고전 비트 수 변경(0…MAX). 0이면 캔버스에서 고전 와이어가 사라진다.
  // 줄어들어 범위를 벗어난 cbit/cif 참조는 함께 정리한다(조용히 잘못된 조건이 남지 않게).
  function setClbitCount(next) {
    if (isAnimating || isPlaying) return;
    const n = Math.max(0, Math.min(MAX_QUBITS, next | 0));
    if (n === clbitCount) return;
    pushUndo();
    clbitCount = n;
    for (let col = 0; col < MAX_COLUMNS; col++) {
      for (let q = 0; q < qubitCount; q++) {
        const cell = grid[col][q];
        if (!cell) continue;
        const p = cell.params ?? {};
        if (p.cbit !== undefined && p.cbit >= n) {
          const params = { ...p }; delete params.cbit;
          grid[col][q] = { ...cell, params };
        }
        const p2 = grid[col][q].params ?? {};
        if (p2.cif !== undefined && p2.cif >= n) {
          const params = { ...p2 }; delete params.cif;
          grid[col][q] = { ...grid[col][q], params };
        }
      }
    }
    notify();
  }

  function setQubitCount(next) {
    if (isAnimating || isPlaying) return;
    if (next < MIN_QUBITS || next > MAX_QUBITS || next === qubitCount) return;
    pushUndo();
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

  // 전환 애니메이션에 넘길 데이터. 중간 프레임은 시각적 트윈일 뿐이라 이전/다음 스텝의
  // 정확한 값(확률·블로흐·스텝열)을 함께 주고, 보간은 렌더 쪽(main.js)에서 한다.
  /** 측정이 하나라도 있는가 — 확률 패널의 Classical/Qubits 토글 표시를 가른다. */
  function gridHasMeasurement(n, g) {
    for (const col of g) for (let q = 0; q < n; q++) if (col?.[q]?.gate === "MEASURE") return true;
    return false;
  }

  /** Inspect 모드 전환. 시드는 건드리지 않는다 — 껐다 켜도 같은 궤적으로 돌아온다. */
  function setInspectMode(on) {
    const next = Boolean(on);
    if (next === inspectMode) return;
    inspectMode = next;
    // 끄면 스텝 컨트롤이 사라진다 — 중간 단계에 멈춘 채로 두면 되돌릴 방법이 없다.
    if (!inspectMode) stepIndex = usedColumnCount(grid);
    notify();
  }

  /**
   * 새 궤적을 뽑는다. "같은 회로인데 실행마다 결과가 다르다"를 보여주는 버튼.
   * Inspect 여부와 무관하게 알린다 — 궤적으로 계산되는 회로면 꺼져 있어도 화면이
   * 그 시드의 결과를 보여주고 있기 때문이다(예전엔 Inspect 켜짐일 때만 알려서,
   * 꺼진 상태의 Resample 이 화면을 바꾸지 않은 채 시드만 조용히 바꿔 놨다).
   */
  function resample() {
    trajectorySeed = randomSeed();
    if (needsTrajectorySampling(qubitCount, grid)) notify();
  }

  function transitionData(fromIdx, toIdx) {
    const fs = stateAt(fromIdx).state;
    const ts = stateAt(toIdx).state;
    return {
      fromBloch: qubitBlochVector(fs, selectedQubit),
      toBloch: qubitBlochVector(ts, selectedQubit),
      fromProbs: basisProbabilities(fs, qubitCount),
      toProbs: basisProbabilities(ts, qubitCount),
      fromStep: fromIdx,
      toStep: toIdx,
      qubitCount,
    };
  }

  async function stepForward() {
    const totalSteps = usedColumnCount(grid);
    if (isAnimating || isPlaying || stepIndex >= totalSteps) return;
    if (!validate().ok) return;
    return runPlayback(async () => {
      isAnimating = true;
      notify();
      await onAnimateStep(transitionData(stepIndex, stepIndex + 1));
      stepIndex += 1;
    });
  }

  async function stepBackward() {
    if (isAnimating || isPlaying || stepIndex <= 0) return;
    if (!validate().ok) return;
    return runPlayback(async () => {
      isAnimating = true;
      notify();
      await onAnimateStep(transitionData(stepIndex, stepIndex - 1));
      stepIndex -= 1;
    });
  }

  async function play() {
    const totalSteps = usedColumnCount(grid);
    if (isAnimating || isPlaying || totalSteps === 0) return;
    if (!validate().ok) return; // 시뮬레이션할 수 없는 회로는 애초에 재생하지 않는다
    if (stepIndex >= totalSteps) stepIndex = 0;
    return runPlayback(async () => {
      isPlaying = true;
      notify();
      while (stepIndex < totalSteps) {
        if (!isPlaying) break;
        isAnimating = true;
        notify();
        await onAnimateStep(transitionData(stepIndex, stepIndex + 1));
        stepIndex += 1;
        isAnimating = false;
        notify(); // [1] 정확한 상태는 전환이 끝난 뒤에만 표시
        // 정확한 상태 위에서 잠깐 정지 후 다음 스텝
        if (isPlaying && stepIndex < totalSteps && onStepPause) await onStepPause();
      }
    });
  }

  function pause() {
    isPlaying = false;
    notify(); // 플래그만 내리고 UI를 갱신하지 않으면 버튼이 "재생 중"으로 남는다
  }

  notify();

  return {
    MIN_QUBITS,
    MAX_QUBITS,
    MAX_COLUMNS,
    getSnapshot: snapshot,
    validate,
    setInspectMode,
    resample,
    placeGate,
    removeGate,
    addControl,
    controlOptions,
    addControlToGate,
    setParams,
    setClassicalBit,
    setCondition,
    setClbitCount,
    expandGate,
    removeControl,
    clear,
    loadCircuit,
    setQubitCount,
    undo,
    redo,
    selectQubit,
    reset,
    stepForward,
    stepBackward,
    play,
    pause,
  };
}
