import { createZerobackDO, createWorkerHandler } from "@zeroback/server/runtime"
import { functions, schema, httpRouter, cronJobsDef, authDef } from "../zeroback/_generated/manifest"

export const ZerobackDO = createZerobackDO({ functions, schema, httpRouter, cronJobsDef, authDef: authDef ?? undefined })

// Enable CORS so your web app can connect from a different origin.
// Set origin to your app's URL, or use "*" to allow all origins.
export default createWorkerHandler({
  cors: { origin: "*" },
})
