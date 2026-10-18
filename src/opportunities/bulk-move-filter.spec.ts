import { describe, expect, it } from 'vitest';
import { OpportunityStatus, Prisma } from '../generated/prisma/client.js';
import {
  buildOpportunityWhere,
  parseBulkMoveFilters,
} from './bulk-move-filter.js';

describe('bulk move filters', () => {
  it('scopes the query and builds all supported filter predicates', () => {
    const where = buildOpportunityWhere(
      {
        workspaceId: 'workspace-id',
        pipelineId: 'pipeline-id',
        targetStageId: 'target-stage-id',
      },
      {
        stageIds: ['source-stage-id'],
        ownerId: 'owner-id',
        statuses: [OpportunityStatus.open],
        minValue: '100.50',
        maxValue: '500.00',
        createdAfter: '2026-01-01T00:00:00.000Z',
        createdBefore: '2026-02-01T00:00:00.000Z',
      },
    );

    expect(where).toMatchObject({
      workspaceId: 'workspace-id',
      pipelineId: 'pipeline-id',
      stageId: { not: 'target-stage-id', in: ['source-stage-id'] },
      ownerId: 'owner-id',
      status: { in: [OpportunityStatus.open] },
    });
    const valueRange = where.value as {
      gte?: { toString(): string };
      lte?: { toString(): string };
    };
    const createdAtRange = where.createdAt as { gte?: Date; lte?: Date };
    expect(valueRange.gte?.toString()).toBe('100.5');
    expect(valueRange.lte?.toString()).toBe('500');
    expect(createdAtRange.gte).toEqual(new Date('2026-01-01T00:00:00.000Z'));
    expect(createdAtRange.lte).toEqual(new Date('2026-02-01T00:00:00.000Z'));
  });

  it('parses filters stored as JSON', () => {
    const filters = parseBulkMoveFilters({
      stageIds: ['source-stage-id'],
      statuses: ['open'],
      minValue: '42.00',
    } as Prisma.JsonObject);

    expect(filters).toEqual({
      stageIds: ['source-stage-id'],
      ownerId: undefined,
      statuses: ['open'],
      minValue: '42.00',
      maxValue: undefined,
      createdAfter: undefined,
      createdBefore: undefined,
    });
  });

  it('rejects malformed stored filters', () => {
    expect(() => parseBulkMoveFilters({ stageIds: 'not-an-array' })).toThrow(
      'Bulk-move filter stageIds must be an array of strings',
    );
  });
});
