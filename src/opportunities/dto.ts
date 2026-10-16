import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsObject,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  Validate,
  ValidateNested,
} from 'class-validator';
import { OpportunityStatus } from '../generated/prisma/client.js';
import {
  CreatedBeforeNotEarlierThanCreatedAfterConstraint,
  MaxValueNotBelowMinValueConstraint,
} from './range.validators.js';

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

export class BulkMoveFiltersDto {
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  stageIds?: string[];

  @IsOptional()
  @IsUUID('4')
  ownerId?: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsEnum(OpportunityStatus, { each: true })
  statuses?: OpportunityStatus[];

  @IsOptional()
  @IsString()
  @Matches(/^-?\d{1,16}(?:\.\d{1,2})?$/)
  minValue?: string;

  @IsOptional()
  @IsString()
  @Matches(/^-?\d{1,16}(?:\.\d{1,2})?$/)
  @Validate(MaxValueNotBelowMinValueConstraint, ['minValue'])
  maxValue?: string;

  @IsOptional()
  @IsDateString()
  createdAfter?: string;

  @IsOptional()
  @IsDateString()
  @Validate(CreatedBeforeNotEarlierThanCreatedAfterConstraint, ['createdAfter'])
  createdBefore?: string;
}

export class CreateBulkMoveDto {
  @IsUUID('4')
  targetStageId!: string;

  @IsObject()
  @ValidateNested()
  @Type(() => BulkMoveFiltersDto)
  filters!: BulkMoveFiltersDto;
}
