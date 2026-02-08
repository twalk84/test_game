function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export class InventorySystem {
  constructor() {
    this.resources = {
      scrap: 0,
      crystal: 0,
      alloy: 0,
    };
    this.consumables = {
      medkit: 0,
      stim: 0,
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

  canAfford(cost = {}) {
    for (const [resource, amount] of Object.entries(cost)) {
      const needed = Math.max(0, numberOr(amount, 0));
      const have = numberOr(this.resources[resource], 0);
      if (have < needed) return false;
    }
    return true;
  }

  spendResources(cost = {}) {
    if (!this.canAfford(cost)) return false;
    for (const [resource, amount] of Object.entries(cost)) {
      this.resources[resource] = Math.max(0, numberOr(this.resources[resource], 0) - Math.max(0, numberOr(amount, 0)));
    }
    return true;
  }

  craftConsumable(type) {
    if (type === "medkit") {
      const paid = this.spendResources({ scrap: 4, crystal: 1 });
      if (!paid) return { ok: false, reason: "Need 4 scrap + 1 crystal" };
      this.addConsumable("medkit", 1);
      return { ok: true, crafted: "medkit" };
    }

    if (type === "stim") {
      const paid = this.spendResources({ scrap: 3, alloy: 1 });
      if (!paid) return { ok: false, reason: "Need 3 scrap + 1 alloy" };
      this.addConsumable("stim", 1);
      return { ok: true, crafted: "stim" };
    }

    return { ok: false, reason: "Unknown recipe" };
  }

  getSummaryText() {
    return `Scrap ${this.resources.scrap} • Crystal ${this.resources.crystal} • Alloy ${this.resources.alloy} • Medkit ${this.consumables.medkit} • Stim ${this.consumables.stim}`;
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
      this.resources = { scrap: 0, crystal: 0, alloy: 0 };
      this.consumables = { medkit: 0, stim: 0 };
      this.mods = { rifleStabilizer: 0, pulseCapacitor: 0 };
      return;
    }

    const resources = saved.resources || {};
    const consumables = saved.consumables || {};
    const mods = saved.mods || {};

    this.resources = {
      scrap: Math.max(0, numberOr(resources.scrap, 0)),
      crystal: Math.max(0, numberOr(resources.crystal, 0)),
      alloy: Math.max(0, numberOr(resources.alloy, 0)),
    };

    this.consumables = {
      medkit: Math.max(0, numberOr(consumables.medkit, 0)),
      stim: Math.max(0, numberOr(consumables.stim, 0)),
    };

    this.mods = {
      rifleStabilizer: Math.max(0, numberOr(mods.rifleStabilizer, 0)),
      pulseCapacitor: Math.max(0, numberOr(mods.pulseCapacitor, 0)),
    };
  }
}