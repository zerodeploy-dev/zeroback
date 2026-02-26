export class Backoff {
  private attempt = 0;
  private maxAttempts = 10;
  private baseMs = 100;
  private maxMs = 10000;

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
