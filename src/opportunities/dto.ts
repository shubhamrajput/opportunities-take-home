import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class CreateOpportunityDto {
  @IsUUID('4')
  pipelineId!: string;

  @IsUUID('4')
  stageId!: string;

  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  @Matches(/^-?\d{1,16}(?:\.\d{1,2})?$/)
  value?: string;

  @IsOptional()
  @IsUUID('4')
  ownerId?: string | null;
}

export class MoveOpportunityStageDto {
  @IsUUID('4')
  stageId!: string;

  @IsOptional()
  @IsUUID('4')
  changedBy?: string | null;
}

export class OpportunityPaginationQuery {
  @IsUUID('4')
  stageId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  limit?: number;
}
