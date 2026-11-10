/**
 * Publish the one-click-video-downloader landing page (`astro/dist/`) to its
 * cPanel docroot **over FTP**. Run from `astro/`.
 *
 * Adapted from `knowledge/projects/umjuansantos/scripts/deploy-ftp.mjs`
 * (2026-11-10), which itself descends from newcar lp-santacruz. Differences:
 *
 *   1. og:url / canonical carry a trailing slash
 *      (`https://one-click-video-downloader.juanpablosilva.com.br/`).
 *   2. No robots.txt / sitemap — the crawl surface is `llms.txt`, the
 *      favicons and `site.webmanifest`.
 *   3. ⛔ `/docs` is NOT in this docroot: Cloudflare routes it to GitBook
 *      (`x-gitbook-route-site` header). `docs/` is still prune-protected, so a
 *      future switch to a docroot-level proxy can't be deleted by `--prune`.
 *   4. Docroot (from .env): `domains/mydomains/juanpablosilva.com.br/one-click-video-downloader`.
 *      The site was published by hand before this script (2026-06-23), so a
 *      first run does NOT need --first-publish.
 *
 * ⛔ Why not SSH/scp/rsync: the origin is a SHARED cPanel account under a
 * CloudLinux process cap; exceeding it takes every site on the account down.
 * Standing instruction (Juan, 2026-08-14): deploy over FTP.
 *
 * ⛔ FTP has no `--delete`. Mirroring is the explicit, opt-in `--prune` step.
 *
 * Modes:
 *   node scripts/deploy-ftp.mjs                      # dry run: preflight, index, plan
 *   node scripts/deploy-ftp.mjs --publish            # upload new + changed files
 *   node scripts/deploy-ftp.mjs --publish --prune    # …and delete remote orphans
 *   node scripts/deploy-ftp.mjs --verify             # public-URL checks only, no login
 *
 * Flags: --force (override the quota refusal) · --first-publish (allow an empty or
 *        unrecognised docroot) · --verbose (raw FTP chatter)
 *
 * Environment (from .env; exported values win):
 *   CPANEL_FTP_HOST  CPANEL_FTP_PORT  CPANEL_FTP_USER  CPANEL_FTP_PASSWORD
 *   CPANEL_DOCROOT_BASE   — docroot, relative to the FTP login's chroot
 *   CPANEL_FTP_SCOPED     — true when the login is chrooted to the docroot itself
 *   CPANEL_FTP_TLS=false  — opt out of FTPS (sends the password in cleartext)
 *   CPANEL_API_TOKEN      — optional, read-only; gates on the process count
 *   CPANEL_SIBLING_SITES  — optional, comma-separated, for readable misroute messages
 *   CPANEL_PROTECT_PATHS  — optional, comma-separated extra prune-protected prefixes
 */
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { Writable } from "node:stream";
import { config as loadEnv } from "dotenv";

const projectRoot = process.cwd();
const APEX_HOST = "one-click-video-downloader.juanpablosilva.com.br";
const CANONICAL_HOST = APEX_HOST;
const publicUrl = `https://${CANONICAL_HOST}`;
/** og:url / canonical as Astro emits them (trailing slash). */
const ogExpected = `${publicUrl}/`;
const distDir = join(projectRoot, "dist");

/**
 * Docroots on this account that are NOT this site. Naming them makes a
 * misroute readable in the failure message instead of "something went wrong".
 *
 * ⛔ Read from the environment, never hardcoded: a list of sites sharing one
 * origin is infrastructure detail that does not belong in source, private
 * repo or not. Set CPANEL_SIBLING_SITES in .env (comma-separated).
 * ⛔ Read LAZILY, not at module load: `loadEnv()` runs further down this
 * file, so a top-level const here would always be empty.
 */
const siblingSites = () =>
  (process.env.CPANEL_SIBLING_SITES || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/** Anything under these prefixes is never uploaded and never pruned. */
const PROTECTED_PATHS = [
  // ⛔ AutoSSL writes its ACME challenge here. Deleting it breaks certificate
  // renewal weeks later, with nothing in the deploy log to connect it back.
  /^\.well-known(\/|$)/,
  /^cgi-bin(\/|$)/,
  /^\.ftpquota$/,
  /^\.htpasswd$/,
  /^\.user\.ini$/,
  /^error_log$/,
  // GitBook docs live at /docs via Cloudflare; never prune a docroot copy.
  /^docs(\/|$)/,
  // Hand-made server config on this docroot (found 2026-11-10), not in public/.
  /^\.htaccess$/,
  /^php\.ini$/,
];

/** Mtime sources that should force a rebuild. */
const buildInputs = ["src", "public", "astro.config.mjs", "tsconfig.json", "package.json", ".env"];

const argv = process.argv.slice(2);
const KNOWN_FLAGS = ["--publish", "--prune", "--verify", "--force", "--first-publish", "--verbose"];
const PUBLISH = argv.includes("--publish");
const PRUNE = argv.includes("--prune");
const VERIFY_ONLY = argv.includes("--verify");
const FORCE = argv.includes("--force");
const FIRST_PUBLISH = argv.includes("--first-publish");
const VERBOSE = argv.includes("--verbose");

for (const argument of argv) {
  if (!KNOWN_FLAGS.includes(argument)) {
    console.error(`✗ unknown argument: ${argument}`);
    console.error(`  known flags: ${KNOWN_FLAGS.join(" ")}`);
    process.exit(1);
  }
}
if (VERIFY_ONLY && (PUBLISH || PRUNE)) {
  console.error("✗ --verify makes no changes; drop --publish/--prune");
  process.exit(1);
}
if (PRUNE && !PUBLISH) {
  // Otherwise the plan announces "WILL BE DELETED" and then writes nothing —
  // which reads as a prune that silently failed.
  console.error("✗ --prune only applies to a publish; use: --publish --prune");
  process.exit(1);
}

loadEnv({ path: join(projectRoot, ".env"), override: false, quiet: true });
const env = process.env;

let failures = 0;
const head = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const pass = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const info = (m) => console.log(`  · ${m}`);
const warn = (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`);
const fail = (m) => {
  failures++;
  console.log(`  \x1b[31m✗\x1b[0m ${m}`);
};
const check = (ok, good, bad) => (ok ? pass(good) : fail(bad));
const die = (m) => {
  console.error(`\n\x1b[31m✗ ${m}\x1b[0m`);
  process.exit(1);
};

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

const extraProtected = (env.CPANEL_PROTECT_PATHS || "")
  .split(",")
  .map((s) => s.trim().replace(/^\/+|\/+$/g, ""))
  .filter(Boolean);

const isProtected = (rel) =>
  PROTECTED_PATHS.some((p) => p.test(rel)) ||
  extraProtected.some((prefix) => rel === prefix || rel.startsWith(`${prefix}/`));

function walkFiles(path, files = []) {
  if (!existsSync(path)) return files;
  const stats = lstatSync(path);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    files.push(path);
    return files;
  }
  for (const entry of readdirSync(path)) walkFiles(join(path, entry), files);
  return files;
}

function walkLocal(dir, prefix = "") {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...walkLocal(join(dir, entry.name), rel));
    else if (entry.isFile()) files.push({ rel, size: statSync(join(dir, entry.name)).size });
  }
  return files;
}

const builtHtml = () => walkFiles(distDir).filter((p) => p.endsWith(".html"));

// --- stage 1: the build is real, current, and names the right site -----------
// Transport-independent: none of these assertions are about FTP.

function buildPreflight() {
  head("Local build");

  if (!existsSync(distDir)) die("no dist/ — run `npm run build` first");
  if (!existsSync(join(distDir, "index.html"))) die("dist/index.html missing — the build did not complete");

  const builtAt = statSync(join(distDir, "index.html")).mtimeMs;
  const newerInput = buildInputs
    .flatMap((path) => walkFiles(join(projectRoot, path)))
    .find((path) => statSync(path).mtimeMs > builtAt + 1_000);
  if (newerInput) {
    die(`dist/ is older than ${relative(projectRoot, newerInput)} — run \`npm run build\` first`);
  }
  pass(`dist/ is newer than every build input (${builtHtml().length} pages)`);

  const envInDist = walkFiles(distDir).filter((p) => /^\.env(?:\.|$)/.test(basename(p)));
  check(!envInDist.length, "no .env files inside dist/", `dist/ contains ${envInDist.length} .env file(s) — do not publish`);

  hostIdentityGate();
  contentGate();
  referencedAssetsGate();

  if (failures) die("build preflight failed — nothing was uploaded");
}

/**
 * One origin, one host. Astro resolves `Astro.site` into og:url, so a wrong
 * or missing `site` publishes localhost or the wrong domain into every page
 * — which no page-level content check would ever notice on its own.
 */
function hostIdentityGate() {
  head("Host identity");

  const textFiles = walkFiles(distDir).filter((p) => /\.(html|xml|txt|webmanifest)$/i.test(p));
  const localhostRefs = textFiles.filter((p) => /https?:\/\/(localhost|127\.0\.0\.1)/i.test(readFileSync(p, "utf8")));
  check(!localhostRefs.length, "no localhost URLs in the built output", `${localhostRefs.length} built file(s) reference localhost: ${localhostRefs.map((p) => relative(distDir, p)).join(", ")}`);

  // There is no <link rel="canonical"> on this site (BaseLayout emits none) —
  // og:url is the only per-build host marker, and it is hardcoded to the apex
  // with no per-route path. Check it names exactly this host.
  const index = readFileSync(join(distDir, "index.html"), "utf8");
  const ogUrl = index.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i)?.[1];
  check(ogUrl === ogExpected, `index.html og:url is ${ogExpected}`, `index.html og:url is ${ogUrl ?? "absent"} — expected ${ogExpected}`);

  for (const name of ["llms.txt", "site.webmanifest", "favicon/favicon.ico"]) {
    check(existsSync(join(distDir, name)), `${name} present`, `${name} missing from the build`);
  }
}

/** The page states what it is: the H1 product name ships in the build. */
function contentGate() {
  head("Content contract");

  const html = readFileSync(join(distDir, "index.html"), "utf8");
  check(/One-Click Video Downloader/.test(html), "index.html names One-Click Video Downloader", "index.html does not mention One-Click Video Downloader — wrong build?");
  const llms = join(distDir, "llms.txt");
  if (existsSync(llms)) check(readFileSync(llms, "utf8").startsWith("# One-Click Video Downloader"), "llms.txt starts with its H1", "llms.txt does not start with '# One-Click Video Downloader'");
}

/**
 * Every root-relative asset the pages reference must actually be in the build.
 * A renamed favicon or illustration 404s in production and nowhere else.
 */
function referencedAssetsGate() {
  head("Referenced assets");

  const missing = new Map();
  let checked = 0;
  for (const file of builtHtml()) {
    const html = readFileSync(file, "utf8");
    const refs = new Set();
    for (const [, attr] of html.matchAll(/(?:href|src)=["'](\/[^"'#?]*)["']/gi)) refs.add(attr);

    for (const ref of refs) {
      const decoded = decodeURIComponent(ref);
      // A route, not a file: Astro emits `cartao/index.html` for `/cartao/`.
      const candidates = decoded.endsWith("/")
        ? [join(distDir, decoded, "index.html")]
        : [join(distDir, decoded), join(distDir, decoded, "index.html")];
      checked++;
      if (!candidates.some(existsSync)) {
        const rel = relative(distDir, file);
        missing.set(rel, [...(missing.get(rel) || []), ref]);
      }
    }
  }

  check(!missing.size, `all ${checked} root-relative references resolve inside dist/`, `${missing.size} page(s) reference files that are not in the build`);
  for (const [rel, refs] of missing) console.log(`      ${rel}: ${refs.join(", ")}`);
}

// --- stage 2: the account's process quota ------------------------------------
// The reason this transport exists. Read-only; skipped when no token is configured.

async function processQuotaPreflight() {
  head("cPanel process quota");
  if (!env.CPANEL_API_TOKEN) {
    info("no CPANEL_API_TOKEN — skipping (set it to gate deploys on the process count)");
    return true;
  }

  const apiUser = env.CPANEL_API_USER || env.CPANEL_FTP_USER;
  let usages;
  try {
    const res = await fetch(`https://${env.CPANEL_FTP_HOST}:2083/execute/ResourceUsage/get_usages`, {
      headers: { Authorization: `cpanel ${apiUser}:${env.CPANEL_API_TOKEN}` },
      signal: AbortSignal.timeout(20000),
    });
    usages = (await res.json())?.data;
  } catch (err) {
    // A courtesy check, not a correctness gate: never block on an unreachable panel.
    warn(`could not read resource usage (${err.message}) — continuing`);
    return true;
  }
  if (!Array.isArray(usages)) {
    warn("resource usage came back in an unexpected shape — continuing");
    return true;
  }

  const row = (id) => usages.find((u) => u.id === id);
  const ep = row("lveep");
  const nproc = row("lvenproc");
  if (ep) info(`entry processes: ${ep.usage}/${ep.maximum}  (a different limit — do not conflate)`);
  if (!nproc?.maximum) {
    warn("no lvenproc row — continuing");
    return true;
  }

  const used = Number(nproc.usage);
  const max = Number(nproc.maximum);
  const free = max - used;
  const pct = Math.round((used / max) * 100);

  // One held control connection plus one data connection — ~2 slots for the whole
  // run, not one per file. Hard-stop only when even that is tight.
  if (free <= 3) {
    fail(`number of processes ${used}/${max} (${pct}%) — only ${free} slot(s) free; refusing to open an FTP session`);
    info("Clear processes first (cPanel → Resource Usage) or re-run with --force.");
    return FORCE;
  }
  if (pct >= 85) warn(`number of processes ${used}/${max} (${pct}%) — tight, but ${free} free is enough for one session`);
  else pass(`number of processes ${used}/${max} (${pct}%)`);
  return true;
}

// --- stage 3: connect --------------------------------------------------------

async function connect() {
  const { Client } = await import("basic-ftp");
  const client = new Client(60000);
  client.ftp.verbose = VERBOSE;

  const base = {
    host: env.CPANEL_FTP_HOST,
    port: Number(env.CPANEL_FTP_PORT || 21),
    user: env.CPANEL_FTP_USER,
    password: env.CPANEL_FTP_PASSWORD,
  };
  for (const [key, value] of Object.entries(base)) {
    if (!value) die(`missing env: CPANEL_FTP_${key.toUpperCase()} (set it in .env — see .env.example)`);
  }

  if (env.CPANEL_FTP_TLS === "false") {
    warn("CPANEL_FTP_TLS=false — connecting WITHOUT TLS; the password crosses the network in cleartext");
    await client.access({ ...base, secure: false });
    return { client, tls: "none" };
  }

  try {
    await client.access({ ...base, secure: true });
    return { client, tls: "verified" };
  } catch (err) {
    const msg = err.message.split("\n")[0];
    // ⛔ This host advertises AUTH TLS in FEAT and then answers
    // "500 This security scheme is not implemented" to every scheme (verified
    // on this account 2026-08-14/15). Fail closed rather than downgrade silently.
    if (/not implemented|not understood|unrecognized command/i.test(msg)) {
      client.close();
      die(
        `this FTP server refuses TLS (${msg}).\n` +
          `    Refusing to send the password in cleartext by default.\n` +
          `    Set CPANEL_FTP_TLS=false to accept a plaintext login if that is the deliberate choice,\n` +
          `    and use a per-directory FTP account so a captured password reaches one docroot.`,
      );
    }
    if (!/certificate|self.signed|altname|hostname|CERT_/i.test(msg)) throw err;
    warn(`FTPS certificate not verifiable (${msg}) — retrying encrypted-but-unverified`);
    client.close();
    const { Client: C2 } = await import("basic-ftp");
    const retry = new C2(60000);
    retry.ftp.verbose = VERBOSE;
    await retry.access({ ...base, secure: true, secureOptions: { rejectUnauthorized: false } });
    return { client: retry, tls: "unverified" };
  }
}

async function enterDocroot(client) {
  // A per-directory FTP account is chrooted to the docroot itself, so its own path
  // is "/" and can never name the host. Declared, never inferred.
  if (env.CPANEL_FTP_SCOPED === "true") {
    await client.cd("/");
    return "/";
  }

  const configured = (env.CPANEL_DOCROOT_BASE || "").replace(/\/+$/, "");
  if (!configured) die(`missing env: CPANEL_DOCROOT_BASE (e.g. domains/<account-tree>/${APEX_HOST})`);

  const home = `/home/${env.CPANEL_FTP_USER}`;
  const candidates = [configured];
  if (configured.startsWith(`${home}/`)) candidates.push(configured.slice(home.length + 1));
  if (!configured.startsWith("/")) candidates.push(`${home}/${configured}`);

  const tried = [];
  for (const candidate of candidates) {
    try {
      await client.cd(candidate);
      return await client.pwd();
    } catch (err) {
      tried.push(`${candidate} → ${err.message.split("\n")[0]}`);
    }
  }
  die(`could not enter the docroot. Tried:\n    ${tried.join("\n    ")}`);
}

// A wrong path here would publish this site over a sibling — psiativa, newcar
// or juanpablosilva.com.br share this cPanel account — or over the account
// home itself, which is every site at once.
const CPANEL_HOME_MARKERS = ["domains", "public_html", "mail", "etc", "ssl", "logs", ".cpanel", ".trash"];

function assertDocrootIdentity(resolved, names) {
  head("Docroot identity");
  info(`resolved to ${resolved}`);

  const markers = CPANEL_HOME_MARKERS.filter((m) => names.includes(m));
  check(
    markers.length < 3,
    "does not look like a cPanel account home",
    `looks like a cPanel ACCOUNT HOME (found ${markers.join(", ")}) — refusing to write; this is every site on the account`,
  );

  // A chrooted login cannot name the host in its path, so there the CREDENTIAL is
  // the scope and the path check is waived — but only because it was declared.
  if (env.CPANEL_FTP_SCOPED === "true") {
    pass("CPANEL_FTP_SCOPED=true — login is chrooted to the docroot, path check waived");
  } else {
    check(
      resolved.includes(APEX_HOST),
      `path names ${APEX_HOST}`,
      `path does NOT contain ${APEX_HOST} — refusing to write into an unidentified directory ` +
        `(set CPANEL_FTP_SCOPED=true if this login is chrooted to the docroot)`,
    );
  }

  if (!FIRST_PUBLISH) {
    check(
      names.includes("index.html"),
      "holds index.html (a site has been published here before)",
      "no index.html here — refusing an unfamiliar directory (pass --first-publish if this docroot is genuinely empty)",
    );
  }

  if (failures) die("docroot identity checks failed — nothing was written");
}

async function readRemoteFile(client, path, maxBytes = 400_000) {
  const chunks = [];
  let total = 0;
  const sink = new Writable({
    write(chunk, _enc, cb) {
      total += chunk.length;
      if (total <= maxBytes) chunks.push(chunk);
      cb();
    },
  });
  await client.downloadTo(sink, path);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * ⭐ This docroot was already serving the site before this script existed
 * (deployed by hand). The path check above is waived for a chrooted login, so
 * on a wrong credential nothing else would notice: a sibling docroot also
 * holds an index.html and also fails to look like an account home. Read the
 * page that is actually about to be overwritten and make it say which site it
 * belongs to before writing anything.
 */
async function assertSiteIdentity(client, root, names) {
  head("Site identity");
  if (!names.includes("index.html")) {
    warn("no index.html to read — skipped (only reachable with --first-publish)");
    return;
  }

  let html;
  try {
    await client.cd(root);
    html = await readRemoteFile(client, "index.html");
  } catch (err) {
    warn(`could not read the remote index.html (${err.message.split("\n")[0]}) — skipping the content check`);
    return;
  }

  const ogUrl = html.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i)?.[1];
  if (ogUrl === ogExpected) {
    pass(`the docroot's index.html names ${publicUrl} — this is one-click-video-downloader`);
    return;
  }
  const foreign = siblingSites().filter((host) => html.includes(host));
  die(
    `the docroot's index.html og:url is ${ogUrl ?? "absent"}, not ${ogExpected}` +
      (foreign.length ? ` — it names ${foreign.join(", ")}. This is another site on the account, not one-click-video-downloader.` : ".") +
      `\n    Refusing to overwrite it. Check CPANEL_FTP_USER: a scoped login publishes to its OWN chroot,` +
      `\n    so the docroot follows the credential, not CPANEL_DOCROOT_BASE.`,
  );
}

// --- stage 4: index and plan -------------------------------------------------

async function walkRemote(client, rel = "", acc = { files: [], dirs: [], symlinks: [] }) {
  const list = await client.list();
  for (const item of list) {
    if (item.name === "." || item.name === "..") continue;
    const r = rel ? `${rel}/${item.name}` : item.name;
    if (item.isSymbolicLink) {
      acc.symlinks.push(r);
      continue;
    }
    if (item.isDirectory) {
      acc.dirs.push(r);
      await client.cd(item.name);
      await walkRemote(client, r, acc);
      await client.cdup();
    } else if (item.isFile) {
      acc.files.push({ rel: r, size: item.size });
    }
  }
  return acc;
}

/**
 * Size is a sound change signal for `_astro/` assets and images — their filenames
 * are content-hashed, so different bytes mean a different name. It is NOT sound
 * for hand-written text: an edited date, a swapped id or a reordered attribute can
 * leave the byte count identical and the file would be skipped forever. Those are
 * small, so re-upload them unconditionally rather than guess.
 */
const alwaysReupload = (rel) => /\.(html|xml|json|txt|webmanifest)$/i.test(rel);

function planUpload(localFiles, remote) {
  const remoteByRel = new Map(remote.files.map((f) => [f.rel, f.size]));
  const localByRel = new Map(localFiles.map((f) => [f.rel, f.size]));

  const created = localFiles.filter((f) => !remoteByRel.has(f.rel));
  const changed = localFiles.filter(
    (f) => remoteByRel.has(f.rel) && (remoteByRel.get(f.rel) !== f.size || alwaysReupload(f.rel)),
  );
  const unchanged = localFiles.filter((f) => remoteByRel.has(f.rel) && remoteByRel.get(f.rel) === f.size && !alwaysReupload(f.rel));

  const orphans = remote.files.filter((f) => !localByRel.has(f.rel) && !isProtected(f.rel));
  const protectedRemote = remote.files.filter((f) => !localByRel.has(f.rel) && isProtected(f.rel));

  return { created, changed, unchanged, orphans, protectedRemote };
}

// --- stage 5: upload ---------------------------------------------------------

async function uploadFiles(client, root, files) {
  if (!files.length) {
    pass("nothing to upload — the docroot already matches this build");
    return;
  }

  const byDir = new Map();
  for (const f of files) {
    const dir = f.rel.includes("/") ? f.rel.slice(0, f.rel.lastIndexOf("/")) : "";
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push(f);
  }

  // ⭐ Order matters. `_astro/` filenames are content-hashed, so uploading assets
  // BEFORE the HTML that references them means the site is never in a state where
  // fresh markup points at a file that has not landed yet. HTML goes last.
  const isHtml = (f) => f.rel.endsWith(".html");
  const dirs = [...byDir].sort(([a], [b]) => a.localeCompare(b));
  const ordered = [
    ...dirs.flatMap(([dir, entries]) => entries.filter((f) => !isHtml(f)).map((f) => [dir, f])),
    ...dirs.flatMap(([dir, entries]) => entries.filter(isHtml).map((f) => [dir, f])),
  ];

  let done = 0;
  let currentDir = null;
  const started = Date.now();
  for (const [dir, f] of ordered) {
    if (dir !== currentDir) {
      await client.cd(root);
      if (dir) await client.ensureDir(dir);
      currentDir = dir;
    }
    await client.uploadFrom(join(distDir, f.rel), basename(f.rel));
    done++;
    if (process.stdout.isTTY) {
      const rate = done / Math.max(1, (Date.now() - started) / 1000);
      process.stdout.write(`\r  uploading… ${done}/${ordered.length} (${rate.toFixed(1)}/s)`);
    }
  }
  if (process.stdout.isTTY) process.stdout.write("\r\x1b[K");
  pass(`uploaded ${done}/${ordered.length} files in ${Math.round((Date.now() - started) / 1000)}s (assets first, HTML last)`);
}

/** Re-read the docroot and prove every local file landed at the right size. */
async function verifyUpload(client, root, localFiles) {
  head("Uploaded tree");
  await client.cd(root);
  const remote = await walkRemote(client);
  const remoteByRel = new Map(remote.files.map((f) => [f.rel, f.size]));

  const missing = localFiles.filter((f) => !remoteByRel.has(f.rel));
  const wrongSize = localFiles.filter((f) => remoteByRel.has(f.rel) && remoteByRel.get(f.rel) !== f.size);

  check(!missing.length, `all ${localFiles.length} files are on the server`, `${missing.length} file(s) missing from the docroot`);
  for (const f of missing.slice(0, 10)) console.log(`      missing ${f.rel}`);
  check(!wrongSize.length, "every uploaded file matches its local size", `${wrongSize.length} file(s) differ in size`);
  for (const f of wrongSize.slice(0, 10)) {
    console.log(`      ${f.rel}: local ${f.size} vs remote ${remoteByRel.get(f.rel)}`);
  }

  return remote;
}

// --- stage 6: prune ----------------------------------------------------------
// ⛔ FTP has no mirror-delete. Without this, a file dropped from dist/ is served
// from production forever. Sibling docroots on this account are NOT
// subdirectories of this one, so a prune here cannot reach them.

async function pruneOrphans(client, root, orphans, remoteDirs) {
  head("Prune");
  if (!orphans.length) {
    pass("no orphans — the docroot holds nothing this build did not produce");
    return;
  }

  const byDir = new Map();
  for (const f of orphans) {
    const dir = f.rel.includes("/") ? f.rel.slice(0, f.rel.lastIndexOf("/")) : "";
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push(f);
  }

  let removed = 0;
  let bytes = 0;
  for (const [dir, entries] of [...byDir].sort(([a], [b]) => a.localeCompare(b))) {
    await client.cd(root);
    if (dir) await client.cd(dir);
    for (const f of entries) {
      await client.remove(basename(f.rel));
      removed++;
      bytes += f.size;
      if (process.stdout.isTTY) process.stdout.write(`\r  deleting… ${removed}/${orphans.length}`);
    }
  }
  if (process.stdout.isTTY) process.stdout.write("\r\x1b[K");
  pass(`deleted ${removed} orphaned file(s), ${formatBytes(bytes)} reclaimed`);

  // Deepest first, so a directory emptied by the deletes above is gone by the time
  // its parent is tried. removeEmptyDir refuses a non-empty directory, which is the
  // safety property wanted here — removeDir would delete recursively.
  const deepestFirst = [...remoteDirs].sort((a, b) => b.split("/").length - a.split("/").length || b.localeCompare(a));
  let removedDirs = 0;
  for (const dir of deepestFirst) {
    if (isProtected(dir)) continue;
    try {
      await client.cd(root);
      await client.removeEmptyDir(dir);
      removedDirs++;
    } catch {
      /* still holds files — the normal case */
    }
  }
  if (removedDirs) pass(`removed ${removedDirs} empty director(ies)`);
}

// --- stage 7: prove it by public URL ----------------------------------------
// "Deployed" is a claim; this is the test. Transport-independent by design.

async function probe(url, { method = "GET", noCache = true } = {}) {
  // Cloudflare fronts this origin, so a plain re-fetch can answer from cache
  // and read as "the deploy did nothing".
  const target = noCache ? `${url}${url.includes("?") ? "&" : "?"}_cb=${Date.now()}${Math.random().toString(36).slice(2, 8)}` : url;
  const res = await fetch(target, {
    method,
    redirect: "manual",
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    signal: AbortSignal.timeout(30000),
  });
  let body = "";
  try {
    body = await res.text();
  } catch {
    /* empty body is fine */
  }
  return {
    status: res.status,
    location: res.headers.get("location"),
    lastModified: res.headers.get("last-modified"),
    header: (name) => res.headers.get(name),
    body,
  };
}

async function readLastModified() {
  try {
    const res = await probe(publicUrl, { method: "HEAD" });
    return res.lastModified;
  } catch {
    return null;
  }
}

async function verifyPublic(previousLastModified) {
  head("Public verification");

  // 1. The site answers, and — the cheapest possible proof that a publish
  //    actually reached the docroot — its Last-Modified moved. A commit is
  //    not a deploy; TASKS.md itself was burned by this once (3 extra days on
  //    a stale docroot after a "committed and pushed" read as "live").
  let homepage = null;
  try {
    homepage = await probe(publicUrl);
    check(homepage.status === 200, `GET / → 200 (Last-Modified ${homepage.lastModified ?? "?"})`, `GET / → ${homepage.status}`);
    if (previousLastModified) {
      check(
        homepage.lastModified !== previousLastModified,
        `Last-Modified moved (was ${previousLastModified})`,
        `Last-Modified did NOT move (still ${previousLastModified}) — the upload did not reach the served docroot`,
      );
    }
  } catch (err) {
    fail(`homepage probe failed: ${err.message.split("\n")[0]}`);
  }

  if (homepage?.body) {
    const ogUrl = homepage.body.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i)?.[1];
    check(ogUrl === ogExpected, `served og:url is ${ogExpected}`, `served og:url is ${ogUrl ?? "absent"} — this may not be one-click-video-downloader`);
  }

  // 2. The GitBook docs (Cloudflare-routed, outside this docroot) still answer.
  try {
    const res = await probe(`${publicUrl}/docs`);
    check(res.status === 200, "GET /docs → 200 (GitBook)", `GET /docs → ${res.status}`);
  } catch (err) {
    fail(`/docs probe failed: ${err.message.split("\n")[0]}`);
  }

  // 4. Crawl surface: these are the files that decide what a link preview or
  //    a search crawler sees.
  for (const path of ["/llms.txt", "/site.webmanifest", "/favicon/favicon.ico"]) {
    try {
      const res = await probe(`${publicUrl}${path}`, { method: "HEAD" });
      check(res.status === 200, `${path} → 200`, `${path} → ${res.status}`);
    } catch (err) {
      fail(`${path} probe failed: ${err.message.split("\n")[0]}`);
    }
  }
}

// --- main --------------------------------------------------------------------

async function main() {
  if (VERIFY_ONLY) {
    await verifyPublic(null);
    console.log(failures ? `\n\x1b[31m✗ ${failures} check(s) failed\x1b[0m` : "\n\x1b[32m✓ all public checks passed\x1b[0m");
    process.exit(failures ? 1 : 0);
  }

  buildPreflight();
  if (!(await processQuotaPreflight())) die("refused on the process quota (re-run with --force to override)");

  const previousLastModified = await readLastModified();
  let session = null;

  try {
    head("Connect");
    session = await connect();
    const { client, tls } = session;
    if (tls === "verified") pass(`FTPS to ${env.CPANEL_FTP_HOST}:${env.CPANEL_FTP_PORT || 21} (certificate verified)`);
    else if (tls === "unverified") warn(`FTPS to ${env.CPANEL_FTP_HOST} — encrypted, certificate NOT verified`);
    else warn(`plain FTP to ${env.CPANEL_FTP_HOST} — password sent in cleartext`);
    info(`login ${env.CPANEL_FTP_USER}`);

    const root = await enterDocroot(client);
    const names = (await client.list()).map((i) => i.name);
    assertDocrootIdentity(root, names);
    await assertSiteIdentity(client, root, names);

    const localFiles = walkLocal(distDir);
    const localBytes = localFiles.reduce((total, f) => total + f.size, 0);

    head("Index");
    await client.cd(root);
    const remote = await walkRemote(client);
    const remoteBytes = remote.files.reduce((total, f) => total + f.size, 0);
    info(`local  dist/: ${localFiles.length} files, ${formatBytes(localBytes)}`);
    info(`remote root:  ${remote.files.length} files, ${formatBytes(remoteBytes)}`);
    if (remote.symlinks.length) warn(`${remote.symlinks.length} symlink(s) present — never uploaded, never pruned`);

    const plan = planUpload(localFiles, remote);
    const orphanBytes = plan.orphans.reduce((total, f) => total + f.size, 0);

    head(PUBLISH ? "Publish" : "Dry run");
    info(`upload:    ${plan.created.length} new + ${plan.changed.length} changed  (${plan.unchanged.length} already current)`);
    info(`orphans:   ${plan.orphans.length} file(s), ${formatBytes(orphanBytes)} — ${PRUNE ? "WILL BE DELETED" : "left in place (pass --prune to delete)"}`);
    if (plan.protectedRemote.length) info(`protected: ${plan.protectedRemote.length} remote file(s) kept regardless (.well-known, cgi-bin, …)`);
    for (const f of plan.orphans.slice(0, 12)) console.log(`      orphan ${f.rel} (${formatBytes(f.size)})`);
    if (plan.orphans.length > 12) console.log(`      … and ${plan.orphans.length - 12} more`);

    if (!PUBLISH) {
      client.close();
      session = null;
      console.log("\n✓ dry run complete. Nothing was written.");
      console.log("  Re-run with --publish to upload" + (plan.orphans.length ? ", and --prune to delete the orphans." : "."));
      // This mode gates THIS BUILD. Production's current health is printed as
      // context, but a site that is already broken is not a reason to refuse a
      // dry run of a build that passed every check above.
      const buildFailures = failures;
      console.log("\n  Current live state, for reference:");
      await verifyPublic(null);
      if (failures > buildFailures) console.log(`\n  (${failures - buildFailures} live-state issue(s) above are pre-existing, not caused by this build)`);
      process.exit(buildFailures ? 1 : 0);
    }

    await uploadFiles(client, root, [...plan.created, ...plan.changed]);
    const afterUpload = await verifyUpload(client, root, localFiles);
    if (failures) die("the uploaded tree is incomplete — fix it before pruning");

    if (PRUNE) {
      const freshPlan = planUpload(localFiles, afterUpload);
      await pruneOrphans(client, root, freshPlan.orphans, afterUpload.dirs);
    }

    client.close();
    session = null;
  } finally {
    // A dangling FTP session is itself a leaked process on an account near its cap
    // — close it even when something above threw.
    if (session?.client) {
      try {
        session.client.close();
      } catch {
        /* already gone */
      }
    }
  }

  await verifyPublic(previousLastModified);

  if (failures) {
    console.log(`\n\x1b[31m✗ published, but ${failures} check(s) failed\x1b[0m`);
    process.exit(1);
  }
  console.log(`\n\x1b[32m✓ deployed and verified → ${publicUrl}\x1b[0m`);
}

main().catch((err) => die(err.stack || err.message));
