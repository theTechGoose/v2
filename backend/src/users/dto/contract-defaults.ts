import { IsIn, IsInt, IsOptional, IsString, Min, validateSync } from "#class-validator";
import { plainToInstance } from "#class-transformer";

export type DisputeMethod = "mediation" | "arbitration" | "court";

export interface ContractDefaults {
  userId: string;
  defaultTerms?: string;
  paymentInstructions?: string;
  paymentTermsTemplateId?: string;
  warrantyMonths?: number;
  terminationNoticeDays?: number;
  disputeResolution?: DisputeMethod;
  governingState?: string;
  createdAt: string;
  updatedAt: string;
}

export class UpdateContractDefaultsDto {
  @IsOptional()
  @IsString()
  defaultTerms?: string;

  @IsOptional()
  @IsString()
  paymentInstructions?: string;

  @IsOptional()
  @IsString()
  paymentTermsTemplateId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  warrantyMonths?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  terminationNoticeDays?: number;

  @IsOptional()
  @IsIn(["mediation", "arbitration", "court"])
  disputeResolution?: DisputeMethod;

  @IsOptional()
  @IsString()
  governingState?: string;
}

export function parseUpdateContractDefaults(input: unknown): UpdateContractDefaultsDto {
  const dto = plainToInstance(UpdateContractDefaultsDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid contract defaults: ${JSON.stringify(errors)}`);
  return dto;
}
