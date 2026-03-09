import { MAX_PARAMS } from "../constants";
/** Split an array into chunks that fit within the SQL parameter limit. */
export function sqlChunks(items, reservedParams = 0) {
    const chunkSize = Math.max(1, MAX_PARAMS - reservedParams);
    const chunks = [];
    for (let i = 0; i < items.length; i += chunkSize) {
        chunks.push(items.slice(i, i + chunkSize));
    }
    return chunks;
}
/** Split an array into chunks where each item uses multiple params (e.g. multi-column rows). */
export function sqlRowChunks(items, paramsPerItem) {
    const chunkSize = Math.max(1, Math.floor(MAX_PARAMS / paramsPerItem));
    const chunks = [];
    for (let i = 0; i < items.length; i += chunkSize) {
        chunks.push(items.slice(i, i + chunkSize));
    }
    return chunks;
}
/** Generate SQL placeholders: "?, ?, ?" for the given count. */
export function sqlPlaceholders(count) {
    return Array.from({ length: count }, () => "?").join(", ");
}
//# sourceMappingURL=sql-utils.js.map