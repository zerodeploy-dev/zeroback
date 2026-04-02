import { betterAuth } from "better-auth"
import type { BetterAuthOptions } from "better-auth"
import { getSchema } from "better-auth/db"
import type { AuthDef, UserIdentity } from "@zeroback/values"
import type { SqlApi } from "../types"
import type { TableColumnInfo, ColumnInfo } from "../db/SchemaMapper"
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
        mapProfileToUser: (profile: Record<string, unknown>) => ({
          username: profile.login as string | undefined,
        }),
      }
    } else {
      console.warn(`[zeroback] Unknown auth provider type "${(p as { type: string }).type}" — skipping`)
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
      secret: (env.BETTER_AUTH_SECRET as string | undefined) ?? (() => {
        console.warn("[zeroback] BETTER_AUTH_SECRET is not set — using insecure dev-secret")
        return "dev-secret"
      })(),
      database: createDOSQLiteAdapter(sql),

      basePath: "/auth",

      emailAndPassword: { enabled: authDef.emailAndPassword ?? true },

      socialProviders: buildSocialProviders(authDef.providers ?? [], env),

      trustedOrigins: authDef.trustedOrigins ?? [],

      ...(authDef.session ? { session: { expiresIn: authDef.session.expiresIn } } : {}),

      user: {
        modelName: "user",
        additionalFields: {
          username: { type: "string", required: false, returned: true },
        },
      },
      account: { modelName: "account" },
      verification: { modelName: "verification" },
    }

    this.authOptions = options
    this.auth = betterAuth(options)
  }

  async runMigrations(): Promise<void> {
    runAuthMigrations(this.sql, this.authOptions)
  }

  setBaseUrl(url: string): void {
    this.baseUrl = url
  }

  async handleRequest(req: Request): Promise<Response | null> {
    const url = new URL(req.url)

    if (!url.pathname.startsWith("/auth/")) return null

    // X-Zeroback-Base-Url is set by the Worker before forwarding to the DO — not user-accessible
    const baseUrl = req.headers.get("X-Zeroback-Base-Url") ?? this.baseUrl
    if (baseUrl) {
      const publicUrl = new URL(url.pathname + url.search, baseUrl)
      req = new Request(publicUrl.toString(), req)
    }

    return this.auth.handler(req)
  }

  /**
   * Register auth tables as queryable views so ctx.db.query("users") works.
   * Creates a SQL VIEW over _auth_user and registers column metadata in tableColumns.
   */
  registerAuthTables(tableColumns: Map<string, TableColumnInfo>): void {
    const authSchema = getSchema(this.authOptions)
    const userModel = authSchema.user
    if (!userModel) return

    const pragmaCols = this.sql.exec(`PRAGMA table_info("_auth_user")`).toArray() as {
      name: string; type: string; notnull: number
    }[]
    if (pragmaCols.length === 0) return

    const columns = new Map<string, ColumnInfo>()
    const orderedFieldNames: string[] = []
    const viewSelectCols: string[] = ['id AS _id', '0 AS _ts']

    // System columns expected by the query pipeline
    columns.set('_id', { name: '_id', sqlType: 'TEXT', nullable: false, isJsonColumn: false, isBoolean: false })
    columns.set('_ts', { name: '_ts', sqlType: 'INTEGER', nullable: false, isJsonColumn: false, isBoolean: false })

    for (const col of pragmaCols) {
      if (col.name === 'id') continue // already mapped to _id

      const fieldDef = userModel.fields[col.name]
      const fieldType = fieldDef?.type
      const normalizedType = Array.isArray(fieldType) ? fieldType[0] : fieldType
      const isBoolean = normalizedType === 'boolean'

      viewSelectCols.push(`"${col.name}"`)
      orderedFieldNames.push(col.name)
      columns.set(col.name, {
        name: col.name,
        sqlType: col.type || 'TEXT',
        nullable: col.notnull === 0,
        isJsonColumn: false,
        isBoolean,
      })
    }

    this.sql.exec(`DROP VIEW IF EXISTS "users"`)
    this.sql.exec(
      `CREATE VIEW "users" AS SELECT ${viewSelectCols.join(', ')} FROM "_auth_user"`
    )

    tableColumns.set('users', { columns, orderedFieldNames })
  }

  async getSessionFromHeaders(headers: Headers): Promise<UserIdentity | null> {
    const session = await this.auth.api.getSession({ headers })
    if (!session?.user) return null

    const user = session.user as { image?: string; username?: string }
    return {
      subject: session.user.id,
      issuer: "zeroback",
      tokenIdentifier: `zeroback|${session.user.id}`,
      email: session.user.email ?? undefined,
      emailVerified: session.user.emailVerified ?? undefined,
      name: session.user.name ?? undefined,
      username: user.username ?? undefined,
      pictureUrl: user.image,
    }
  }
}
