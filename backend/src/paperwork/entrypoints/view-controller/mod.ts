import { Body, Controller, Delete, Get, Param, Post, Put, Query } from "#danet/core";
import { ViewStore } from "@paperwork/domain/data/view-store/mod.ts";
import { SummarizePaperworkViews } from "@paperwork/domain/coordinators/summarize-paperwork-views/mod.ts";
import { parseCreateView, parseUpdateView, type PaperworkType } from "@paperwork/dto/view.ts";

@Controller("views")
export class ViewController {
  constructor(
    private store: ViewStore,
    private summarize: SummarizePaperworkViews,
  ) {}

  @Post()
  create(@Body() body: unknown) {
    return this.store.create(parseCreateView(body));
  }

  @Get()
  list(
    @Query("paperworkType") paperworkType?: string,
    @Query("paperworkId") paperworkId?: string,
  ) {
    if (paperworkType && paperworkId) {
      return this.store.listByPaperwork(paperworkType as PaperworkType, paperworkId);
    }
    if (paperworkType) {
      return this.store.listByType(paperworkType as PaperworkType);
    }
    return this.store.list();
  }

  @Get("summary/:paperworkType/:paperworkId")
  summary(
    @Param("paperworkType") paperworkType: string,
    @Param("paperworkId") paperworkId: string,
  ) {
    return this.summarize.run(paperworkType as PaperworkType, paperworkId);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.store.get(id);
  }

  @Put(":id")
  update(@Param("id") id: string, @Body() body: unknown) {
    return this.store.update(id, parseUpdateView(body));
  }

  @Delete(":id")
  async delete(@Param("id") id: string) {
    await this.store.delete(id);
    return { ok: true };
  }
}
