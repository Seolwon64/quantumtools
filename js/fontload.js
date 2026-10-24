// 폰트 면이 새로 도착할 때마다(첫 적재와 늦게 온 분할 면) 콜백을 한 프레임에 한 번 부른다 — 글자를 재는 곳이 다시 재게.
//
// fonts.ready 한 번으로는 모자라다: IBM Plex 분할 면은 그 범위의 글자가 처음 나올 때 받는다. 게이트 행렬의 √ 가 Mono Pi 면을
// 1.7초 뒤에 불렀는데 그때는 ready 가 이미 풀려 있어 다시 재는 곳이 없었다(실측). 그래서 loadingdone 을 듣는다.
// 그런데 loadingdone 은 구독하기 **전에** 끝난 적재를 알려 주지 않는다. ready 는 프로미스라 언제 구독해도 한 번 풀린다 —
// 그래서 둘 다 듣고, 같은 프레임 묶기로 합친다(면이 여럿 연달아 오면 이벤트가 몰리는데 다시 재기는 한 번이면 된다).
//
// fonts·raf 는 테스트가 가짜를 넣는 자리다. 기본값은 브라우저의 것.
export function onFontFacesLoaded(callback, {
  fonts = globalThis.document?.fonts,
  raf = (fn) => globalThis.requestAnimationFrame(fn),
} = {}) {
  if (!fonts) return () => {};
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    raf(() => {
      scheduled = false;
      callback();
    });
  };
  fonts.addEventListener("loadingdone", schedule);
  fonts.ready?.then(schedule);
  return () => fonts.removeEventListener("loadingdone", schedule);
}
