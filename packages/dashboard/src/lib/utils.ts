import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString()
}

export function truncate(str: string, max: number): string {
  if (str.length <= max) return str
  return str.slice(0, max) + "…"
}

export function validatorTypeLabel(validator: { type: string; value?: any; [key: string]: any }): string {
  switch (validator.type) {
    case "string": return "string"
    case "number": return "number"
    case "float64": return "float64"
    case "int64": return "int64"
    case "boolean": return "boolean"
    case "id": return `id<${validator.tableName ?? ""}>`
    case "optional": return `${validatorTypeLabel(validator.value)}?`
    case "array": return `${validatorTypeLabel(validator.value)}[]`
    case "object": return "object"
    case "union": return "union"
    case "any": return "any"
    default: return validator.type
  }
}
