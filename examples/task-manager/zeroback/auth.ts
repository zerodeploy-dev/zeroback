import { defineAuth } from "@zeroback/server"

export const auth = defineAuth({
  emailAndPassword: true,
  // OAuth providers — add client ID/secret to your environment variables
  // providers: [{ type: "google" }, { type: "github" }],
  //
  // Cross-origin deployments (e.g. your frontend is on a different domain):
  // trustedOrigins: ["https://your-app.com"],
})
