// 햄버거 메뉴 드로어.
//
// 고르면 바로 닫히는 일시적 UI라 **오버레이로 뒤를 딤 처리**해 집중시킨다.
// (항목이 여는 패널들 — 예: 코드 패널 — 은 반대로 오버레이를 두지 않는다.
//  회로를 보면서 쓰는 도구라 뒤를 가리면 목적이 사라지기 때문이다.)
//
// 애니메이션은 transform: translateX 만 쓴다. width/left 를 움직이면 매 프레임 레이아웃이
// 다시 계산돼 끊긴다. `hidden`(display:none)도 쓰지 않는다 — display:none 에서는 transition 이
// 아예 실행되지 않아 슬라이드가 사라진다. 열림은 .is-open, 닫힘은 visibility:hidden 이다.

import { icon } from "./icons.js";

/**
 * 메뉴 항목 정의. 마크업이 아니라 **데이터**로 둔다 — 그룹이 늘어도 HTML을 손대지 않는다.
 * 배열 하나가 그룹 하나이고, 그룹 경계에만 구분선이 들어간다.
 *
 * `kind`가 "패널을 여는 항목"과 "페이지를 이동하는 항목"을 가른다. 지금은 전부 "panel"이고
 * 페이지 이동은 만들지 않는다 — 쓰이지 않는 분기를 미리 만들면 그게 곧 죽은 코드다.
 * 나중에 필요해지면 kind:"link" 를 더하고 <a href> 로 렌더하면 된다.
 *
 * **자리표시자나 비활성 항목을 넣지 않는다.** 미구현 항목이 보이면 앱 전체가 미완성으로 읽힌다.
 * Gate reference / Keyboard shortcuts / Settings / About 은 각자 구현될 때 그룹으로 추가한다.
 */
export const MENU_GROUPS = [
  [{ id: "code", label: "Code editor", icon: "code", kind: "panel" }],
];

export function initMenu({ menuBtn, overlay, drawer, body }) {
  let items = [];
  let index = 0;
  let lastFocused = null;

  // 항목이 실행할 동작. main.js 가 setAction 으로 주입한다 —
  // 메뉴는 "무엇을 여는지" 몰라도 되고, 패널 모듈도 메뉴를 몰라도 된다.
  const ACTIONS = {};

  // ---------- 메뉴 드로어 ----------
  const isOpen = () => drawer.classList.contains("is-open");

  /** roving tabindex: 포커스를 받는 항목만 tabIndex 0 — Tab 한 번에 목록을 통과한다. */
  function focusAt(i) {
    if (!items.length) return;
    index = (i + items.length) % items.length;
    items.forEach((el, j) => { el.tabIndex = j === index ? 0 : -1; });
    items[index].focus();
  }

  function build() {
    body.innerHTML = "";
    items = [];
    MENU_GROUPS.forEach((group, g) => {
      if (g > 0) {
        const sep = document.createElement("div");
        sep.className = "menu-drawer-sep";
        body.appendChild(sep);
      }
      for (const item of group) {
        const btn = document.createElement("button");
        btn.className = "menu-drawer-item";
        btn.dataset.id = item.id;
        // 패널을 여는 항목임을 마크업에 남긴다 — 페이지 이동(<a href>)과 구분되는 지점.
        if (item.kind === "panel") btn.setAttribute("aria-haspopup", "dialog");
        btn.innerHTML = `${icon(item.icon)}<span class="menu-drawer-label">${item.label}</span>`;
        btn.tabIndex = -1;
        btn.addEventListener("click", () => {
          close({ restoreFocus: false }); // 항목이 연 패널로 포커스가 가야 한다
          ACTIONS[item.id]?.();
        });
        body.appendChild(btn);
        items.push(btn);
      }
    });
  }

  function open() {
    if (isOpen()) return;
    lastFocused = document.activeElement;
    build();
    overlay.classList.add("is-open");
    drawer.classList.add("is-open");
    menuBtn.setAttribute("aria-expanded", "true");
    setHamburger(true);
    focusAt(0);
  }

  /**
   * @param restoreFocus 닫은 뒤 햄버거로 포커스를 되돌릴지.
   *   항목을 실행해 다른 패널이 열리는 경우에는 되돌리지 않는다 — 새 패널이 포커스를 가져간다.
   */
  function close({ restoreFocus = true } = {}) {
    if (!isOpen()) return;
    overlay.classList.remove("is-open");
    drawer.classList.remove("is-open");
    menuBtn.setAttribute("aria-expanded", "false");
    setHamburger(false);
    if (restoreFocus) (lastFocused ?? menuBtn).focus();
  }

  /** 열린 상태에서 햄버거는 곧 닫기(X) 버튼이다. 아이콘과 이름을 함께 바꾼다. */
  function setHamburger(open) {
    menuBtn.innerHTML = icon(open ? "x" : "menu");
    menuBtn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    menuBtn.title = open ? "Close menu" : "Menu";
  }

  // ---------- 이벤트 ----------
  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation(); // document 핸들러가 방금 연 드로어를 바깥 클릭으로 보지 않게
    if (isOpen()) close(); else open();
  });

  overlay.addEventListener("click", () => close());

  // 포커스 트랩. 순환 대상에 menuBtn 을 넣는 이유: 열린 상태에서 이 버튼이 곧 X(닫기)라
  // 드로어 바깥에 있어도 논리적으로 이 다이얼로그의 일부다 — 빼면 키보드로 닫기에 갈 수 없다.
  const trapOrder = () => [...items, menuBtn];

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen()) { e.preventDefault(); close(); return; }
    if (!isOpen()) return;

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      focusAt(index + (e.key === "ArrowDown" ? 1 : -1));
      return;
    }
    if (e.key === "Tab") {
      const order = trapOrder();
      const at = order.indexOf(document.activeElement);
      e.preventDefault(); // 트랩: 드로어 밖으로 새지 않게 우리가 직접 옮긴다
      const next = order[((at < 0 ? 0 : at + (e.shiftKey ? -1 : 1)) + order.length) % order.length];
      // 항목으로 돌아오면 roving tabindex 도 같이 맞춘다(다음 방향키가 엉뚱한 데서 시작하지 않게)
      const j = items.indexOf(next);
      if (j >= 0) focusAt(j); else next.focus();
    }
  });

  setHamburger(false);
  return {
    open,
    close,
    /** 항목 id 에 동작을 연결한다(main.js 가 패널을 만든 뒤 호출). */
    setAction(id, fn) { ACTIONS[id] = fn; },
  };
}
