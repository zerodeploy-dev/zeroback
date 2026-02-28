import { ulid } from "ulidx";
import { DatabaseReader } from "./reader.js";
import type { DbOps } from "../types.js";
import type { Id } from "@vex/values";

export class DatabaseWriter<DataModel> extends DatabaseReader<DataModel> {
  async insert<T extends keyof DataModel & string>(
    table: T,
    doc: Omit<DataModel[T], "_id" | "_creationTime">
  ): Promise<Id<T>> {
    const id = `${table}:${ulid()}` as Id<T>;
    const fullDoc = { ...(doc as any), _id: id };
    await this.ops.insert(table, id, fullDoc);
    return id;
  }

  async patch<T extends keyof DataModel & string>(
    id: Id<T>,
    fields: Partial<Omit<DataModel[T], "_id" | "_creationTime">>
  ): Promise<void> {
    await this.ops.patch(tableFromId(id as string), id as string, fields);
  }

  async replace<T extends keyof DataModel & string>(
    id: Id<T>,
    doc: Omit<DataModel[T], "_id" | "_creationTime">
  ): Promise<void> {
    await this.ops.replace(tableFromId(id as string), id as string, doc);
  }

  async delete(id: Id<string>): Promise<void> {
    await this.ops.delete(tableFromId(id as string), id as string);
  }
}

function tableFromId(id: string): string {
  const parts = id.split(":");
  return parts[0] ?? "";
}
