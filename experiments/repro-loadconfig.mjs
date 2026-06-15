import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadConfig } from "../src/config/loader.ts";

const dir = join(tmpdir(), "teleton-628-demo");
mkdirSync(dir, { recursive: true });
const p = join(dir, "config.yaml");
writeFileSync(p, `
agent:
  api_key: sk-ant-test
  provider: anthropic
telegram:
  mode: user
  api_id: 12345
  api_hash: abcdef
  phone: ""
`);
try { loadConfig(p); } catch (e) { console.log(e.message); }
