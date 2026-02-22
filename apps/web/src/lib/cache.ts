type CacheEntry<V> = {
  value: V;
  expiresAt: number;
};

export class LruCache<K, V> {
  #map = new Map<K, CacheEntry<V>>();
  #max: number;
  #ttlMs: number;

  constructor(max: number, ttlSeconds: number) {
    this.#max = Math.max(1, max);
    this.#ttlMs = Math.max(1, ttlSeconds) * 1000;
  }

  get(key: K) {
    const entry = this.#map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.#map.delete(key);
      return undefined;
    }
    this.#map.delete(key);
    this.#map.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V) {
    if (this.#map.has(key)) {
      this.#map.delete(key);
    } else if (this.#map.size >= this.#max) {
      const iterator = this.#map.keys().next();
      if (!iterator.done) {
        this.#map.delete(iterator.value);
      }
    }

    this.#map.set(key, {
      value,
      expiresAt: Date.now() + this.#ttlMs,
    });
  }
}
