/** Split an array into chunks that fit within the SQL parameter limit. */
export declare function sqlChunks<T>(items: T[], reservedParams?: number): T[][];
/** Split an array into chunks where each item uses multiple params (e.g. multi-column rows). */
export declare function sqlRowChunks<T>(items: T[], paramsPerItem: number): T[][];
/** Generate SQL placeholders: "?, ?, ?" for the given count. */
export declare function sqlPlaceholders(count: number): string;
//# sourceMappingURL=sql-utils.d.ts.map