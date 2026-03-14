import { createZerobackDO, workerHandler } from "@zeroback/runtime"
import { functions, schema, httpRouter, cronJobsDef } from "../zeroback/_generated/manifest"

export const ZerobackDO = createZerobackDO({ functions, schema, httpRouter, cronJobsDef })
export default workerHandler
