export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  maxAttempts?: number;
}

export class Backoff {
  private attempt = 0;
  private maxAttempts: number;
  private baseMs: number;
  private maxMs: number;

  constructor(opts?: BackoffOptions) {
    this.baseMs = opts?.baseMs ?? 1000;
    this.maxMs = opts?.maxMs ?? 30000;
    this.maxAttempts = opts?.maxAttempts ?? Infinity;
  }

  next(): number {
    const delay = Math.min(
      this.baseMs * Math.pow(2, this.attempt) * (0.5 + Math.random()),
      this.maxMs
    );
    this.attempt++;
    return Math.floor(delay);
  }

  reset(): void {
    this.attempt = 0;
  }

  shouldRetry(): boolean {
    return this.attempt < this.maxAttempts;
  }
}
