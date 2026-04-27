import { Injectable } from "#danet/core";

/**
 * Domain event the EventBus carries.
 *
 *   userId       — the contractor whose data changed (notifications scope to this)
 *   entityType   — 'quote' | 'contract' | 'invoice' | 'customer' | 'payment'
 *   entityId     — the record's id (so subscribers can hyperlink)
 *   action       — verb, e.g. 'sent', 'accepted', 'signed', 'paid', 'overdue', 'replied'
 *   data         — optional structured payload for richer notifications (amounts, names…)
 *   timestamp    — ISO; set by emit() if the caller doesn't supply one
 */
export interface DomainEvent {
  userId:     string;
  entityType: "quote" | "contract" | "invoice" | "customer" | "payment" | "conversation" | "message";
  entityId:   string;
  action:     string;
  data?:      Record<string, unknown>;
  timestamp:  string;
}

export type EventListener = (event: DomainEvent) => void | Promise<void>;

/**
 * EventBus — in-process pub/sub.
 *
 * Synchronous fan-out: when a controller emits, every subscribed listener
 * fires before emit() returns. Listeners that throw don't take down the
 * publisher (we catch + log) — but they DO see each other's exceptions
 * via the returned Promise.allSettled if you await emit().
 *
 * For v1 we don't need cross-process pub/sub. Migrating to Redis or
 * NATS later just means swapping the implementation behind this interface.
 *
 * Singleton-ish: registered as a Danet @Injectable. Modules that need to
 * subscribe (notification, analytics, audit log) inject EventBus and call
 * .subscribe() in their constructor.
 */
@Injectable()
export class EventBus {
  private listeners: EventListener[] = [];

  subscribe(listener: EventListener): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  async emit(event: Omit<DomainEvent, "timestamp"> & { timestamp?: string }): Promise<void> {
    const fullEvent: DomainEvent = { ...event, timestamp: event.timestamp ?? new Date().toISOString() };
    const results = await Promise.allSettled(this.listeners.map((l) => Promise.resolve().then(() => l(fullEvent))));
    for (const r of results) {
      if (r.status === "rejected") {
        // Don't crash the publisher. A failing notification listener
        // shouldn't stop a quote from being saved. Log loud-ish.
        console.error("[EventBus] listener threw:", r.reason);
      }
    }
  }

  /** Test-only: drop all subscribers between tests. */
  reset(): void {
    this.listeners = [];
  }
}
