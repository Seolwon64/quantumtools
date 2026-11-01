// 회로 격자 연결선의 경로와 교차 판정 — 칸 사각형만 받는 순수 함수(DOM 무관). 좌표는 grid.js 가 실측해 넘긴다.
//
// 왜 따로 두나: 예전 고전 이중선은 출발 칸 중심에서 고전 행까지 곧게 내렸다. 같은 열 아래에 다른 칩이 있으면 그 칩 뒤를 지나
// 두 칩이 한 게이트처럼 이어 보였고(예전 링크의 조건부 리셋 → 측정), 배경 없는 ⊕ · × · • 를 지나면 양자 CX · 제어처럼 읽혔다
// (Apply 한 텔레포테이션 — 측정 선이 X 의 ⊕ 를 관통했다). 양자 제어선도 관여하지 않는 칩을 지났다(CX q0→q2 가 X q1 의 ⊕ 를 지나
// "타깃 둘인 CX" 로 읽혔다). 고치는 규칙(docs/design-spec.md §11):
//   · 고전 선 — 곧게 내린 선이 하나라도 걸리는 열은 **그 열을 레이아웃에서 넓혀** 옆 통로로 비켜 그린다. 쓰는 선(측정)은 오른쪽,
//     읽는 선(조건)은 왼쪽 통로다. 걸리는 것이 없는 열은 예전 그대로 곧게 내린다.
//   · 양자 제어선 — 곧아야 하므로 비켜 그릴 수 없다. 관여하지 않는 요소 · 다른 선 둘레에서 끊는다(틈).
//   · 판정은 conflicts 하나다 — 테스트와 브라우저 측정이 같은 함수를 쓴다.
//
// 좌표계: .circuit-grid 기준 px, y 는 아래로 증가. 사각형은 { left, top, right, bottom }.
import { GATE_INFO } from "./quantum.js";

// ---------------------------------------------------------------- 회로 → 그릴 것(역할 · 고전 선 · 제어선)
// grid.js 가 그리는 요소와 테스트가 만드는 장면이 같은 규칙을 쓰게 여기 둔다 — 둘이 따로 적으면 판정이 다른 그림을 본다.

const involved = (cell) => [...(cell.targets ?? []), ...(cell.controls ?? [])];

/**
 * 열 하나의 역할: 큐비트 → { cell, home, type:"target"|"control", primary, kind:"box"|"dot"|"symbol" }.
 * RCCX/RC3X 는 targets 의 마지막이 ⊕ 타깃, 앞쪽은 제어점이다. 제어 Z 는 표준 표기(•—•)라 타깃도 점이다.
 * ⊕(X 계열 — 단일 X 도 targetLabel 이 ⊕ 다)와 ×(SWAP)는 배경 없는 기호(symbol)다.
 */
export function columnRoles(qubitCount, colCells) {
  const roles = new Map();
  for (let t = 0; t < qubitCount; t++) {
    const cell = colCells?.[t];
    if (!cell) continue;
    const decomposed = GATE_INFO[cell.gate]?.kind === "decomposed";
    cell.targets.forEach((tq, i) => {
      const control = decomposed && i < cell.targets.length - 1;
      roles.set(tq, { cell, home: t, type: control ? "control" : "target", primary: control ? false : decomposed || i === 0 });
    });
    for (const q of cell.controls ?? []) roles.set(q, { cell, home: t, type: "control", primary: false });
  }
  for (const role of roles.values()) role.kind = elementKind(role.cell, role.type);
  return roles;
}

/** 칸 하나에 그리는 요소의 종류. grid.js 의 점 · 기호 · 칩 분기가 이 함수를 쓴다. */
export function elementKind(cell, type) {
  if (type === "control") return "dot";
  if (cell.gate === "Z" && (cell.controls?.length ?? 0) > 0) return "dot";
  if (cell.gate === "MEASURE") return "box";
  return symbolLabel(cell) ? "symbol" : "box";
}

/** 배경 없는 기호로 그리는 타깃의 글자(⊕ · ×), 아니면 null. */
export function symbolLabel(cell) {
  const label = cell.gate === "SWAP" ? "×" : (GATE_INFO[cell.gate]?.targetLabel ?? GATE_INFO[cell.gate]?.label);
  return label === "⊕" || label === "×" ? label : null;
}

/**
 * 열 하나의 고전 선: 측정의 기록(cbit) · 조건의 읽기(cif). 출발 행은 측정이면 그 큐비트, 조건부 게이트면 관여 큐비트 중 맨 아래.
 * 조건 붙은 측정은 둘이다(읽기 먼저 — 먼저 판정한다). 반환: [{ id, owner, kind:"read"|"write", bit, row }]
 */
export function columnLinks(qubitCount, col, colCells) {
  const links = [];
  for (let t = 0; t < qubitCount; t++) {
    const cell = colCells?.[t];
    if (!cell) continue;
    const p = cell.params ?? {};
    const isMeasure = cell.gate === "MEASURE";
    const row = isMeasure ? cell.targets[0] : Math.max(...involved(cell));
    const owner = `${col}:${t}`;
    if (p.cif !== undefined) links.push({ id: `${owner}:read`, owner, kind: "read", bit: p.cif, row, gate: cell.gate });
    if (isMeasure && p.cbit !== undefined) links.push({ id: `${owner}:write`, owner, kind: "write", bit: p.cbit, row, gate: cell.gate });
  }
  return links;
}

/** 열 하나의 양자 제어선(관여 큐비트가 둘 이상인 게이트): [{ id, owner, minQ, maxQ }] */
export function columnSpans(qubitCount, col, colCells) {
  const spans = [];
  for (let t = 0; t < qubitCount; t++) {
    const cell = colCells?.[t];
    if (!cell) continue;
    const qs = involved(cell);
    if (qs.length < 2) continue;
    spans.push({ id: `${col}:${t}:span`, owner: `${col}:${t}`, minQ: Math.min(...qs), maxQ: Math.max(...qs) });
  }
  return spans;
}

/** 두 사각형이 겹치는가(맞닿기만 하면 겹치지 않는다). pad 만큼 a 를 부풀려 본다. */
export function overlaps(a, b, pad = 0) {
  return a.left - pad < b.right && a.right + pad > b.left && a.top - pad < b.bottom && a.bottom + pad > b.top;
}

/** 축 정렬 선분(두 점)을 폭 width 의 사각형으로. */
export function segmentRect(p, q, width) {
  const h = width / 2;
  return {
    left: Math.min(p.x, q.x) - (p.x === q.x ? h : 0),
    right: Math.max(p.x, q.x) + (p.x === q.x ? h : 0),
    top: Math.min(p.y, q.y) - (p.y === q.y ? h : 0),
    bottom: Math.max(p.y, q.y) + (p.y === q.y ? h : 0),
  };
}

/** 경로(점 목록)를 선분 사각형 목록으로. */
export function pathRects(points, width) {
  const out = [];
  for (let i = 1; i < points.length; i++) out.push(segmentRect(points[i - 1], points[i], width));
  return out;
}

/**
 * **교차 판정 — 이 함수 하나다.** 그린 것 전부(요소 · 선 조각 · 배지 · 화살표)를 받아 겹친 쌍을 돌려준다. 빈 목록이면 통과다.
 * items: { id, kind, owner, line?, rect }
 *   kind: "element"(칩 · ⊕ · × · •) | "segment"(고전 선 · 양자 제어선의 조각) | "badge" | "arrow"
 *   owner: 그 게이트(열 · 홈 행). line: 고전 선 하나의 id(배지 · 화살표 · 그 선의 조각이 공유한다).
 * 규칙:
 *   · 선 조각 · 화살표는 자기 게이트의 요소(끝점 칩)와만 닿을 수 있다. 다른 게이트의 요소와 겹치면 안 된다.
 *   · 선 조각끼리 · 화살표끼리 · 배지끼리, 그리고 서로 사이도 겹치면 안 된다 — 같은 고전 선(line)의 것은 서로 이어지므로 뺀다.
 *     같은 게이트의 양자선과 고전 선도 뺀다 — 조건부 다중 게이트의 읽는 선은 자기 •·⊕ 에서 자기 제어선과 만나도록 그린다.
 *     같은 게이트의 두 고전 선(조건부 측정의 읽기 · 쓰기)은 서로 겹치면 안 된다.
 *   · 고전 와이어 위 끝점: 선의 마지막 조각은 자기 배지 안에서 끝난다 — 같은 line 이라 빠진다. 와이어 자체는 장애물이 아니다.
 * clearance: 다른 것과는 이만큼 떨어져야 한다(맞닿을 듯 지나가는 선도 걸린다 — 실측에서 0.5px 차로 칩 옆을 스친 선이 있었다).
 */
export function conflicts(items, clearance = 0) {
  const out = [];
  const exempt = (a, b) => {
    if (a.line !== undefined && a.line === b.line) return true; // 같은 고전 선의 조각 · 배지 · 화살표
    if (a.owner !== b.owner) return false;
    const kinds = new Set([a.kind, b.kind]);
    if (kinds.has("element")) return true; // 자기 끝점 칩 · 점
    // 같은 게이트: 양자 조각끼리(끊긴 조각은 서로 닿지 않지만 이어질 수 있다)와 양자 ↔ 고전은 뺀다. 고전 ↔ 고전(다른 line)은 본다.
    const quantum = (x) => x.kind === "segment" && x.line === undefined;
    return quantum(a) || quantum(b);
  };
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      if (a.kind === "element" && b.kind === "element") continue; // 요소끼리는 배치가 정한다(그리기의 일이 아니다)
      if (exempt(a, b)) continue;
      if (overlaps(a.rect, b.rect, clearance)) out.push([a.id, b.id]);
    }
  }
  return out;
}

/**
 * 열 하나의 통로 수를 정한다. 곧게 내린 고전 선이 다른 게이트의 요소 · 양자선이나 다른 고전 선과 하나라도 걸리면 **그 열의
 * 고전 선 전부**가 통로를 쓴다 — 일부만 비키면 남은 직선이 꺾인 선을 가로지를 수 있다(조건부 측정의 두 선, 벌림으로 칩 옆을
 * 스치는 선). 걸리는 것이 없으면 { left: 0, right: 0 } — 예전 그림 그대로다.
 * column: { lines: [{ id, owner, kind:"read"|"write", straight:[점…] }], elements:[{ id, owner, rect }], quantum:[{ id, owner, rect }] }
 */
export function planColumn(column, { lineWidth, clearance }) {
  const items = [
    ...column.elements.map((e) => ({ id: e.id, kind: "element", owner: e.owner, rect: e.rect })),
    ...column.quantum.map((q) => ({ id: q.id, kind: "segment", owner: q.owner, rect: q.rect })),
  ];
  const classical = new Set();
  for (const l of column.lines) {
    pathRects(l.straight, lineWidth).forEach((rect, k) => {
      const id = `${l.id}/${k}`;
      classical.add(id);
      items.push({ id, kind: "segment", owner: l.owner, line: l.id, rect });
    });
  }
  // 고전 선이 낀 충돌만 센다 — 양자 제어선이 칩을 지나는 것은 breakAround 가 따로 끊는다.
  const blocked = conflicts(items, clearance).some(([a, b]) => classical.has(a) || classical.has(b));
  if (!blocked) return { left: 0, right: 0 };
  return {
    left: column.lines.filter((l) => l.kind === "read").length,
    right: column.lines.filter((l) => l.kind === "write").length,
  };
}

/**
 * 통로를 쓰는 열의 고전 선 경로. 넓힌 뒤 실측한 값으로 부른다.
 * lines: [{ id, kind, row, exit:{x,y}, turnY }] — exit 는 출발 요소의 접점(상자 칩은 아래 가장자리의 모서리 쪽, • · ⊕ · × 는
 *   요소 중심), turnY 는 출발 칸의 아래 경계(칸 사이 세로 틈의 가운데).
 * lanes: { left:[x…], right:[x…] } — 안쪽(칩에 가까운 것)부터.
 * **통로 배정: 아래 행에서 시작한 선이 안쪽 통로, 위 행의 선이 바깥 통로.** 그러면 꺾는 가로 구간이 다른 선의 통로를 가로지르지
 * 않는다 — 행 r 의 선은 turnY(r) 높이에서 자기 통로 L(r) 까지만 간다. r 보다 위에서 시작한 선의 통로는 L(r) 보다 바깥이라 닿지
 * 않고, 아래에서 시작한 선의 통로는 turnY(r') > turnY(r) 부터 시작해 그 높이에 아직 없다. 한 행에서 시작하는 선은 쪽마다 하나다
 * (한 칸에는 게이트 하나, 측정의 기록은 하나, 조건도 하나) — 그래서 행 순서만으로 배정이 정해진다.
 * 반환: { id → { points, laneX } }
 */
export function routeLines(lines, lanes, clY) {
  const out = new Map();
  for (const side of ["left", "right"]) {
    const kind = side === "left" ? "read" : "write";
    const mine = lines.filter((l) => l.kind === kind).sort((a, b) => b.row - a.row); // 아래 행부터 → 안쪽 통로부터
    mine.forEach((l, i) => {
      const laneX = lanes[side][i];
      out.set(l.id, {
        laneX,
        points: [l.exit, { x: l.exit.x, y: l.turnY }, { x: laneX, y: l.turnY }, { x: laneX, y: clY }],
      });
    });
  }
  return out;
}

/**
 * 양자 제어선(세로 선분 x, top → bottom)을 장애물 둘레에서 끊은 조각들. 장애물은 관여하지 않는 요소와 다른 선 조각이다 —
 * 틈(gap)만큼 위아래를 비운다. 지나는 것이 없으면 [{ top, bottom }] 하나 — 예전 선 그대로다.
 */
export function breakAround({ x, top, bottom, width }, obstacles, gap) {
  const band = { left: x - width / 2, right: x + width / 2, top, bottom };
  const cuts = obstacles
    .filter((o) => overlaps(band, o, gap))
    .map((o) => [o.top - gap, o.bottom + gap])
    .sort((a, b) => a[0] - b[0]);
  const pieces = [];
  let y = top;
  for (const [a, b] of cuts) {
    if (a > y) pieces.push({ top: y, bottom: Math.min(a, bottom) });
    y = Math.max(y, b);
    if (y >= bottom) break;
  }
  if (y < bottom) pieces.push({ top: y, bottom });
  return pieces.filter((p) => p.bottom - p.top > 0);
}

/**
 * 축 정렬 경로의 이중선 — 경로 양쪽으로 d 만큼 떨어진 두 줄. 모서리에서는 두 조각의 법선을 더해 맞물린다(직각 마이터).
 * 반환: [왼쪽 줄, 오른쪽 줄] — 진행 방향 기준.
 */
export function offsetPolyline(points, d) {
  const normal = (p, q) => {
    const dx = Math.sign(q.x - p.x), dy = Math.sign(q.y - p.y);
    return { x: -dy, y: dx }; // 진행 방향의 왼쪽(화면 좌표에서 y 가 아래로 증가)
  };
  const side = (sign) => points.map((p, i) => {
    const nIn = i > 0 ? normal(points[i - 1], p) : null;
    const nOut = i < points.length - 1 ? normal(p, points[i + 1]) : null;
    const a = nIn ?? nOut, b = nOut ?? nIn;
    const same = a.x === b.x && a.y === b.y;
    const n = same ? a : { x: a.x + b.x, y: a.y + b.y };
    return { x: p.x + sign * d * n.x, y: p.y + sign * d * n.y };
  });
  return [side(1), side(-1)];
}

// ---------------------------------------------------------------- 격자 전체(측정값 → 계획 → 그림)
//
// grid.js 와 테스트가 같은 길을 탄다 — grid.js 는 DOM 에서 잰 값을, 테스트는 style.css 토큰으로 만든 값을 넣는다.
// measured: { clY, columns: [{ col, centerX,
//   rowCells: [{ row, rect }],                          — 그 열의 큐비트 칸(꺾는 높이 = 출발 칸의 아래 경계)
//   elements: [{ id, owner, row, kind:"box"|"dot"|"symbol", rect, glyphHalf? }],
//   links: [{ id, owner, kind:"read"|"write", bit, row }],   — 고전 선(행 = 출발 요소의 행)
//   spans: [{ id, owner, top, bottom }],               — 양자 제어선(위 · 아래 끝 요소의 중심 y)
//   lanes?: { left:[x…], right:[x…] } }] }             — 넓힌 뒤 실측한 통로 x(안쪽부터)
// tok: { lineWidth, qLineWidth, clearance, hop, arrow, badge, spread } — 전부 style.css 토큰이다.

const rowCenter = (column, row) => {
  const r = column.rowCells.find((c) => c.row === row)?.rect;
  return r ? (r.top + r.bottom) / 2 : 0;
};
// 곧게 내리는 선이 한 열에 여럿이면 가운데를 기준으로 spread 씩 벌린다(예전 그림과 같은 규칙 — 간격만 토큰이 됐다).
const straightX = (column, i, spread) => column.centerX + (i - (column.links.length - 1) / 2) * spread;

/** 열마다 통로 수. 반환: Map(col → { left, right }). */
export function planGrid(measured, tok) {
  const plan = new Map();
  for (const column of measured.columns) {
    const lines = column.links.map((l, i) => {
      const x = straightX(column, i, tok.spread);
      return { ...l, straight: [{ x, y: rowCenter(column, l.row) }, { x, y: measured.clY }] };
    });
    // 양자선도 걸림 판정에 넣는다. 지금 치수에서는 결과가 같다(변이 실험 2026-10-31) — 양자선은 끝 요소의 중심 사이라 그 선과
    // 겹치는 고전 선은 끝 요소와도 겹친다. 점이 더 작아지는 등 치수가 바뀌면 이 판정만 남는다.
    const quantum = column.spans.map((s) => ({
      id: s.id, owner: s.owner,
      rect: { left: column.centerX - tok.qLineWidth / 2, right: column.centerX + tok.qLineWidth / 2, top: s.top, bottom: s.bottom },
    }));
    plan.set(column.col, planColumn({ lines, elements: column.elements, quantum }, tok));
  }
  return plan;
}

/**
 * 출발 요소의 접점. 상자 칩(40×40)은 아래 가장자리, 쓰기는 오른쪽 · 읽기는 왼쪽 1/4 지점 — 열 중심을 지나는 양자선을 피하고,
 * 같은 칩의 두 선(조건부 측정)이 반대로 나간다. • · ⊕ · × 는 요소 중심에서 곧게 아래로 — • 는 14px 라 모서리가 허공이고 ⊕ 는
 * 배경이 없어 상자 모서리에 아무것도 없다(지금 양자 제어선이 • · ⊕ 중심에서 시작하는 것과 같은 규칙). contactY 는 읽는 선의 화살표
 * 꼭짓점이 닿는 곳 — 칩 · 점의 아래 가장자리, ⊕ · × 는 글리프 아래(중심 + 글리프 반지름).
 */
function originPoint(el, kind) {
  const cx = (el.rect.left + el.rect.right) / 2, cy = (el.rect.top + el.rect.bottom) / 2;
  if (el.kind === "box") {
    const quarter = (el.rect.right - el.rect.left) / 4;
    const x = kind === "read" ? el.rect.left + quarter : el.rect.right - quarter;
    return { exit: { x, y: el.rect.bottom }, contactY: el.rect.bottom };
  }
  const contactY = el.kind === "dot" ? el.rect.bottom : cy + (el.glyphHalf ?? 0);
  return { exit: { x: cx, y: cy }, contactY };
}

/**
 * 계획대로 그릴 것 전부와, 그것을 판정에 넣을 items. 넓힌 열은 measured.columns[i].lanes 가 있어야 한다.
 * 반환: { columns: [{ col, classical: [{ id, kind, bit, points, badge:{x,y}, arrow }], quantum: [{ id, x, pieces }] }], items }
 */
export function drawGrid(measured, plan, tok) {
  const items = [];
  const columns = [];
  for (const column of measured.columns) {
    const lanes = plan.get(column.col) ?? { left: 0, right: 0 };
    const routed = lanes.left + lanes.right > 0;
    const elOf = (row) => column.elements.find((e) => e.row === row);
    for (const e of column.elements) items.push({ id: e.id, kind: "element", owner: e.owner, rect: e.rect });

    const origins = new Map(column.links.map((l) => [l.id, originPoint(elOf(l.row), l.kind)]));
    let paths;
    if (routed) {
      const routes = routeLines(column.links.map((l) => ({
        id: l.id, kind: l.kind, row: l.row, exit: origins.get(l.id).exit,
        turnY: column.rowCells.find((c) => c.row === l.row).rect.bottom,
      })), column.lanes, measured.clY);
      paths = column.links.map((l) => ({ link: l, ...routes.get(l.id) }));
    } else {
      paths = column.links.map((l, i) => {
        const x = straightX(column, i, tok.spread);
        return { link: l, laneX: x, points: [{ x, y: rowCenter(column, l.row) }, { x, y: measured.clY }] };
      });
    }
    const classical = paths.map(({ link, laneX, points }) => {
      const badge = { x: laneX, y: measured.clY };
      const arrow = link.kind === "write"
        ? arrowHead({ x: laneX, y: measured.clY - tok.badge / 2 }, "down", tok.arrow)
        : arrowHead({ x: routed ? origins.get(link.id).exit.x : laneX, y: origins.get(link.id).contactY }, "up", tok.arrow);
      pathRects(points, tok.lineWidth).forEach((rect, k) => items.push({ id: `${link.id}/${k}`, kind: "segment", owner: link.owner, line: link.id, rect }));
      items.push({ id: `${link.id}/badge`, kind: "badge", owner: link.owner, line: link.id,
        rect: { left: badge.x - tok.badge / 2, right: badge.x + tok.badge / 2, top: badge.y - tok.badge / 2, bottom: badge.y + tok.badge / 2 } });
      items.push({ id: `${link.id}/arrow`, kind: "arrow", owner: link.owner, line: link.id, rect: arrow.rect });
      return { id: link.id, kind: link.kind, bit: link.bit, gate: link.gate, points, badge, arrow };
    });

    // 양자 제어선: 관여하지 않는 요소 · 다른 게이트의 고전 선 · 다른 span 둘레에서 끊는다(고전 선을 먼저 정한 뒤).
    const quantum = column.spans.map((s) => {
      const band = (o) => ({ left: column.centerX - tok.qLineWidth / 2, right: column.centerX + tok.qLineWidth / 2, top: o.top, bottom: o.bottom });
      const obstacles = [
        ...column.elements.filter((e) => e.owner !== s.owner).map((e) => e.rect),
        ...classical.filter((c) => column.links.find((l) => l.id === c.id).owner !== s.owner)
          .flatMap((c) => pathRects(c.points, tok.lineWidth)),
        ...column.spans.filter((o) => o.owner !== s.owner).map(band),
      ];
      const pieces = breakAround({ x: column.centerX, top: s.top, bottom: s.bottom, width: tok.qLineWidth }, obstacles, tok.hop);
      pieces.forEach((p, k) => items.push({ id: `${s.id}/${k}`, kind: "segment", owner: s.owner, rect: band(p) }));
      return { id: s.id, x: column.centerX, pieces };
    });
    columns.push({ col: column.col, routed, classical, quantum });
  }
  return { columns, items };
}

/**
 * 화살표 — 꼭짓점이 tip 에 오는 이등변 삼각형. dir 은 꼭짓점이 향하는 쪽("down" = 쓰는 선이 고전 와이어로, "up" = 읽는 선이
 * 칩으로). 반환: { points: [꼭짓점, 밑변 둘], rect }.
 */
export function arrowHead(tip, dir, size) {
  const back = dir === "down" ? -size : size;
  const points = [tip, { x: tip.x - size / 2, y: tip.y + back }, { x: tip.x + size / 2, y: tip.y + back }];
  return {
    points,
    rect: { left: tip.x - size / 2, right: tip.x + size / 2, top: Math.min(tip.y, tip.y + back), bottom: Math.max(tip.y, tip.y + back) },
  };
}
