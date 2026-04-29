import { Module } from "#danet/core";
import { UsersModule } from "@users/mod-root.ts";
import { FilesController } from "@files/entrypoints/files-controller/mod.ts";
import { FileStore } from "@files/domain/data/file-store/mod.ts";

/**
 * FilesModule — cross-cutting blob storage consumed by paperwork (PDFs),
 * profile (W-9s), and agents (voice clips).
 */
@Module({
  imports: [UsersModule],
  controllers: [FilesController],
  injectables: [FileStore],
})
export class FilesModule {}
