import { useState } from "react"
import { useMutation } from "@zeroback/react"
import { api, type ValidatorInfo } from "../lib/zeroback"
import { validatorTypeLabel } from "../lib/utils"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogContent,
  DialogFooter,
} from "./ui/dialog"
import { getInnerType } from "./FieldEditor"

export function CreateDocumentDialog({
  table,
  schema,
  open,
  onOpenChange,
}: {
  table: string
  schema: Record<string, ValidatorInfo>
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const insertDocument = useMutation(api.insertDocument)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [error, setError] = useState("")

  const fieldEntries = Object.entries(schema)

  const handleCreate = async () => {
    setError("")
    try {
      const data: Record<string, unknown> = {}
      for (const [name, validator] of fieldEntries) {
        const raw = fields[name] ?? ""
        const { isOptional, innerType } = getInnerType(validator)

        if (raw === "" && isOptional) continue
        if (raw === "" && !isOptional) {
          setError(`Field "${name}" is required`)
          return
        }

        if (innerType === "number" || innerType === "float64") {
          data[name] = Number(raw)
        } else if (innerType === "int64") {
          data[name] = parseInt(raw, 10)
        } else if (innerType === "boolean") {
          data[name] = raw === "true"
        } else if (innerType === "object" || innerType === "array") {
          data[name] = JSON.parse(raw)
        } else {
          data[name] = raw
        }
      }

      await insertDocument({ table, data })
      setFields({})
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create document")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>Create Document in {table}</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-3">
          {fieldEntries.map(([name, validator]) => {
            const { isOptional, innerType } = getInnerType(validator)
            return (
              <div key={name}>
                <label className="block text-xs font-medium mb-1">
                  {name}
                  <span className="text-muted-foreground ml-1">
                    {validatorTypeLabel(validator)}
                  </span>
                </label>
                {innerType === "boolean" ? (
                  <select
                    value={fields[name] ?? ""}
                    onChange={(e) => setFields({ ...fields, [name]: e.target.value })}
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                  >
                    {isOptional && <option value="">— none —</option>}
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                ) : (
                  <Input
                    value={fields[name] ?? ""}
                    onChange={(e) => setFields({ ...fields, [name]: e.target.value })}
                    placeholder={isOptional ? "(optional)" : ""}
                  />
                )}
              </div>
            )
          })}
        </div>
        {error && <p className="text-destructive text-xs mt-3">{error}</p>}
      </DialogContent>
      <DialogFooter>
        <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button size="sm" onClick={handleCreate}>Create</Button>
      </DialogFooter>
    </Dialog>
  )
}
