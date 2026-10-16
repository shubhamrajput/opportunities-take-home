import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required to seed the database');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const workspaceId = '10000000-0000-4000-8000-000000000001';
const pipelineId = '20000000-0000-4000-8000-000000000001';
const stages = [
  { id: '30000000-0000-4000-8000-000000000001', name: 'New Lead', position: 1 },
  { id: '30000000-0000-4000-8000-000000000002', name: 'Qualified', position: 2 },
  { id: '30000000-0000-4000-8000-000000000003', name: 'Proposal', position: 3 },
];

try {
  await prisma.workspace.upsert({
    where: { id: workspaceId },
    update: { name: 'Demo Workspace' },
    create: { id: workspaceId, name: 'Demo Workspace' },
  });

  await prisma.pipeline.upsert({
    where: { id: pipelineId },
    update: { workspaceId, name: 'Sales Pipeline' },
    create: { id: pipelineId, workspaceId, name: 'Sales Pipeline' },
  });

  for (const stage of stages) {
    await prisma.stage.upsert({
      where: { id: stage.id },
      update: {
        workspaceId,
        pipelineId,
        name: stage.name,
        position: stage.position,
      },
      create: { ...stage, workspaceId, pipelineId },
    });
  }

  console.log('Seeded demo workspace, pipeline, and stages.');
  console.log(`Workspace ID: ${workspaceId}`);
  console.log(`Pipeline ID: ${pipelineId}`);
  console.log(`Stage IDs: ${stages.map(({ id }) => id).join(', ')}`);
} finally {
  await prisma.$disconnect();
}
