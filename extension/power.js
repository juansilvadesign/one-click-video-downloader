export class PowerLeaseManager {
  constructor({ hasPermission, requestKeepAwake, releaseKeepAwake }) {
    this.hasPermission = hasPermission;
    this.requestKeepAwake = requestKeepAwake;
    this.releaseKeepAwake = releaseKeepAwake;
    this.active = new Set();
    this.held = false;
    this.pending = Promise.resolve();
  }

  enqueue(operation) {
    this.pending = this.pending.then(operation, operation);
    return this.pending;
  }

  acquire(jobId) {
    this.active.add(jobId);
    return this.enqueue(async () => {
      if (this.held || !this.active.size || !(await this.hasPermission())) return false;
      this.requestKeepAwake("system");
      this.held = true;
      return true;
    });
  }

  release(jobId) {
    this.active.delete(jobId);
    return this.enqueue(async () => {
      if (this.active.size || !this.held) return false;
      this.releaseKeepAwake();
      this.held = false;
      return true;
    });
  }

  reset() {
    this.active.clear();
    return this.enqueue(async () => {
      if (!this.held) return false;
      this.releaseKeepAwake();
      this.held = false;
      return true;
    });
  }
}
