import { betterAuth } from "better-auth"
import type { BetterAuthOptions } from "better-auth"
import type { AuthDef, UserIdentity } from "@zeroback/values"
import type { SqlApi } from "../types"
import { createDOSQLiteAdapter, runAuthMigrations } from "./DOSQLiteAdapter"

function buildSocialProviders(
  providers: AuthDef["providers"],
  env: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const p of providers ?? []) {
    if (p.type === "google") {
      result.google = {
        clientId: env.GOOGLE_CLIENT_ID as string,
        clientSecret: env.GOOGLE_CLIENT_SECRET as string,
      }
    } else if (p.type === "github") {
      result.github = {
        clientId: env.GITHUB_CLIENT_ID as string,
        clientSecret: env.GITHUB_CLIENT_SECRET as string,
      }
    }
  }
  return result
}

export class AuthManager {
  private sql: SqlApi
  private auth: ReturnType<typeof betterAuth>
  private authOptions: BetterAuthOptions
  private baseUrl: string | null = null

  constructor(sql: SqlApi, authDef: AuthDef, env: Record<string, unknown>) {
    this.sql = sql

    const options: BetterAuthOptions = {
      secret: (env.BETTER_AUTH_SECRET as string) ?? "dev-secret",
      database: createDOSQLiteAdapter(sql),

      emailAndPassword: { enabled: authDef.emailAndPassword ?? true },

      socialProviders: buildSocialProviders(authDef.providers ?? [], env),

      trustedOrigins: authDef.trustedOrigins ?? [],

      ...(authDef.session ? { session: { expiresIn: authDef.session.expiresIn } } : {}),

      user: { modelName: "user" },
      account: { modelName: "account" },
      verification: { modelName: "verification" },
    }

    this.authOptions = options
    this.auth = betterAuth(options)
  }

  runMigrations(): void {
    runAuthMigrations(this.sql, this.authOptions)
  }

  setBaseUrl(url: string): void {
    this.baseUrl = url
  }

  async handleRequest(req: Request): Promise<Response | null> {
    const url = new URL(req.url)

    if (!url.pathname.startsWith("/auth/")) return null

    const baseUrl = req.headers.get("X-Zeroback-Base-Url") ?? this.baseUrl
    if (baseUrl) {
      const publicUrl = new URL(url.pathname + url.search, baseUrl)
      req = new Request(publicUrl.toString(), req)
    }

    return this.auth.handler(req)
  }

  async getSessionFromHeaders(headers: Headers): Promise<UserIdentity | null> {
    const session = await this.auth.api.getSession({ headers })
    if (!session?.user) return null

    return {
      subject: session.user.id,
      issuer: "zeroback",
      tokenIdentifier: `${session.user.id}|zeroback`,
      email: session.user.email ?? undefined,
      emailVerified: session.user.emailVerified ?? undefined,
      name: session.user.name ?? undefined,
      pictureUrl: (session.user as Record<string, unknown>).image as string | undefined,
    }
  }
}
