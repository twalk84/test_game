// Lightweight publish/subscribe event bus for decoupling game systems.

class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  on(event, fn) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    const set = this.listeners.get(event);
    if (set) set.delete(fn);
  }

  emit(event, data) {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of set) {
      fn(data);
    }
  }
}

export const events = new EventBus();
