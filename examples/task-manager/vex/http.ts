import { httpRouter, httpAction } from "@vex/server";

const http = httpRouter();

http.route({
  path: "/api/tasks",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const { title, status, priority, projectId } = await request.json();
    await ctx.runMutation("tasks:create", { title, status, priority, projectId });
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }),
});

http.route({
  path: "/api/tasks",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId") ?? "";
    const tasks = await ctx.runQuery("tasks:listByProject", { projectId });
    return new Response(JSON.stringify(tasks), {
      headers: { "Content-Type": "application/json" },
    });
  }),
});

http.route({
  path: "/api/projects",
  method: "GET",
  handler: httpAction(async (ctx) => {
    const projects = await ctx.runQuery("projects:list", {});
    return new Response(JSON.stringify(projects), {
      headers: { "Content-Type": "application/json" },
    });
  }),
});

export default http;
