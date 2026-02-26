import { httpRouter, httpAction } from "@vex/server";

const http = httpRouter();

http.route({
  path: "/api/messages",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const { body, author, channel } = await request.json();
    await ctx.runMutation("messages:send", { body, author, channel });
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }),
});

http.route({
  path: "/api/messages",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const channel = url.searchParams.get("channel") ?? "general";
    const messages = await ctx.runQuery("messages:list", { channel });
    return new Response(JSON.stringify(messages), {
      headers: { "Content-Type": "application/json" },
    });
  }),
});

export default http;
