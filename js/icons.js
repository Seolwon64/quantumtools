// 아이콘 세트: Lucide (https://lucide.dev) — ISC License, © Lucide Contributors.
//
// **npm 패키지를 쓰지 않는다.** 이 프로젝트는 빌드 도구가 없는 vanilla JS ES 모듈이고,
// 아이콘 하나 때문에 의존성과 번들 단계를 들이지 않는다. lucide.dev에서 SVG를 복사해
// 24×24 그리드의 **경로 본문만** 여기에 옮겨 담았다(원본 path 데이터를 그대로 유지).
//
// 정의는 이 파일 한 곳뿐이다. index.html은 `<span data-icon="undo-2">` 같은 자리표시자만
// 두고 hydrateIcons()가 채운다 — HTML과 JS에 같은 SVG를 두 벌 두면 반드시 어긋난다
// (예전에 3D 씬 색이 CSS 램프와 조용히 어긋났던 것과 같은 실패다).
//
// 규격은 아래 상수 두 개가 전부다. 개별 호출부에서 크기·굵기를 다시 정하지 마라 —
// 그러면 "한 세트로 보인다"는 성질이 즉시 깨진다.

/** 도구 UI 기준 크기. Lucide 기본 24px는 이런 밀도의 툴바에서는 크다. */
export const ICON_SIZE = 16;
/** Lucide 기본 stroke-width는 2. 16px에서 2는 두꺼워 1.5로 얇게 쓴다. */
export const ICON_STROKE = 1.5;

// 경로 본문(24×24 viewBox 기준). 키 이름은 Lucide 아이콘 이름 그대로 둔다 —
// 나중에 원본과 대조할 때 이름이 다르면 확인이 불가능해진다.
const PATHS = {
  // --- 상단 툴바 ---
  menu: '<line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/>',
  "undo-2": '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>',
  "redo-2": '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  code: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
  "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  github:
    '<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/>',

  // --- 재생 컨트롤 ---
  "skip-back": '<polygon points="19 20 9 12 19 4 19 20"/><line x1="5" x2="5" y1="19" y2="5"/>',
  "step-back": '<line x1="18" x2="18" y1="20" y2="4"/><polygon points="14,20 4,12 14,4"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
  "step-forward": '<line x1="6" x2="6" y1="4" y2="20"/><polygon points="10,4 20,12 10,20"/>',

  // --- 3D 뷰 ---
  "rotate-ccw": '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',

  // --- Inspect 모드 (궤적 다시 뽑기) ---
  dice: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 8h.01"/><path d="M16 8h.01"/><path d="M12 12h.01"/><path d="M8 16h.01"/><path d="M16 16h.01"/>',

  // --- 게이트 컨텍스트 메뉴 ---
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  pencil:
    '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  "unfold-horizontal":
    '<path d="M16 12h6"/><path d="M8 12H2"/><path d="M12 18v2"/><path d="M12 14v2"/><path d="M12 10v2"/><path d="M12 6v2"/><path d="M12 2v2"/><path d="m19 15 3-3-3-3"/><path d="m5 9-3 3 3 3"/>',
  "circle-plus": '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/>',
  "circle-minus": '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/>',
  binary:
    '<rect x="14" y="14" width="4" height="6" rx="2"/><rect x="6" y="4" width="4" height="6" rx="2"/><path d="M6 20h4"/><path d="M14 10h4"/><path d="M6 14h2v6"/><path d="M14 4h2v6"/>',
  "trash-2":
    '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',

  // --- 알림 ---
  "triangle-alert":
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
};

/** 정의된 아이콘 이름 목록(검증용). */
export const ICON_NAMES = Object.keys(PATHS);

/**
 * 아이콘 SVG 문자열.
 * `fill="none"` + `stroke="currentColor"` 라서 **색은 부모가 정한다** —
 * 색상 토큰이 바뀌거나 밝은/어두운 배경으로 옮겨도 아이콘이 따라온다.
 * `aria-hidden`인 이유: 의미는 버튼의 aria-label이 전달한다(아이콘은 장식).
 */
export function icon(name, size = ICON_SIZE) {
  const body = PATHS[name];
  if (!body) {
    console.warn(`icon(): 정의되지 않은 이름 "${name}"`);
    return "";
  }
  return (
    `<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"` +
    ` width="${size}" height="${size}" fill="none" stroke="currentColor"` +
    ` stroke-width="${ICON_STROKE}" stroke-linecap="round" stroke-linejoin="round"` +
    ` aria-hidden="true" focusable="false">${body}</svg>`
  );
}

/**
 * `<span data-icon="name">` 자리표시자를 실제 SVG로 채운다.
 * 이미 채워진 것은 건너뛰므로 여러 번 불러도 안전하다(부분 렌더 후 재호출 등).
 */
export function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll("[data-icon]")) {
    if (el.firstElementChild?.tagName?.toLowerCase() === "svg") continue;
    el.innerHTML = icon(el.dataset.icon);
  }
}
