// A sentence was just read: bring the timeline it draws into view, but never so far that the line of chips (what the sentence
// was read as) leaves the top of the window, and bring the chips back if they were left above it.
export function bringIn(timeline: HTMLElement | null, chips: HTMLElement | null, reduced: boolean): void {
  if (!timeline) return;
  const behavior = reduced ? 'auto' : 'smooth';
  let box: HTMLElement | null = timeline.parentElement;
  while (box && !/(auto|scroll)/.test(getComputedStyle(box).overflowY)) box = box.parentElement;
  if (!box || typeof box.scrollBy !== 'function') { timeline.scrollIntoView?.({ block: 'nearest', behavior }); return; }
  const view = box.getBoundingClientRect();
  const need = timeline.getBoundingClientRect().bottom - view.bottom + 16; // above 0: the timeline's end is below the window
  const room = chips ? chips.getBoundingClientRect().top - view.top - 12 : Infinity; // below 0: the chips are above the window
  if (room < 0) box.scrollBy({ top: room, behavior });
  else if (need > 0) box.scrollBy({ top: Math.min(need, room), behavior });
}
