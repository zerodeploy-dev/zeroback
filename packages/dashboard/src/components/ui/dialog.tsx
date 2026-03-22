import { useEffect, useRef, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { X } from "lucide-react"

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}

export function Dialog({ open, onOpenChange, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={() => onOpenChange(false)}
      onClick={(e) => {
        if (e.target === ref.current) onOpenChange(false)
      }}
      className="backdrop:bg-black/60 bg-transparent p-0 open:flex items-center justify-center"
    >
      <div className="bg-card border border-border rounded-lg shadow-xl max-w-2xl w-full max-h-[85vh] overflow-auto">
        {children}
      </div>
    </dialog>
  )
}

export function DialogHeader({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("px-6 py-4 border-b border-border", className)}>{children}</div>
}

export function DialogTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-lg font-semibold">{children}</h2>
}

export function DialogContent({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("px-6 py-4", className)}>{children}</div>
}

export function DialogFooter({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("px-6 py-4 border-t border-border flex justify-end gap-2", className)}>{children}</div>
}
