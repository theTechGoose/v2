import { IsOptional, IsString, validateSync } from "#class-validator";
import { plainToInstance } from "#class-transformer";

export class CreateCustomerDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export interface Customer extends CreateCustomerDto {
  id: string;
  /** Owner. Populated server-side from the auth context — never accept from request body. */
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export function parseCreateCustomer(input: unknown): CreateCustomerDto {
  const dto = plainToInstance(CreateCustomerDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid customer: ${JSON.stringify(errors)}`);
  return dto;
}

export function parseUpdateCustomer(input: unknown): UpdateCustomerDto {
  const dto = plainToInstance(UpdateCustomerDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid customer patch: ${JSON.stringify(errors)}`);
  return dto;
}
