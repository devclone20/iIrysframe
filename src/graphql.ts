import { NETWORKS, config, type NetworkId } from "./config.js";

export interface IrysNode {
  id: string;
  timestamp: number | null;
  address: string | null;
  tags: { name: string; value: string }[];
}

const QUERY = `
  query Vault($owners: [String!], $tags: [TagFilter!], $limit: Int) {
    transactions(owners: $owners, tags: $tags, first: $limit, order: DESC) {
      edges {
        node {
          id
          timestamp
          address
          tags { name value }
        }
      }
    }
  }
`;

/**
 * Query the authoritative Irys index (GraphQL) for uploads tagged by this app,
 * optionally scoped to an owner. This is the "source of truth" the local
 * manifest mirrors — used to reconcile / recover the vault on any machine.
 */
export async function queryAssets(
  network: NetworkId,
  opts: { owner?: string | null; tags?: { name: string; values: string[] }[]; limit?: number } = {},
): Promise<IrysNode[]> {
  const net = NETWORKS[network];
  const tags = opts.tags ?? [{ name: "App-Name", values: [config.appName] }];
  const variables = {
    owners: opts.owner ? [opts.owner] : undefined,
    tags,
    limit: Math.min(opts.limit ?? 100, 1000),
  };

  const res = await fetch(net.graphql, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: QUERY, variables }),
  });

  if (!res.ok) {
    throw new Error(`Irys GraphQL ${res.status}: ${await res.text().catch(() => res.statusText)}`);
  }
  const json = (await res.json()) as any;
  if (json.errors) {
    throw new Error(`Irys GraphQL error: ${JSON.stringify(json.errors).slice(0, 300)}`);
  }
  const edges = json?.data?.transactions?.edges ?? [];
  return edges.map((e: any) => e.node as IrysNode);
}
