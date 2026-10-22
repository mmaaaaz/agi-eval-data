export interface ScrollBox { scrollTop: number }
export interface ScrollSlot { top: number }

/** Capture the grid offset before a full-screen modal takes over. */
export function rememberScroll(el: ScrollBox | null, slot: ScrollSlot): void {
  if (el) slot.top = el.scrollTop;
}

/** Put the grid back after the modal closes; safe on the first render. */
export function restoreScroll(el: ScrollBox | null, slot: ScrollSlot): void {
  if (el) el.scrollTop = slot.top;
}
