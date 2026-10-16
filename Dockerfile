FROM node:24-alpine AS build
WORKDIR /app
ENV DATABASE_URL=postgresql://app:app@localhost:5432/opportunities?schema=public

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-worker ./dist-worker
COPY --from=build /app/dist-planner ./dist-planner
COPY --from=build /app/src/generated ./src/generated
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts

EXPOSE 3000
CMD ["node", "dist/main.js"]
