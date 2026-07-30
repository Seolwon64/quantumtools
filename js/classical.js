// 지연 측정(deferred measurement) 변환 — 순수 함수, 회로/상태를 수정하지 않는다.
//
// 왜 이 방식인가: 이 앱은 상태벡터 시뮬레이터라 회로 중간에 진짜 측정을 수행하면 이후 상태가
// 확률적 혼합이 되어 상태벡터·Q-sphere·축소 밀도행렬·수식 표시가 전부 성립하지 않는다.
// 지연 측정 원리는 "모든 측정을 회로 끝으로 미루고, 측정 결과에 조건부인 연산을 양자 제어
// 게이트로 바꾸면 최종 측정 통계가 동일하다"는 표준 정리다. 전역 상태가 순수하게 유지되므로
// 기존 표시 계층을 그대로 쓸 수 있다.
//
// 이 코드베이스에서 MEASURE는 원래부터 no-op(applyPlacement가 상태를 그대로 반환)이므로
// "측정을 끝으로 미루는" 부분은 이미 되어 있다. 따라서 실제로 할 일은 하나뿐이다:
//   params.cif = k (c[k]==1일 때 적용) → c[k]에 기록한 큐비트를 controls에 추가.
// 열 구조와 인덱스는 건드리지 않으므로 스텝 재생/되감기 의미가 그대로 유지된다.
import { GATE_INFO } from "./quantum.js";

// 측정 이후에도 그 큐비트에 허용되는 관여 방식: 제어(Z기저 측정과 교환됨)뿐이다.
// 타깃이 되거나 RESET되면 지연 측정 변환이 성립하지 않는다.
function cellsOfColumn(grid, col, qubitCount) {
  const out = [];
  for (let q = 0; q < qubitCount; q++) if (grid[col]?.[q]) out.push(grid[col][q]);
  return out;
}

/**
 * 조건부 연산을 양자 제어로 바꾼 "실효 그리드"를 만든다.
 * 반환: { grid, error } — error가 있으면 grid는 null이고 호출부는 상태를 계산하면 안 된다.
 * cif가 하나도 없으면 **원본 grid를 그대로 반환**한다(무측정 회로의 결과가 비트 단위로 불변).
 */
export function resolveDeferred(qubitCount, clbitCount, grid) {
  const writer = new Array(clbitCount).fill(-1); // c[k]에 마지막으로 기록한 큐비트
  const measuredAt = new Map(); // 큐비트 → 측정된 열
  let needsRewrite = false;
  let out = grid;

  for (let col = 0; col < grid.length; col++) {
    for (let q = 0; q < qubitCount; q++) {
      const cell = grid[col]?.[q];
      if (!cell) continue;
      const targets = cell.targets ?? [];
      const params = cell.params ?? {};

      // 1) 측정된 큐비트를 이후에 "타깃"으로 쓰거나 RESET하면 변환이 성립하지 않는다.
      for (const t of targets) {
        if (!measuredAt.has(t)) continue;
        if (cell.gate === "MEASURE") continue; // 재측정은 상태를 바꾸지 않으므로 무해
        if (cell.gate === "BARRIER") continue;
        return {
          grid: null,
          error:
            `q[${t}] is measured at column ${measuredAt.get(t) + 1}, then modified by ` +
            `${GATE_INFO[cell.gate]?.label ?? cell.gate} at column ${col + 1}. ` +
            `Deferred measurement can't represent this — remove the later operation on q[${t}].`,
        };
      }

      // 2) 조건부 연산: c[k]에 기록한 큐비트를 제어로 승격
      if (params.cif !== undefined) {
        const k = params.cif;
        if (k < 0 || k >= clbitCount) {
          return { grid: null, error: `Condition uses c[${k}], which is outside the classical register (c[0]…c[${clbitCount - 1}]).` };
        }
        if (writer[k] === -1) {
          return {
            grid: null,
            error: `The gate at column ${col + 1} is conditioned on c[${k}], but nothing has measured into c[${k}] yet. Add a Measure that writes to c[${k}] in an earlier column.`,
          };
        }
        const ctrlQubit = writer[k];
        if (targets.includes(ctrlQubit) || (cell.controls ?? []).includes(ctrlQubit)) {
          return {
            grid: null,
            error: `The gate at column ${col + 1} is conditioned on c[${k}] (measured from q[${ctrlQubit}]), but it also acts on q[${ctrlQubit}].`,
          };
        }
        if (!needsRewrite) { out = grid.map((c2) => c2.slice()); needsRewrite = true; }
        out[col][q] = { ...cell, controls: [...(cell.controls ?? []), ctrlQubit] };
      }
    }

    // 열 전체를 처리한 뒤 이 열의 측정을 기록한다(같은 열의 조건은 이전 열 기록만 본다).
    for (const cell of cellsOfColumn(grid, col, qubitCount)) {
      if (cell.gate !== "MEASURE") continue;
      const q = cell.targets[0];
      const k = cell.params?.cbit ?? q;
      if (k >= 0 && k < clbitCount) writer[k] = q;
      if (!measuredAt.has(q)) measuredAt.set(q, col);
    }
  }
  return { grid: out, error: null };
}

/** 회로에 측정이 하나라도 있는가 (정직성 안내를 띄울지 판단). */
export function hasMeasurement(qubitCount, grid) {
  for (const col of grid) {
    for (let q = 0; q < qubitCount; q++) if (col?.[q]?.gate === "MEASURE") return true;
  }
  return false;
}

/** 각 열이 측정을 포함하는지 — 스텝 재생 중 "여기서 측정됨" 강조에 쓴다. */
export function measurementColumns(qubitCount, grid) {
  const cols = new Set();
  for (let col = 0; col < grid.length; col++) {
    for (let q = 0; q < qubitCount; q++) if (grid[col]?.[q]?.gate === "MEASURE") cols.add(col);
  }
  return cols;
}

export const DEFERRED_NOTE =
  "Simulated using the deferred measurement principle — measurements are postponed to the end of " +
  "the circuit. Final measurement statistics are identical, but the intermediate state shown is " +
  "the pre-measurement (uncollapsed) state.";
