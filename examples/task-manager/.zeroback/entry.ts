import { createZerobackDO, workerHandler } from "@zeroback/server/runtime"
import { functions, schema, httpRouter, cronJobsDef, authDef } from "../zeroback/_generated/manifest"

export const ZerobackDO = createZerobackDO({ functions, schema, httpRouter, cronJobsDef, authDef: authDef ?? undefined })
export default workerHandler
