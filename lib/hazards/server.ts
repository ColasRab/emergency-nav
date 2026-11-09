import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { buildingSchema, type BuildingId } from "../buildings";
import { parseGraph } from "../graph";
export function serverSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Shared hazards are not configured.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export async function serverBuilding(id: BuildingId) {
  const config = buildingSchema.parse(
    JSON.parse(
      await readFile(
        path.join(process.cwd(), "public", "models", `${id}.json`),
        "utf8",
      ),
    ),
  );
  const graph = config.graph
    ? parseGraph(
        JSON.parse(
          await readFile(
            path.join(process.cwd(), "public", config.graph),
            "utf8",
          ),
        ),
      )
    : null;
  return { config, graph };
}
