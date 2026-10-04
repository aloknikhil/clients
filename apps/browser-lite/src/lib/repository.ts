import type { Repository } from "@bitwarden/sdk-internal";

/**
 * SDK client-managed repository persisted in `chrome.storage.local`.
 *
 * Each repository stores one record (`<name>` -> `{ [id]: T }`) instead of one key per
 * item: storage calls are the expensive part, and a vault sync rewrites everything anyway.
 * Values are the SDK's encrypted domain objects, never decrypted views.
 */
export class StorageRepository<T> implements Repository<T> {
  private cache?: Record<string, T>;

  constructor(
    private readonly name: string,
    private readonly area: chrome.storage.StorageArea = chrome.storage.local,
  ) {}

  async get(id: string): Promise<T | null> {
    return (await this.load())[id] ?? null;
  }

  async list(): Promise<T[]> {
    return Object.values(await this.load());
  }

  async set(id: string, value: T): Promise<void> {
    await this.mutate((all) => {
      all[id] = value;
    });
  }

  async setBulk(values: [string, T][]): Promise<void> {
    await this.mutate((all) => {
      for (const [id, value] of values) {
        all[id] = value;
      }
    });
  }

  async remove(id: string): Promise<void> {
    await this.mutate((all) => {
      delete all[id];
    });
  }

  async removeBulk(keys: string[]): Promise<void> {
    await this.mutate((all) => {
      for (const id of keys) {
        delete all[id];
      }
    });
  }

  async removeAll(): Promise<void> {
    this.cache = {};
    await this.area.remove(this.name);
  }

  /** Replaces the full contents in one write, used by sync. */
  async replaceAll(values: Record<string, T>): Promise<void> {
    this.cache = values;
    await this.area.set({ [this.name]: values });
  }

  private async load(): Promise<Record<string, T>> {
    if (this.cache === undefined) {
      const stored = await this.area.get(this.name);
      this.cache = (stored[this.name] as Record<string, T> | undefined) ?? {};
    }
    return this.cache;
  }

  private async mutate(fn: (all: Record<string, T>) => void): Promise<void> {
    const all = { ...(await this.load()) };
    fn(all);
    await this.replaceAll(all);
  }
}
