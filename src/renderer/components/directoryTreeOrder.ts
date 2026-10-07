export const DIRECTORY_TREE_ORDER_KEY = "library.directoryTreeOrder.v1";
export const ROOT_ORDER_SCOPE = "sources";
export type DirectoryTreeOrders = Map<string, string[]>;

/** UI preferences only: identities remain scoped to their original parent. */
export function readDirectoryTreeOrders(): DirectoryTreeOrders {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(DIRECTORY_TREE_ORDER_KEY) ?? "null");
    if (!saved || typeof saved !== "object" || !("version" in saved) || saved.version !== 1 || !("scopes" in saved) || !Array.isArray(saved.scopes)) return new Map();
    const orders: DirectoryTreeOrders = new Map();
    for (const entry of saved.scopes) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || !Array.isArray(entry[1]) || !entry[1].every((id: unknown) => typeof id === "string")) continue;
      orders.set(entry[0], [...new Set<string>(entry[1])]);
    }
    return orders;
  } catch { return new Map(); }
}

export function orderDirectorySiblings<T>(items: T[], order: string[] | undefined, identity: (item: T) => string): T[] {
  if (!order?.length) return items;
  const ranks = new Map(order.map((id, index) => [id, index]));
  return [...items].sort((a, b) => (ranks.get(identity(a)) ?? order.length) - (ranks.get(identity(b)) ?? order.length));
}

export function moveDirectorySibling(ids: string[], dragged: string, target: string, after: boolean): string[] | null {
  if (dragged === target || !ids.includes(dragged) || !ids.includes(target)) return null;
  const next = ids.filter((id) => id !== dragged);
  next.splice(next.indexOf(target) + Number(after), 0, dragged);
  return next.every((id, index) => id === ids[index]) ? null : next;
}
