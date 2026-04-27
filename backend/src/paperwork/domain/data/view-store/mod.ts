import { Injectable } from "#danet/core";
import { Repository, type StoredEntity } from "@core/data/repository/mod.ts";
import type {
  View,
  CreateViewDto,
  UpdateViewDto,
  PaperworkType,
} from "@paperwork/dto/view.ts";

type StoredView = View & StoredEntity;

@Injectable()
export class ViewStore {
  private repo = new Repository<StoredView>("view");

  create(input: CreateViewDto): Promise<View> { return this.repo.create(input); }
  get(id: string): Promise<View> { return this.repo.get(id); }
  list(): Promise<View[]> { return this.repo.list(); }

  async listByPaperwork(paperworkType: PaperworkType, paperworkId: string): Promise<View[]> {
    const all = await this.repo.list();
    return all.filter((v) => v.paperworkType === paperworkType && v.paperworkId === paperworkId);
  }

  async listByType(paperworkType: PaperworkType): Promise<View[]> {
    const all = await this.repo.list();
    return all.filter((v) => v.paperworkType === paperworkType);
  }

  update(id: string, patch: UpdateViewDto): Promise<View> { return this.repo.update(id, patch); }
  delete(id: string): Promise<void> { return this.repo.delete(id); }
}
