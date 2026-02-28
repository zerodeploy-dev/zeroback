export type ClientMessage =
  | { type: "query"; id: string; fn: string; args: unknown }
  | { type: "mutation"; id: string; fn: string; args: unknown }
  | { type: "action"; id: string; fn: string; args: unknown }
  | { type: "unsubscribe"; id: string };

export type ServerMessage =
  | { type: "result"; id: string; result: unknown }
  | { type: "update"; id: string; result: unknown }
  | { type: "updates"; items: { id: string; result: unknown }[] }
  | { type: "mutationResult"; id: string; result: unknown }
  | { type: "actionResult"; id: string; result: unknown }
  | { type: "error"; id?: string; code: string; message: string }
  | { type: "reset" };
