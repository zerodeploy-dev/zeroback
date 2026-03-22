import { Button } from "./ui/button"
import { ChevronLeft, ChevronRight } from "lucide-react"

export function Pagination({
  page,
  hasNext,
  hasPrev,
  count,
  onNext,
  onPrev,
}: {
  page: number
  hasNext: boolean
  hasPrev: boolean
  count: number
  onNext: () => void
  onPrev: () => void
}) {
  return (
    <div className="flex items-center justify-between px-4 h-10 border-t border-border shrink-0 text-xs text-muted-foreground">
      <span>
        {count} document{count !== 1 ? "s" : ""} on this page
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          disabled={!hasPrev}
          onClick={onPrev}
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <span>Page {page}</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          disabled={!hasNext}
          onClick={onNext}
        >
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  )
}
