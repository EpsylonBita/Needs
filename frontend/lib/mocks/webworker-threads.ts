/**
 * Mock implementation of webworker-threads
 * This provides empty implementations to satisfy imports without requiring the native module
 */

export interface Thread {
  id: number;
  eval(code: string): unknown;
  load(filename: string): void;
  on(event: string, callback: (err?: Error, result?: unknown) => void): void;
  once(event: string, callback: (err?: Error, result?: unknown) => void): void;
  addEventListener(event: string, callback: (err?: Error, result?: unknown) => void): void;
  removeEventListener(event: string, callback: (err?: Error, result?: unknown) => void): void;
  emit(event: string, ...args: unknown[]): void;
  destroy(callback?: () => void): void;
}

export class Worker {
  private static idCounter = 0;
  public id: number;

  constructor() {
    this.id = Worker.idCounter++;
  }

  eval(_code: string): unknown {
    console.warn('Mock webworker-threads: eval called but not implemented');
    return null;
  }

  load(_filename: string): void {
    console.warn('Mock webworker-threads: load called but not implemented');
  }

  on(_event: string, _callback: (err?: Error, result?: unknown) => void): void {
    console.warn('Mock webworker-threads: on called but not implemented');
  }

  once(_event: string, _callback: (err?: Error, result?: unknown) => void): void {
    console.warn('Mock webworker-threads: once called but not implemented');
  }

  addEventListener(_event: string, _callback: (err?: Error, result?: unknown) => void): void {
    console.warn('Mock webworker-threads: addEventListener called but not implemented');
  }

  removeEventListener(_event: string, _callback: (err?: Error, result?: unknown) => void): void {
    console.warn('Mock webworker-threads: removeEventListener called but not implemented');
  }

  emit(_event: string, ..._args: unknown[]): void {
    console.warn('Mock webworker-threads: emit called but not implemented');
  }

  destroy(callback?: () => void): void {
    console.warn('Mock webworker-threads: destroy called but not implemented');
    if (callback) callback();
  }
}

export class Pool {
  private size: number;
  
  constructor(size: number = 4) {
    this.size = size;
  }

  any(task: (callback: (err: Error | null, result?: unknown) => void) => void, callback: (err: Error | null, result?: unknown) => void): void {
    // Just execute the task in the main thread as a fallback
    setTimeout(() => {
      task(callback);
    }, 0);
  }

  all<T = unknown>(task: (index: number, callback: (err: Error | null, result?: T) => void) => void, callback: (err: Error | null, results?: T[]) => void): void {
    const results: T[] = [];
    let completed = 0;
    
    for (let i = 0; i < this.size; i++) {
      setTimeout(() => {
        task(i, (err, result) => {
          if (err) {
            callback(err);
            return;
          }
          
          results[i] = result as T;
          completed++;
          
          if (completed === this.size) {
            callback(null, results);
          }
        });
      }, 0);
    }
  }

  destroy(): void {
    console.warn('Mock webworker-threads: Pool.destroy called but not implemented');
  }
}

// Create a default export that mimics the original module
const thread = {
  Worker,
  Pool,
  create: (): Thread => {
    return new Worker() as unknown as Thread;
  }
};

export default thread; 
