// Starting the guided tour from anywhere (the help page's button, the offer after the first sign-in); GuidedTour, mounted once in App, listens
const START_EVENT = 'mindsift:tour-start';

export function requestTourStart() {
  window.dispatchEvent(new Event(START_EVENT));
}

export function onTourStartRequest(handler: () => void): () => void {
  window.addEventListener(START_EVENT, handler);
  return () => window.removeEventListener(START_EVENT, handler);
}
