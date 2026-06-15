import { ConfigSchema } from "../src/config/schema.ts";

function test(label, raw) {
  const r = ConfigSchema.safeParse(raw);
  console.log("=== " + label + " ===");
  if (r.success) { console.log("OK"); }
  else { console.log(r.error.message); }
}

const base = { agent: { api_key:"x", provider:"anthropic" } };
test("empty phone", { ...base, telegram: { api_id:123, api_hash:"abc", phone:"" } });
test("missing phone", { ...base, telegram: { api_id:123, api_hash:"abc" } });
test("phone as number", { ...base, telegram: { api_id:123, api_hash:"abc", phone:1234567890 } });
