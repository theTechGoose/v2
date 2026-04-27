import { getKv } from "@core/data/kv/mod.ts";

export interface StoredEntity {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export class NotFoundError extends Error {
  constructor(public resource: string, public id: string) {
    super(`${resource} ${id} not found`);
    this.name = "NotFoundError";
  }
}

/** Thrown when an authenticated user tries to access another user's record. */
export class ForbiddenError extends Error {
  constructor(public resource: string, public id: string) {
    super(`${resource} ${id} not accessible`);
    this.name = "ForbiddenError";
  }
}

export class Repository<T extends StoredEntity> {
  constructor(private prefix: string) {}

  async create(input: Omit<T, "id" | "createdAt" | "updatedAt">): Promise<T> {
    const kv = await getKv();
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const entity = { ...(input as object), id, createdAt: now, updatedAt: now } as T;
    await kv.set([this.prefix, id], entity);
    return entity;
  }

  async get(id: string): Promise<T> {
    const kv = await getKv();
    const result = await kv.get<T>([this.prefix, id]);
    if (!result.value) throw new NotFoundError(this.prefix, id);
    return result.value;
  }

  async list(): Promise<T[]> {
    const kv = await getKv();
    const items: T[] = [];
    for await (const entry of kv.list<T>({ prefix: [this.prefix] })) {
      items.push(entry.value);
    }
    return items;
  }

  async update(id: string, patch: Partial<Omit<T, "id" | "createdAt">>): Promise<T> {
    const existing = await this.get(id);
    const definedPatch = Object.fromEntries(
      Object.entries(patch as object).filter(([_, v]) => v !== undefined),
    );
    const updated = {
      ...existing,
      ...definedPatch,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    } as T;
    const kv = await getKv();
    await kv.set([this.prefix, id], updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    await this.get(id);
    const kv = await getKv();
    await kv.delete([this.prefix, id]);
  }
}
