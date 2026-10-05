/** Bounded LRU, with both entry and payload limits. Expiry also frees memory. */
export class WeightedExpiringCache<Key, Value> {
  private readonly entries = new Map<Key, { value: Value; expiresAt: number; weight: number }>();
  private weight = 0;
  constructor(private readonly maxEntries: number, private readonly maxWeight: number, private readonly now = Date.now) {}
  get(key: Key): Value | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) { this.remove(key); return undefined; }
    this.entries.delete(key); this.entries.set(key, entry);
    return entry.value;
  }
  set(key: Key, value: Value, expiresAt: number, weight: number): void {
    this.remove(key);
    for (const [candidate, entry] of this.entries) if (entry.expiresAt <= this.now()) this.remove(candidate);
    if (weight > this.maxWeight || expiresAt <= this.now()) return;
    this.entries.set(key, { value, expiresAt, weight }); this.weight += weight;
    while (this.entries.size > this.maxEntries || this.weight > this.maxWeight) this.remove(this.entries.keys().next().value!);
  }
  clear(): void { this.entries.clear(); this.weight = 0; }
  private remove(key: Key): void {
    const entry = this.entries.get(key);
    if (entry) { this.weight -= entry.weight; this.entries.delete(key); }
  }
}
