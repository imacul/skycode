// Streaming utilities for handling AI responses

/**
 * Stream chunk type
 */
export interface StreamChunk {
  content: string;
  done: boolean;
  error?: Error;
  metadata?: Record<string, unknown>;
}

/**
 * Stream callback type
 */
export type StreamCallback<T = string> = (chunk: T) => void;

/**
 * Stream error handler
 */
export type StreamErrorHandler = (error: Error) => void;

/**
 * Stream completion handler
 */
export type StreamCompleteHandler = () => void;

/**
 * Options for creating a stream
 */
export interface StreamOptions<T> {
  /** Initial value */
  initialValue?: T;
  /** Buffer size for backpressure */
  bufferSize?: number;
  /** Debounce time in ms */
  debounceTime?: number;
}

/**
 * Create a writable stream from callbacks
 */
export function createWritableStream<T = string>(
  onData: StreamCallback<T>,
  onError?: StreamErrorHandler,
  onComplete?: StreamCompleteHandler
): WritableStream<T> {
  return new WritableStream<T>({
    write(chunk) {
      onData(chunk);
    },
    abort(error) {
      if (onError) {
        onError(error);
      }
    },
    close() {
      if (onComplete) {
        onComplete();
      }
    },
  });
}

/**
 * Create a readable stream from an async generator
 */
export async function* fromAsyncGenerator<T>(
  generator: AsyncGenerator<T>
): AsyncGenerator<T> {
  for await (const chunk of generator) {
    yield chunk;
  }
}

/**
 * Transform stream chunks
 */
export function transformStream<T, U>(
  stream: ReadableStream<T>,
  transformer: (chunk: T) => U
): ReadableStream<U> {
  return new ReadableStream<U>({
    async start(controller) {
      const reader = stream.getReader();
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            break;
          }
          controller.enqueue(transformer(value));
        }
      } catch (error) {
        controller.error(error as Error);
      }
    },
  });
}

/**
 * Buffer stream chunks for batching
 */
export function bufferStream<T>(
  stream: ReadableStream<T>,
  options: {
    size?: number;
    timeout?: number;
  } = {}
): ReadableStream<T[]> {
  const { size = 10, timeout = 100 } = options;
  
  return new ReadableStream<T[]>({
    async start(controller) {
      const reader = stream.getReader();
      const buffer: T[] = [];
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      
      const flush = () => {
        if (buffer.length > 0) {
          controller.enqueue([...buffer]);
          buffer.length = 0;
        }
      };
      
      const clearTimeout = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = undefined;
        }
      };
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) {
            flush();
            controller.close();
            break;
          }
          
          buffer.push(value);
          
          if (buffer.length >= size) {
            flush();
            clearTimeout();
          } else if (!timeoutId) {
            timeoutId = setTimeout(() => {
              timeoutId = undefined;
              flush();
            }, timeout);
          }
        }
      } catch (error) {
        controller.error(error as Error);
      }
    },
  });
}

/**
 * Debounce stream chunks
 */
export function debounceStream<T>(
  stream: ReadableStream<T>,
  delay: number = 100
): ReadableStream<T> {
  return new ReadableStream<T>({
    async start(controller) {
      const reader = stream.getReader();
      let lastChunk: T | undefined;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      
      const emit = () => {
        if (lastChunk !== undefined) {
          controller.enqueue(lastChunk);
          lastChunk = undefined;
        }
      };
      
      const scheduleEmit = () => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          emit();
        }, delay);
      };
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) {
            emit();
            controller.close();
            break;
          }
          
          lastChunk = value;
          scheduleEmit();
        }
      } catch (error) {
        controller.error(error as Error);
      }
    },
  });
}

/**
 * Filter stream chunks
 */
export function filterStream<T>(
  stream: ReadableStream<T>,
  predicate: (chunk: T) => boolean
): ReadableStream<T> {
  return new ReadableStream<T>({
    async start(controller) {
      const reader = stream.getReader();
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) {
            controller.close();
            break;
          }
          
          if (predicate(value)) {
            controller.enqueue(value);
          }
        }
      } catch (error) {
        controller.error(error as Error);
      }
    },
  });
}

/**
 * Take first N chunks from stream
 */
export function takeStream<T>(
  stream: ReadableStream<T>,
  count: number
): ReadableStream<T> {
  return new ReadableStream<T>({
    async start(controller) {
      const reader = stream.getReader();
      let taken = 0;
      
      try {
        while (taken < count) {
          const { done, value } = await reader.read();
          
          if (done) {
            controller.close();
            break;
          }
          
          controller.enqueue(value);
          taken++;
        }
        
        // Cancel the reader if we've taken enough
        if (taken === count) {
          await reader.cancel();
        }
        
        controller.close();
      } catch (error) {
        controller.error(error as Error);
      }
    },
  });
}

/**
 * Collect all chunks from a stream into an array
 */
export async function collectStream<T>(stream: ReadableStream<T>): Promise<T[]> {
  const reader = stream.getReader();
  const chunks: T[] = [];
  
  try {
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) {
        break;
      }
      
      chunks.push(value);
    }
    
    return chunks;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Collect stream into a single concatenated string
 */
export async function collectStreamToString(stream: ReadableStream<string>): Promise<string> {
  const chunks = await collectStream(stream);
  return chunks.join('');
}

/**
 * Pipe one stream to another with optional transformation
 */
export function pipeStreams<T, U = T>(
  source: ReadableStream<T>,
  destination: WritableStream<U>,
  transformer?: (chunk: T) => U
): Promise<void> {
  const reader = source.getReader();
  const writer = destination.getWriter();
  
  return (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          break;
        }
        
        const transformed = transformer ? transformer(value) : (value as unknown as U);
        await writer.write(transformed);
      }
      
      await writer.close();
    } finally {
      reader.releaseLock();
      writer.releaseLock();
    }
  })();
}

/**
 * Create a duplex stream (both readable and writable)
 */
export function createDuplexStream<T>(): {
  readable: ReadableStream<T>;
  writable: WritableStream<T>;
} {
  let controller: ReadableStreamDefaultController<T> | undefined;
  let writer: WritableStreamDefaultWriter<T> | undefined;
  
  const readable = new ReadableStream<T>({
    start(ctrl) {
      controller = ctrl;
    },
  });
  
  const writable = new WritableStream<T>({
    write(chunk) {
      if (controller) {
        controller.enqueue(chunk);
      }
    },
    close() {
      if (controller) {
        controller.close();
      }
    },
    abort(error) {
      if (controller) {
        controller.error(error);
      }
    },
  });
  
  return { readable, writable };
}

/**
 * Split a stream into multiple consumers
 */
export function splitStream<T>(stream: ReadableStream<T>): {
  createBranch: () => ReadableStream<T>;
  close: () => void;
} {
  const branches: WritableStream<T>[] = [];
  const reader = stream.getReader();
  
  return {
    createBranch: () => {
      const { readable, writable } = createDuplexStream<T>();
      branches.push(writable);
      
      // Start reading from source and writing to all branches
      (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            
            if (done) {
              for (const branch of branches) {
                await branch.close();
              }
              break;
            }
            
            for (const branch of branches) {
              await branch.write(value);
            }
          }
        } catch (error) {
          for (const branch of branches) {
            await branch.abort(error as Error);
          }
        }
      })();
      
      return readable;
    },
    close: () => {
      reader.cancel();
    },
  };
}

/**
 * Stream utilities for AI responses
 */
export class AIStream {
  private controller: ReadableStreamDefaultController<string>;
  private stream: ReadableStream<string>;
  private closed = false;

  constructor() {
    this.stream = new ReadableStream<string>({
      start: (ctrl) => {
        this.controller = ctrl;
      },
      cancel: () => {
        this.closed = true;
      },
    });
  }

  /**
   * Write a chunk to the stream
   */
  write(chunk: string): void {
    if (this.closed) return;
    this.controller.enqueue(chunk);
  }

  /**
   * Close the stream
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.controller.close();
  }

  /**
   * Error the stream
   */
  error(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.controller.error(error);
  }

  /**
   * Get the readable stream
   */
  getStream(): ReadableStream<string> {
    return this.stream;
  }

  /**
   * Check if stream is closed
   */
  isClosed(): boolean {
    return this.closed;
  }
}
