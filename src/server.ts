import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyMultipart from "@fastify/multipart";
import { z } from "zod";
import { config, NETWORKS, FREE_THRESHOLD_BYTES, type NetworkId } from "./config.js";
import {
  getStatus,
  getPrice,
  fund,
  uploadFile,
  uploadJSON,
} from "./irys.js";
import { appendAsset, listAssets, stats, type ManifestEntry } from "./manifest.js";
import { queryAssets } from "./graphql.js";

const app = Fastify({
  logger: config.verbose ? true : { level: "warn" },
  bodyLimit: 5 * 1024 * 1024, // JSON bodies (metadata) — files go through multipart
});

await app.register(fastifyMultipart, {
  limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 20 },
});

await app.register(fastifyStatic, {
  root: config.publicDir,
  prefix: "/",
  index: ["index.html"],
});

// ── helpers ────────────────────────────────────────────────────────────────
function parseNetwork(v: unknown): NetworkId {
  return v === "mainnet" ? "mainnet" : "devnet";
}

function fail(reply: any, status: number, message: string) {
  reply.code(status);
  return { ok: false, error: message };
}

/** Guard write routes when a VAULT_TOKEN is configured. */
function assertWriteAuth(req: any): void {
  if (!config.vaultToken) return;
  const header = req.headers["x-vault-token"];
  if (header !== config.vaultToken) {
    const err: any = new Error("Unauthorized: missing or invalid x-vault-token.");
    err.statusCode = 401;
    throw err;
  }
}

// ── meta ─────────────────────────────────────────────────────────────────--
app.get("/api/health", async () => ({ ok: true, app: config.appName, time: new Date().toISOString() }));

app.get("/api/config", async () => ({
  ok: true,
  app: config.appName,
  defaultNetwork: config.defaultNetwork,
  hasKey: config.hasKey,
  authRequired: Boolean(config.vaultToken),
  fundMaxEth: config.fundMaxEth,
  freeThresholdBytes: FREE_THRESHOLD_BYTES,
  networks: Object.values(NETWORKS).map((n) => ({
    id: n.id,
    label: n.label,
    gateway: n.gateway,
    permanent: n.permanent,
  })),
}));

// ── status / price ─────────────────────────────────────────────────────────
app.get("/api/status", async (req, reply) => {
  const network = parseNetwork((req.query as any)?.network);
  try {
    return { ok: true, status: await getStatus(network) };
  } catch (err: any) {
    return fail(reply, 502, err?.message ?? "Failed to read status from Irys.");
  }
});

app.get("/api/price", async (req, reply) => {
  const q = req.query as any;
  const network = parseNetwork(q?.network);
  const bytes = Number.parseInt(q?.bytes ?? "0", 10);
  if (!Number.isFinite(bytes) || bytes < 0) return fail(reply, 400, "Invalid 'bytes'.");
  try {
    return { ok: true, quote: await getPrice(network, bytes) };
  } catch (err: any) {
    return fail(reply, 502, err?.message ?? "Failed to price upload.");
  }
});

// ── fund ─────────────────────────────────────────────────────────────────--
const fundSchema = z.object({
  network: z.enum(["mainnet", "devnet"]).optional(),
  eth: z.number().positive(),
});

app.post("/api/fund", async (req, reply) => {
  try {
    assertWriteAuth(req);
  } catch (err: any) {
    return fail(reply, err.statusCode ?? 401, err.message);
  }
  const parsed = fundSchema.safeParse(req.body);
  if (!parsed.success) return fail(reply, 400, parsed.error.issues[0]?.message ?? "Invalid body.");
  const network = parseNetwork(parsed.data.network ?? config.defaultNetwork);
  try {
    return { ok: true, result: await fund(network, parsed.data.eth) };
  } catch (err: any) {
    return fail(reply, 400, err?.message ?? "Funding failed.");
  }
});

// ── upload file ──────────────────────────────────────────────────────────--
app.post("/api/upload", async (req, reply) => {
  try {
    assertWriteAuth(req);
  } catch (err: any) {
    return fail(reply, err.statusCode ?? 401, err.message);
  }

  let buffer: Buffer | null = null;
  let filename = "asset";
  let mimetype = "application/octet-stream";
  const fields: Record<string, string> = {};

  try {
    const parts = (req as any).parts();
    for await (const part of parts) {
      if (part.type === "file") {
        buffer = await part.toBuffer();
        filename = part.filename || filename;
        mimetype = part.mimetype || mimetype;
      } else {
        fields[part.fieldname] = part.value;
      }
    }
  } catch (err: any) {
    return fail(reply, 400, err?.message ?? "Failed to read upload.");
  }

  if (!buffer || buffer.length === 0) return fail(reply, 400, "No file received.");

  const network = parseNetwork(fields.network ?? config.defaultNetwork);
  const name = (fields.name || filename).slice(0, 200);
  const meta: Record<string, string> = {};
  if (fields.collection) meta.Collection = fields.collection.slice(0, 120);
  if (fields.tier) meta.Tier = fields.tier.slice(0, 60);
  if (fields.traits) {
    // optional JSON of {trait_type: value} → individual tags
    try {
      const traits = JSON.parse(fields.traits);
      for (const [k, v] of Object.entries(traits)) {
        if (k && v != null) meta[`Trait:${k}`.slice(0, 60)] = String(v).slice(0, 120);
      }
    } catch {
      /* ignore malformed traits */
    }
  }

  try {
    const result = await uploadFile(network, buffer, mimetype, name, meta);
    const entry: ManifestEntry = {
      ...result,
      collection: fields.collection || undefined,
      tier: fields.tier || undefined,
    };
    await appendAsset(entry);
    return { ok: true, asset: entry };
  } catch (err: any) {
    return fail(reply, 502, err?.message ?? "Upload to Irys failed.");
  }
});

// ── upload metadata (ERC-721 JSON) ──────────────────────────────────────────
const metaSchema = z.object({
  network: z.enum(["mainnet", "devnet"]).optional(),
  name: z.string().min(1),
  description: z.string().optional().default(""),
  image: z.string().min(1),
  external_url: z.string().optional(),
  animation_url: z.string().optional(),
  collection: z.string().optional(),
  tier: z.string().optional(),
  attributes: z
    .array(z.object({ trait_type: z.string(), value: z.union([z.string(), z.number()]) }))
    .optional()
    .default([]),
});

app.post("/api/metadata", async (req, reply) => {
  try {
    assertWriteAuth(req);
  } catch (err: any) {
    return fail(reply, err.statusCode ?? 401, err.message);
  }
  const parsed = metaSchema.safeParse(req.body);
  if (!parsed.success) return fail(reply, 400, parsed.error.issues[0]?.message ?? "Invalid metadata.");
  const d = parsed.data;
  const network = parseNetwork(d.network ?? config.defaultNetwork);

  const json: Record<string, unknown> = {
    name: d.name,
    description: d.description,
    image: d.image,
    attributes: d.attributes,
  };
  if (d.external_url) json.external_url = d.external_url;
  if (d.animation_url) json.animation_url = d.animation_url;

  const meta: Record<string, string> = {};
  if (d.collection) meta.Collection = d.collection;
  if (d.tier) meta.Tier = d.tier;

  try {
    const result = await uploadJSON(network, json, `${d.name} — metadata`, meta);
    const entry: ManifestEntry = {
      ...result,
      collection: d.collection,
      tier: d.tier,
    };
    await appendAsset(entry);
    return { ok: true, asset: entry, metadata: json };
  } catch (err: any) {
    return fail(reply, 502, err?.message ?? "Metadata upload failed.");
  }
});

// ── vault listing ────────────────────────────────────────────────────────--
app.get("/api/assets", async () => ({ ok: true, assets: listAssets(), stats: stats() }));

app.get("/api/assets/remote", async (req, reply) => {
  const q = req.query as any;
  const network = parseNetwork(q?.network);
  try {
    const nodes = await queryAssets(network, { owner: q?.owner || undefined, limit: 100 });
    return { ok: true, nodes, gateway: NETWORKS[network].gateway };
  } catch (err: any) {
    return fail(reply, 502, err?.message ?? "Irys GraphQL query failed.");
  }
});

// ── boot ─────────────────────────────────────────────────────────────────--
app
  .listen({ port: config.port, host: config.host })
  .then(() => {
    const url = `http://${config.host}:${config.port}`;
    app.log.warn(`iIrys Frame ready → ${url}`);
    // Always print a friendly line even at warn level.
    console.log(`\n  ◈ iIrys Frame  →  ${url}`);
    console.log(`     network: ${config.defaultNetwork}   key: ${config.hasKey ? "loaded" : "read-only"}\n`);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
