interface PendingCommit {
  greetingId: number
  finish(committed: boolean): void
}

// A DOM commit does not depend on animation frames or a foreground tab.
export default class GreetingCommitGate {
  private pending: PendingCommit | null = null

  wait (greetingId: number, timeoutMs = 1500): Promise<boolean> {
    this.cancel()
    return new Promise((resolve) => {
      const pending: PendingCommit = {
        greetingId,
        finish: (committed) => {
          if (this.pending !== pending) return
          this.pending = null
          clearTimeout(timer)
          resolve(committed)
        },
      }
      const timer = setTimeout(() => pending.finish(false), timeoutMs)
      this.pending = pending
    })
  }

  confirm (greetingId: number) {
    if (this.pending?.greetingId === greetingId) this.pending.finish(true)
  }

  cancel () {
    this.pending?.finish(false)
  }
}
