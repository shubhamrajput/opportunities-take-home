export const benchmarkData = {
  workload: {
    workspaceId: '11000000-0000-4000-8000-000000000001',
    pipelineId: '21000000-0000-4000-8000-000000000001',
    stageIds: Array.from(
      { length: 12 },
      (_, index) => `31000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, '0')}`,
    ),
  },
  smallWorkspaces: Array.from({ length: 5 }, (_, index) => ({
    workspaceId: `11000000-0000-4000-8000-${(index + 2).toString(16).padStart(12, '0')}`,
    pipelineId: `21000000-0000-4000-8000-${(index + 2).toString(16).padStart(12, '0')}`,
    stageId: `31000000-0000-4000-8000-${(index + 13).toString(16).padStart(12, '0')}`,
  })),
  sourceStageIndex: 0,
  targetStageIndex: 1,
  probeStageIndex: 11,
  defaultOpportunityCount: 500_000,
  defaultMoveCount: 50_000,
  defaultSmallWorkspaceOpportunityCount: 1_000,
};
