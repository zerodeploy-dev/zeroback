import { typeid } from "typeid-js"
import { DatabaseReader } from "./reader.js"
import type { DbOps } from "../types.js"
import { tableFromId, type Id } from "@zeroback/values"

export class DatabaseWriter<DataModel> extends DatabaseReader<DataModel> {
  private prefixMap?: Record<string, string>

  constructor(ops: DbOps, prefixMap?: Record<string, string>) {
    super(ops)
    this.prefixMap = prefixMap
  }

  async insert<T extends keyof DataModel & string>(
    table: T,
    doc: Omit<DataModel[T], "_id" | "_creationTime">
  ): Promise<Id<T>> {
    const prefix = this.prefixMap?.[table] ?? table
    const id = typeid(prefix).toString() as Id<T>
    const fullDoc = { ...(doc as Record<string, unknown>), _id: id }
    await this.ops.insert(table, id, fullDoc)
    return id
  }

  async patch<T extends keyof DataModel & string>(
    id: Id<T>,
    fields: Partial<Omit<DataModel[T], "_id" | "_creationTime">>
  ): Promise<void> {
    await this.ops.patch(tableFromId(id as string), id as string, fields)
  }

  async replace<T extends keyof DataModel & string>(
    id: Id<T>,
    doc: Omit<DataModel[T], "_id" | "_creationTime">
  ): Promise<void> {
    await this.ops.replace(tableFromId(id as string), id as string, doc)
  }

  async delete(id: Id<string>): Promise<void> {
    await this.ops.delete(tableFromId(id as string), id as string)
  }
}
