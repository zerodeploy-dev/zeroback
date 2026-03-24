import { useState, useEffect } from "react"
import { useQuery, useMutation } from "@zeroback/react"
import { api, type ValidatorInfo } from "../lib/zeroback"
import { validatorTypeLabel } from "../lib/utils"
import { Button } from "./ui/button"
import { FieldEditor } from "./FieldEditor"
import { X as XIcon, Trash2 } from "lucide-react"

export function DocumentPanel({
  id,
  fields,
  onClose,
}: {
  id: string
  fields: Record<string, ValidatorInfo>
  onClose: () => void
}) {
  const doc = useQuery(api.getDocument, { id })
  const updateDocument = useMutation(api.updateDocument)
  const deleteDocument = useMutation(api.deleteDocument)
  const [edits, setEdits] = useState<Record<string, unknown>>({})
  const [saving, setSaving] = useState(false)

  const handleDelete = async () => {
    if (confirm(`Delete ${id}?`)) {
      await deleteDocument({ id })
      onClose()
    }
  }

  const fieldEntries = Object.entries(fields)
  const hasEdits = Object.keys(edits).length > 0

  const handleSave = async () => {
    if (!hasEdits) return
    setSaving(true)
    try {
      await updateDocument({ id, fields: edits })
      setEdits({})
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    setEdits({})
  }, [id])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onClose])

  return (
    <div className="border-l border-border h-full flex flex-col bg-card/50 w-full md:w-1/2 xl:w-1/3 shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-12 border-b border-border shrink-0">
        <h3 className="font-medium text-sm">Edit Document</h3>
        <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground rounded" title="Close">
          <XIcon className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto px-4 py-4">
        <div className="font-mono text-xs mb-4 text-muted-foreground break-all">{id}</div>
        {!doc ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : (
          <div className="space-y-4">
            {fieldEntries.map(([name, validator]) => {
              const currentValue = name in edits ? edits[name] : doc[name]
              return (
                <div key={name}>
                  <label className="block text-xs font-medium mb-1">
                    {name}
                    <span className="text-muted-foreground ml-1">
                      {validatorTypeLabel(validator)}
                    </span>
                  </label>
                  <FieldEditor
                    value={currentValue}
                    validator={validator}
                    onChange={(val) => setEdits((prev) => ({ ...prev, [name]: val }))}
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-border flex items-center shrink-0">
        <Button variant="ghost" size="sm" onClick={handleDelete} className="text-muted-foreground hover:text-destructive">
          <Trash2 className="w-3.5 h-3.5" />
          Delete
        </Button>
        {hasEdits && (
          <div className="flex gap-2 ml-auto">
            <Button variant="outline" size="sm" onClick={() => setEdits({})}>
              Discard
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
