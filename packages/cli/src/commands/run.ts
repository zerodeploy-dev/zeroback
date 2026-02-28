export async function run(opts: {
  fn: string
  args: Record<string, unknown>
  url: string
}): Promise<void> {
  const endpoint = `${opts.url}/__admin/run`

  let res: Response
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fn: opts.fn, args: opts.args }),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`Error: Could not connect to ${opts.url}\n  ${msg}\n\nIs \`vex dev\` running?`)
    process.exit(1)
  }

  const body = (await res.json()) as
    | { success: true; result: unknown }
    | { success: false; error: string; code: string }

  if (!body.success) {
    console.error(`Error [${body.code}]: ${body.error}`)
    process.exit(1)
  }

  console.log(JSON.stringify(body.result, null, 2))
}
