function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export class InventorySystem {
  constructor() {
    this.resources = {
      scrap: 0,
      crystal: 0,
    };
    this.consumables = {
      medkit: 0,
    };
    this.mods = {
      rifleStabilizer: 0,
      pulseCapacitor: 0,
    };
  }

  addResource(type, amount = 1) {
    if (!Object.prototype.hasOwnProperty.call(this.resources, type)) return;
    this.resources[type] = Math.max(0, this.resources[type] + Math.max(0, numberOr(amount, 0)));
  }

  addConsumable(type, amount = 1) {
    if (!Object.prototype.hasOwnProperty.call(this.consumables, type)) return;
    this.consumables[type] = Math.max(0, this.consumables[type] + Math.max(0, numberOr(amount, 0)));
  }

  consumeConsumable(type, amount = 1) {
    if (!Object.prototype.hasOwnProperty.call(this.consumables, type)) return false;
    const needed = Math.max(1, numberOr(amount, 1));
    if (this.consumables[type] < needed) return false;
    this.consumables[type] -= needed;
    return true;
  }

  getSummaryText() {
    return `Scrap ${this.resources.scrap} • Crystal ${this.resources.crystal} • Medkit ${this.consumables.medkit}`;
  }

  getSaveState() {
    return {
      resources: { ...this.resources },
      consumables: { ...this.consumables },
      mods: { ...this.mods },
    };
  }

  applySaveState(saved) {
    if (!saved) {
      this.resources = { scrap: 0, crystal: 0 };
      this.consumables = { medkit: 0 };
      this.mods = { rifleStabilizer: 0, pulseCapacitor: 0 };
      return;
    }

    const resources = saved.resources || {};
    const consumables = saved.consumables || {};
    const mods = saved.mods || {};

    this.resources = {
      scrap: Math.max(0, numberOr(resources.scrap, 0)),
      crystal: Math.max(0, numberOr(resources.crystal, 0)),
    };

    this.consumables = {
      medkit: Math.max(0, numberOr(consumables.medkit, 0)),
    };

    this.mods = {
      rifleStabilizer: Math.max(0, numberOr(mods.rifleStabilizer, 0)),
      pulseCapacitor: Math.max(0, numberOr(mods.pulseCapacitor, 0)),
    };
  }
}