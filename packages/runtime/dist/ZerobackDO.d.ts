import { DurableObject } from "cloudflare:workers";
import type { SchemaJSON } from "@zeroback/server";
export type FunctionDef = {
    type: "query" | "mutation" | "action";
    isInternal: boolean;
    handler: (ctx: any, args: any) => Promise<any>;
    argsValidator?: Record<string, {
        json: any;
    }>;
    returnsValidator?: {
        json: any;
    };
};
export interface RuntimeConfig {
    functions: Record<string, FunctionDef>;
    schema: SchemaJSON;
    httpRouter: any | null;
    cronJobsDef: any | null;
}
export declare function createZerobackDO(config: RuntimeConfig): {
    new (ctx: DurableObjectState, env: Env): DurableObject<Env>;
};
export interface Env {
    ZEROBACK_DO: DurableObjectNamespace;
    ZEROBACK_STORAGE?: R2Bucket;
}
//# sourceMappingURL=ZerobackDO.d.ts.map