/** Насколько близко к низу считается «у конца»: пиксель-другой округления не отрывает. */
const BOTTOM_SLACK = 8;

/**
 * Окно, которое держится у конца растущего текста — лог идущего шага. Держится, пока человек
 * сам не отмотал вверх; отмотал обратно вниз — снова держится. Стор отображения (решение 0042):
 * вид отдаёт ему элемент `ref={follow.hold}`, а следит за ним стор — без эффектов в React.
 *
 * Один стор держит сколько угодно окон: у каждого своё «у конца», и снимается оно вместе с
 * элементом.
 */
export class FollowBottom {
  readonly hold = (element: HTMLElement | null): (() => void) | undefined => {
    if (!element) return undefined;
    let stuck = true;
    const toEnd = () => {
      if (stuck) element.scrollTop = element.scrollHeight;
    };
    const onScroll = () => {
      stuck = element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_SLACK;
    };
    const observer = new MutationObserver(toEnd);
    observer.observe(element, { childList: true, characterData: true, subtree: true });
    element.addEventListener("scroll", onScroll);
    toEnd();
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", onScroll);
    };
  };
}
