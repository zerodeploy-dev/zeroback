export interface UserIdentity {
  subject: string           // user ID
  issuer: string            // "zeroback" for built-in auth
  tokenIdentifier: string   // subject + issuer, unique across providers
  email?: string
  emailVerified?: boolean
  name?: string
  pictureUrl?: string
}

export interface AuthDef {
  emailAndPassword?: boolean
  providers?: Array<{ type: "google" } | { type: "github" }>
  trustedOrigins?: string[]
  session?: {
    expiresIn?: number  // seconds
  }
}
