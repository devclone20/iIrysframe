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
  /** The AI agent "soul" (see soul.ts) — makes the NFT an ownable agent identity. */
  ai_soul?: Record<string, unknown>;
}

export interface ERC721Metadata {
  name: string;
  description: string;
  image: string;
  attributes: Attribute[];
  external_url?: string;
  animation_url?: string;
  ai_soul?: Record<string, unknown>;
}

export function buildMetadata(input: MetadataInput): ERC721Metadata {
  const meta: ERC721Metadata = {
    name: input.name,
    description: input.description ?? "",
    image: input.image,
    attributes: input.attributes ?? [],
  };
  if (input.external_url) meta.external_url = input.external_url;
  if (input.animation_url) meta.animation_url = input.animation_url;
  if (input.ai_soul && Object.keys(input.ai_soul).length) meta.ai_soul = input.ai_soul;
  return meta;
}

export function metadataToBytes(meta: ERC721Metadata): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(meta, null, 2));
}
