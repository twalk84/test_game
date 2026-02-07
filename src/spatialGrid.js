const CELL_SIZE = 20;

export class SpatialGrid {
  constructor(worldSize) {
    this.cellSize = CELL_SIZE;
    this.worldHalf = worldSize / 2;
    this.gridSize = Math.ceil(worldSize / CELL_SIZE);
    this.cells = new Map();
  }

  _key(cx, cz) {
    return cx * 10000 + cz;
  }

  _cellCoord(val) {
    return Math.floor((val + this.worldHalf) / this.cellSize);
  }

  clear() {
    this.cells.clear();
  }

  insert(entity) {
    const cx = this._cellCoord(entity.mesh.position.x);
    const cz = this._cellCoord(entity.mesh.position.z);
    const key = this._key(cx, cz);
    let cell = this.cells.get(key);
    if (!cell) {
      cell = [];
      this.cells.set(key, cell);
    }
    cell.push(entity);
  }

  query(x, z, radius) {
    const results = [];
    const minCx = this._cellCoord(x - radius);
    const maxCx = this._cellCoord(x + radius);
    const minCz = this._cellCoord(z - radius);
    const maxCz = this._cellCoord(z + radius);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const cell = this.cells.get(this._key(cx, cz));
        if (cell) {
          for (const entity of cell) {
            results.push(entity);
          }
        }
      }
    }
    return results;
  }

  // Rebuild entire grid from entity array
  rebuild(entities) {
    this.clear();
    for (const e of entities) {
      if (e.alive) this.insert(e);
    }
  }
}
