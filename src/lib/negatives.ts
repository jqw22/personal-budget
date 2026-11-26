/**
 * Shows every negative figure in red, wherever it appears: table cells, totals, typed-in boxes and
 * chart labels. Rather than touch every place a number is printed, this watches the page and marks
 * any element whose text (or box value) is just a minus sign and a number.
 */
const NEGATIVE = /^[-−]\s?\d[\d,]*(\.\d+)?$/;
const CLASS = 'negative';

function check(el: Element) {
  let text: string | null = null;
  if (el instanceof HTMLInputElement) text = el.value;
  else if (el.children.length === 0) text = el.textContent;
  if (text === null) return;
  el.classList.toggle(CLASS, NEGATIVE.test(text.trim()));
}

function checkAll(root: Element) {
  check(root);
  for (const el of root.querySelectorAll('td, th, span, button, div, p, input, text, strong, b')) check(el);
}

export function watchNegatives(root: HTMLElement) {
  let queued = false;
  const run = () => {
    queued = false;
    checkAll(root);
  };
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(run);
  });
  observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['value'] });
  // Typing changes a box's value without changing the page.
  root.addEventListener('input', (e) => e.target instanceof HTMLInputElement && check(e.target));
  root.addEventListener('focusout', (e) => e.target instanceof HTMLInputElement && requestAnimationFrame(() => check(e.target as Element)));
  run();
}
