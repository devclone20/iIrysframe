// Drop manifest: an Arweave path-manifest sealed on Irys that maps token ids
// ("1", "2", …) to each item's sealed metadata transaction. The gateway then
// serves `gateway.irys.xyz/<manifestId>/1` → metadata #1, which is exactly the
// shape CloneForge's `dropBaseURI + tokenId` needs for sequential public drops.

import { GATEWAY, type Tag } from "../config";
import { uploadData, type UploadOut } from "../irys";

export interface ManifestOut {
  id: string;
  baseURI: string; // gateway/<id>/ — set this as dropBaseURI
}

export async function sealDropManifest(
  irys: any,
  metadataIds: string[], // sealed metadata tx ids, in token order (token 1 first)
  collection: string,
): Promise<ManifestOut> {
  const paths: Record<string, { id: string }> = {};
  metadataIds.forEach((id, i) => {
    paths[String(i + 1)] = { id };
  });
  const manifest = {
    manifest: "arweave/paths",
    version: "0.1.0",
    paths,
  };
  const tags: Tag[] = [
    { name: "App-Name", value: "iIrys Frame" },
    { name: "Type", value: "drop-manifest" },
    { name: "Name", value: `${collection} — drop manifest` },
    ...(collection.trim() ? [{ name: "Collection", value: collection.trim() }] : []),
  ];
  const out: UploadOut = await uploadData(
    irys,
    new TextEncoder().encode(JSON.stringify(manifest)),
    "application/x.arweave-manifest+json",
    tags,
  );
  return { id: out.id, baseURI: `${GATEWAY}/${out.id}/` };
}
