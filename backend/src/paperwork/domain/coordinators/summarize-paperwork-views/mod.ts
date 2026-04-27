import { Injectable } from "#danet/core";
import { ViewStore } from "@paperwork/domain/data/view-store/mod.ts";
import { summarize, type ViewStats } from "@paperwork/domain/business/view-stats/mod.ts";
import type { PaperworkType, View } from "@paperwork/dto/view.ts";

export interface PaperworkViewSummary {
  paperworkType: PaperworkType;
  paperworkId: string;
  views: View[];
  stats: ViewStats;
}

@Injectable()
export class SummarizePaperworkViews {
  constructor(private views: ViewStore) {}

  async run(paperworkType: PaperworkType, paperworkId: string): Promise<PaperworkViewSummary> {
    const views = await this.views.listByPaperwork(paperworkType, paperworkId);
    const stats = summarize(views);
    return { paperworkType, paperworkId, views, stats };
  }
}
