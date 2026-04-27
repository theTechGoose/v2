import { IsString, validateSync } from "#class-validator";
import { plainToInstance } from "#class-transformer";

export class Entity {
  @IsString()
  id!: string;

  @IsString()
  createdAt!: string;

  @IsString()
  updatedAt!: string;
}

export function parseAs<T extends object>(
  cls: new () => T,
  input: unknown,
  label: string,
): T {
  const instance = plainToInstance(cls, input);
  const errors = validateSync(instance as object);
  if (errors.length) {
    throw new Error(`invalid ${label}: ${JSON.stringify(errors)}`);
  }
  return instance;
}
