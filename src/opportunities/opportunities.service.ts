import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  CreateOpportunityDto,
  MoveOpportunityStageDto,
  OpportunityPaginationQuery,
} from './dto.js';

const MAX_PAGE_SIZE = 100;
@Injectable()
export class OpportunitiesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(workspaceId: string, input: CreateOpportunityDto) {
    const { pipelineId, stageId, name } = input;
    const ownerId = input.ownerId ?? null;
    const value = new Prisma.Decimal(input.value ?? '0');

    const stage = await this.prisma.stage.findFirst({
      where: { id: stageId, workspaceId, pipelineId },
      select: { id: true },
    });
    if (!stage) {
      throw new NotFoundException('Stage not found in this workspace pipeline');
    }

    return this.prisma.opportunity.create({
      data: {
        workspaceId,
        pipelineId,
        stageId,
        name,
        value,
        ownerId,
      },
    });
  }

  async list(workspaceId: string, query: OpportunityPaginationQuery) {
    const { stageId } = query;
    const page = query.page ?? 1;
    const pageSize = Math.min(query.limit ?? 20, MAX_PAGE_SIZE);

    const stage = await this.prisma.stage.findFirst({
      where: { id: stageId, workspaceId },
      select: { id: true },
    });
    if (!stage) {
      throw new NotFoundException('Stage not found in this workspace');
    }

    const where = { workspaceId, stageId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.opportunity.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.opportunity.count({ where }),
    ]);

    return {
      items,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async moveStage(
    workspaceId: string,
    opportunityId: string,
    input: MoveOpportunityStageDto,
  ) {
    const targetStageId = input.stageId;
    const changedBy = input.changedBy ?? null;

    const opportunity = await this.prisma.opportunity.findFirst({
      where: { id: opportunityId, workspaceId },
      select: { id: true, pipelineId: true, stageId: true, version: true },
    });
    if (!opportunity) {
      throw new NotFoundException('Opportunity not found in this workspace');
    }

    const targetStage = await this.prisma.stage.findFirst({
      where: {
        id: targetStageId,
        workspaceId,
        pipelineId: opportunity.pipelineId,
      },
      select: { id: true },
    });
    if (!targetStage) {
      throw new NotFoundException('Target stage not found in this pipeline');
    }

    if (opportunity.stageId === targetStageId) {
      return { opportunity, transition: null, unchanged: true };
    }

    return this.prisma.$transaction(async (tx) => {
      const update = await tx.opportunity.updateMany({
        where: {
          id: opportunity.id,
          workspaceId,
          stageId: opportunity.stageId,
          version: opportunity.version,
        },
        data: {
          stageId: targetStageId,
          version: { increment: 1 },
        },
      });

      if (update.count !== 1) {
        throw new ConflictException(
          'Opportunity changed while the stage move was being applied; reload and retry',
        );
      }

      const transition = await tx.opportunityTransition.create({
        data: {
          workspaceId,
          pipelineId: opportunity.pipelineId,
          opportunityId: opportunity.id,
          fromStageId: opportunity.stageId,
          toStageId: targetStageId,
          changedBy,
        },
      });
      const updatedOpportunity = await tx.opportunity.findFirstOrThrow({
        where: { id: opportunity.id, workspaceId },
      });

      return {
        opportunity: updatedOpportunity,
        transition,
        unchanged: false,
      };
    });
  }

}
