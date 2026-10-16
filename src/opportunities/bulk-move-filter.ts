import {
  OpportunityStatus,
  Prisma,
} from '../generated/prisma/client.js';

export type StoredFilters = {
  stageIds?: string[];
  ownerId?: string;
  statuses?: OpportunityStatus[];
  minValue?: string;
  maxValue?: string;
  createdAfter?: string;
  createdBefore?: string;
};

export type BulkMoveFilterScope = {
  workspaceId: string;
  pipelineId: string;
  targetStageId: string;
};

export function parseBulkMoveFilters(value: Prisma.JsonValue): StoredFilters {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Bulk-move job contains invalid filters');
  }

  const source = value as Record<string, unknown>;
  const readString = (key: string): string | undefined => {
    const item = source[key];
    if (item === undefined) return undefined;
    if (typeof item !== 'string') {
      throw new Error(`Bulk-move filter ${key} must be a string`);
    }
    return item;
  };
  const readStringArray = (key: string): string[] | undefined => {
    const item = source[key];
    if (item === undefined) return undefined;
    if (!Array.isArray(item) || !item.every((entry) => typeof entry === 'string')) {
      throw new Error(`Bulk-move filter ${key} must be an array of strings`);
    }
    return item;
  };

  return {
    stageIds: readStringArray('stageIds'),
    ownerId: readString('ownerId'),
    statuses: readStringArray('statuses') as OpportunityStatus[] | undefined,
    minValue: readString('minValue'),
    maxValue: readString('maxValue'),
    createdAfter: readString('createdAfter'),
    createdBefore: readString('createdBefore'),
  };
}

export function buildOpportunityWhere(
  scope: BulkMoveFilterScope,
  filters: StoredFilters,
): Prisma.OpportunityWhereInput {
  return {
    workspaceId: scope.workspaceId,
    pipelineId: scope.pipelineId,
    stageId: {
      not: scope.targetStageId,
      ...(filters.stageIds?.length ? { in: filters.stageIds } : {}),
    },
    ...(filters.ownerId && { ownerId: filters.ownerId }),
    ...(filters.statuses?.length && {
      status: { in: filters.statuses },
    }),
    ...((filters.minValue !== undefined || filters.maxValue !== undefined) && {
      value: {
        ...(filters.minValue !== undefined && {
          gte: new Prisma.Decimal(filters.minValue),
        }),
        ...(filters.maxValue !== undefined && {
          lte: new Prisma.Decimal(filters.maxValue),
        }),
      },
    }),
    ...((filters.createdAfter || filters.createdBefore) && {
      createdAt: {
        ...(filters.createdAfter && { gte: new Date(filters.createdAfter) }),
        ...(filters.createdBefore && { lte: new Date(filters.createdBefore) }),
      },
    }),
  };
}
