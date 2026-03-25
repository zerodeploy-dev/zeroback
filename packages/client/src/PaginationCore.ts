import type { BaseClient } from "./BaseClient";

export type PaginationStatus = "LoadingFirstPage" | "CanLoadMore" | "Exhausted";

export type PaginationState = {
  pages: unknown[][];
  cursors: (string | null)[];
  isDone: boolean;
  numItemsPerPage: number[];
};

export type PaginationCallbacks = {
  setPages: (updater: (prev: unknown[][]) => unknown[][]) => void;
  setCursors: (updater: (prev: (string | null)[]) => (string | null)[]) => void;
  setIsDone: (value: boolean) => void;
  setNumItemsPerPage: (updater: (prev: number[]) => number[]) => void;
};

export function initialPaginationState(initialNumItems: number): PaginationState {
  return {
    pages: [],
    cursors: [null],
    isDone: false,
    numItemsPerPage: [initialNumItems],
  };
}

export function resetPagination(initialNumItems: number, callbacks: PaginationCallbacks): void {
  callbacks.setPages(() => []);
  callbacks.setCursors(() => [null]);
  callbacks.setIsDone(false);
  callbacks.setNumItemsPerPage(() => [initialNumItems]);
}

export function computeStatus(pages: unknown[][], isDone: boolean): PaginationStatus {
  if (pages.length === 0) return "LoadingFirstPage";
  if (isDone) return "Exhausted";
  return "CanLoadMore";
}

export function subscribePaginationPages(
  client: BaseClient,
  fnName: string,
  argsKey: string,
  pageCount: number,
  cursors: (string | null)[],
  numItemsPerPage: number[],
  callbacks: PaginationCallbacks,
): (() => void)[] {
  const unsubscribes: (() => void)[] = [];

  for (let i = 0; i < pageCount; i++) {
    const cursor = cursors[i] ?? null;
    // Skip pages we don't have a cursor for yet (except page 0)
    if (i > 0 && cursor === undefined) break;

    const pageArgs: Record<string, unknown> = {
      ...JSON.parse(argsKey),
      numItems: numItemsPerPage[i],
    };
    if (cursor !== null && cursor !== undefined) {
      pageArgs.cursor = cursor;
    }
    const pageIndex = i;

    const unsub = client.subscribe(fnName, pageArgs, (data: unknown) => {
      const result = data as {
        page: unknown[];
        continueCursor: string | null;
        isDone: boolean;
      };

      callbacks.setPages((prev) => {
        const updated = [...prev];
        updated[pageIndex] = result.page;
        return updated;
      });

      // Update cursor for the next page
      if (pageIndex === cursors.length - 1 || result.continueCursor !== cursors[pageIndex + 1]) {
        callbacks.setCursors((prev) => {
          const updated = [...prev];
          updated[pageIndex + 1] = result.continueCursor;
          return updated;
        });
      }

      if (result.isDone) {
        callbacks.setIsDone(true);
      } else if (pageIndex === pageCount - 1) {
        callbacks.setIsDone(false);
      }
    });

    unsubscribes.push(unsub);
  }

  return unsubscribes;
}
