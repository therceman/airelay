const DEFAULT_MAX_BUFFER_BYTES = 512;

/** Detects a fresh working hint after one particular submit attempt. */
export class PostSubmitWorkingDetector {
  private buffer = '';
  private detected = false;

  constructor(
    private readonly hint: string,
    private readonly maxBufferBytes = DEFAULT_MAX_BUFFER_BYTES
  ) {}

  reset(): void {
    this.buffer = '';
    this.detected = false;
  }

  observe(chunk: string): boolean {
    if (this.detected || !this.hint || !chunk) return this.detected;
    this.buffer = `${this.buffer}${chunk}`.slice(-this.maxBufferBytes);
    this.detected = this.buffer.includes(this.hint);
    return this.detected;
  }

  hasDetected(): boolean {
    return this.detected;
  }
}
