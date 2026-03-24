import { MAX_PARAMS } from "../constants";

/** Split an array into chunks that fit within the SQL parameter limit. */
export function sqlChunks<T>(items: T[], reservedParams: number = 0): T[][] {
  const chunkSize = Math.max(1, MAX_PARAMS - reservedParams);
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

/** Split an array into chunks where each item uses multiple params (e.g. multi-column rows). */
export function sqlRowChunks<T>(items: T[], paramsPerItem: number): T[][] {
  const chunkSize = Math.max(1, Math.floor(MAX_PARAMS / paramsPerItem));
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

/** Generate SQL placeholders: "?, ?, ?" for the given count. */
export function sqlPlaceholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}
