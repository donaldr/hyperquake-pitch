// Shared audio mute state
let muted = false;
const listeners = [];

export function isMuted() {
  return muted;
}

export function setMuted(value) {
  muted = value;
  listeners.forEach((fn) => fn(muted));
}

export function onMuteChange(fn) {
  listeners.push(fn);
}
