// Guide lines between a bullet and its children (note menu switch). Kept in this browser, for all notes;
// shown or hidden through an attribute on <html> (index.css), so no row has to re-render.
const KEY = 'mindsift_bullet_guides';

export function bulletGuidesOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function applyBulletGuides(on = bulletGuidesOn()) {
  if (typeof document === 'undefined') return;
  if (on) document.documentElement.removeAttribute('data-bullet-guides');
  else document.documentElement.setAttribute('data-bullet-guides', 'off');
}

export function setBulletGuides(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // private mode: only for this page
  }
  applyBulletGuides(on);
}
