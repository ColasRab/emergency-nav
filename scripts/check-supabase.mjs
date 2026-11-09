const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Supabase server credentials are missing");
const response = await fetch(`${url}/rest/v1/hazards?select=id&limit=1`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
});
console.log(
  JSON.stringify({
    status: response.status,
    hazardsTableAccessible: response.ok,
    message: response.ok
      ? "Hazards table is ready"
      : (await response.json()).message,
  }),
);
if (process.argv.includes("--realtime")) {
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let channel;
  const status = await new Promise((resolve) => {
    const timeout = setTimeout(() => resolve("TIMED_OUT"), 12000);
    channel = client
      .channel(`validation-${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "hazards",
          filter: "buildingId=eq.ynares",
        },
        () => {},
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR") {
          clearTimeout(timeout);
          resolve(status);
        }
      });
  });
  console.log(JSON.stringify({ realtimeStatus: status }));
  await client.removeChannel(channel);
  client.realtime.disconnect();
  if (status !== "SUBSCRIBED") process.exitCode = 1;
}
