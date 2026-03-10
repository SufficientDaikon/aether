// ─────────────────────────────────────────────────────────────
// Generic Batch Processor
// R11.4 — processBatch() function
// ─────────────────────────────────────────────────────────────

/** Per-item result produced by processBatch */
export interface BatchItemResult<T, R> {
  /** The original input item */
  item: T;
  /** Whether the processor resolved for this item */
  success: boolean;
  /** Resolved value (present when success is true) */
  result?: R;
  /** Rejection reason wrapped in an Error (present when success is false) */
  error?: Error;
}

/** Aggregate result returned by processBatch */
export interface BatchResult<T, R> {
  /** Total number of items attempted */
  totalProcessed: number;
  /** Items whose processor resolved */
  successCount: number;
  /** Items whose processor rejected */
  failureCount: number;
  /** Per-item results in input order */
  results: BatchItemResult<T, R>[];
  /** Wall-clock duration in milliseconds */
  duration: number;
}

/** Configuration for processBatch */
export interface BatchConfig<T, R> {
  /** Max items processed concurrently per batch (default: 10) */
  batchSize?: number;
  /** Milliseconds to wait between consecutive batches (default: 1000) */
  delayBetweenBatches?: number;
  /**
   * Called after each batch completes.
   * @param batchIndex  0-based batch index
   * @param results     Per-item results for this batch
   */
  onBatchComplete?: (batchIndex: number, results: BatchItemResult<T, R>[]) => void;
  /** Injectable sleep function — useful for testing without real delays */
  sleepFn?: (ms: number) => Promise<void>;
}

const DEFAULT_SLEEP = (ms: number): Promise<void> =>
  new Promise(r => setTimeout(r, ms));

/**
 * Process a large array of items in configurable parallel batches.
 *
 * Items *within* a batch are processed concurrently via `Promise.allSettled`,
 * so a failure in one item never aborts the others. A configurable delay is
 * inserted between batches (but NOT after the last one).
 *
 * @param items     Input array to process
 * @param processor Async function applied to each item
 * @param config    Batch processing options
 * @returns         Aggregate statistics and per-item results
 *
 * @example
 * const result = await processBatch(urls, fetchUrl, {
 *   batchSize: 5,
 *   delayBetweenBatches: 500,
 *   onBatchComplete: (i, r) => console.log(`Batch ${i}: ${r.length} items`),
 * });
 * console.log(`${result.successCount}/${result.totalProcessed} succeeded`);
 */
export async function processBatch<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  config: BatchConfig<T, R> = {}
): Promise<BatchResult<T, R>> {
  const {
    batchSize = 10,
    delayBetweenBatches = 1000,
    onBatchComplete,
    sleepFn = DEFAULT_SLEEP,
  } = config;

  const startTime = Date.now();
  const allResults: BatchItemResult<T, R>[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchIndex = Math.floor(i / batchSize);

    const settled = await Promise.allSettled(batch.map(item => processor(item)));

    const batchResults: BatchItemResult<T, R>[] = settled.map((outcome, j) =>
      outcome.status === "fulfilled"
        ? { item: batch[j], success: true, result: outcome.value }
        : {
            item: batch[j],
            success: false,
            error:
              outcome.reason instanceof Error
                ? outcome.reason
                : new Error(String(outcome.reason)),
          }
    );

    allResults.push(...batchResults);
    onBatchComplete?.(batchIndex, batchResults);

    const isLastBatch = i + batchSize >= items.length;
    if (!isLastBatch && delayBetweenBatches > 0) {
      await sleepFn(delayBetweenBatches);
    }
  }

  const successCount = allResults.filter(r => r.success).length;

  return {
    totalProcessed: allResults.length,
    successCount,
    failureCount: allResults.length - successCount,
    results: allResults,
    duration: Date.now() - startTime,
  };
}
