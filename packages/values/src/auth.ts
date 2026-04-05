export interface UserIdentity {
  subject: string           // user ID
  issuer: string            // "zeroback" for built-in auth
  tokenIdentifier: string   // subject + issuer, unique across providers
  email?: string
  emailVerified?: boolean
  name?: string
  username?: string         // provider login handle (e.g. GitHub login)
  pictureUrl?: string
}

export interface AuthDef {
  emailAndPassword?: boolean
  providers?: Array<{ type: "google" | "github" | (string & {}) }>
  trustedOrigins?: string[]
  session?: {
    expiresIn?: number  // seconds
  }
  user?: {
    additionalFields?: Record<string, import("./types.js").Validator<any>>
  }
}
