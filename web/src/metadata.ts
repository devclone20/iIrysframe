// ERC-721 metadata assembly (OpenSea-compatible).

export interface Attribute {
  trait_type: string;
  value: string | number;
}

export interface MetadataInput {
  name: string;
  description?: string;
  image: string; // final image gateway URL
  attributes?: Attribute[];
  external_url?: string;
  animation_url?: string;
  /** Six-character hex (no leading #) — OpenSea renders it behind the item. */
  background_color?: string;
  /** The AI agent "soul" (see soul.ts) — makes the NFT an ownable agent identity. */
  ai_soul?: Record<string, unknown>;
}

export interface ERC721Metadata {
  name: string;
  description: string;
  image: string;
  /** Mirror of `image` — some marketplace indexers read this field instead. */
  image_url?: string;
  attributes: Attribute[];
  external_url?: string;
  animation_url?: string;
  background_color?: string;
  ai_soul?: Record<string, unknown>;
}

/** Normalize "#F7d9E3" / "f7d9e3" → "F7D9E3" (OpenSea wants 6 hex chars, no #). */
function normalizeHex(v?: string): string | undefined {
  if (!v) return undefined;
  const h = v.replace(/^#/, "").trim().toUpperCase();
  return /^[0-9A-F]{6}$/.test(h) ? h : undefined;
}

export function buildMetadata(input: MetadataInput): ERC721Metadata {
  const meta: ERC721Metadata = {
    name: input.name,
    description: input.description ?? "",
    image: input.image,
    image_url: input.image,
    attributes: input.attributes ?? [],
  };
  if (input.external_url) meta.external_url = input.external_url;
  if (input.animation_url) meta.animation_url = input.animation_url;
  const bg = normalizeHex(input.background_color);
  if (bg) meta.background_color = bg;
  if (input.ai_soul && Object.keys(input.ai_soul).length) meta.ai_soul = input.ai_soul;
  return meta;
}

export function metadataToBytes(meta: ERC721Metadata): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(meta, null, 2));
}
