/**
 * One-time: create the docroot-scoped FTP login this LP deploys with, and
 * write it to `astro/.env`. Run by the OWNER (it writes a credential):
 *
 *   node scripts/create-ftp-login.mjs
 *
 * Uses cPanel UAPI `Ftp/add_ftp` over HTTPS (:2083) with the API user/token
 * from juansilva-design's `.env.deploy`, never SSH (shared account under a
 * process cap — FTP/HTTPS only). Prints names and status only: never the
 * password, the token, or a raw response body.
 */
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";

const SOURCE_ENV = "/home/jaypy/GitHub-Projects/Notes/ai-synthesizer/workspace/juansilva.design/projects/juansilva-design/.env.deploy";
const DOMAIN = "juanpablosilva.com.br";
const LOGIN = "deploy-oneclick";
const HOMEDIR = "domains/mydomains/juanpablosilva.com.br/one-click-video-downloader";
const target = join(process.cwd(), ".env");

const src = config({ path: SOURCE_ENV, processEnv: {}, quiet: true }).parsed || {};
for (const k of ["CPANEL_FTP_HOST", "CPANEL_API_USER", "CPANEL_API_TOKEN"]) {
  if (!src[k]) throw new Error(`missing ${k} in ${SOURCE_ENV}`);
}
if (existsSync(target) && /^CPANEL_FTP_PASSWORD=.+/m.test(readFileSync(target, "utf8"))) {
  throw new Error(".env already has a CPANEL_FTP_PASSWORD — refusing to overwrite");
}

const api = async (fn, params) => {
  const url = `https://${src.CPANEL_FTP_HOST}:2083/execute/Ftp/${fn}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { headers: { Authorization: `cpanel ${src.CPANEL_API_USER}:${src.CPANEL_API_TOKEN}` } });
  if (!res.ok) throw new Error(`Ftp/${fn} → HTTP ${res.status} (token may lack FTP privileges)`);
  const json = await res.json();
  if (!json.status) throw new Error(`Ftp/${fn} failed: ${(json.errors || []).join("; ").slice(0, 300)}`);
  return json.data;
};

const pass = randomBytes(24).toString("base64url");
await api("add_ftp", { user: LOGIN, domain: DOMAIN, pass, homedir: HOMEDIR, quota: 0 });

const list = await api("list_ftp", {});
const row = (list || []).find((r) => r.user === `${LOGIN}@${DOMAIN}` || r.login === `${LOGIN}@${DOMAIN}`);
if (!row) throw new Error("login not found in list_ftp after add_ftp");
console.log(`✓ created ${LOGIN}@${DOMAIN} → ${row.homedir ?? row.dir ?? HOMEDIR}`);

const lines = [
  `CPANEL_FTP_HOST=${src.CPANEL_FTP_HOST}`,
  `CPANEL_FTP_PORT=${src.CPANEL_FTP_PORT || 21}`,
  `CPANEL_FTP_USER=${LOGIN}@${DOMAIN}`,
  `CPANEL_FTP_PASSWORD=${pass}`,
  "CPANEL_FTP_SCOPED=true",
  "CPANEL_FTP_TLS=false",
  `CPANEL_API_USER=${src.CPANEL_API_USER}`,
  "",
].join("\n");
existsSync(target) ? appendFileSync(target, "\n" + lines) : writeFileSync(target, lines, { mode: 0o600 });
console.log("✓ wrote CPANEL_FTP_* names to astro/.env (values not shown)");
