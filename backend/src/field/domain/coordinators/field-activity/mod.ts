/**
 * REQ-566 (demo-loop cycle 4, m11) — a field job finished is the owner's
 * activity. The dashboard's "What we handled today" reads the notifications
 * feed (REQ-299); a worker's check-off never reached it, so after Carlos
 * finished a $450 job the panel still said "Nothing yet". This announces the
 * completion on the bus with the names the feed line shows.
 */
import { Injectable } from "#danet/core";
import { EventBus } from "@core/business/events/mod.ts";
import { FieldViews } from "@field/domain/coordinators/field-views/mod.ts";
import type { FieldTask } from "@field/dto/field.ts";

@Injectable()
export class FieldActivity {
  constructor(private views: FieldViews, private bus: EventBus) {}

  /** `task:completed` — `worker` is the worker who checked it off; the
   *  office's own check-off names nobody. */
  async taskCompleted(t: FieldTask, worker?: string): Promise<void> {
    const n = await this.views.names(t.userId);
    const customerName = n.customer(t.customerId);
    await this.bus.emit({
      userId: t.userId,
      entityType: "task",
      entityId: t.id,
      action: "completed",
      data: {
        task: n.type(t.taskTypeId),
        ...(customerName && customerName !== "—" ? { customerName } : {}),
        ...(worker ? { worker } : {}),
      },
    });
  }
}
