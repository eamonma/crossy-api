import { MikroORM } from "@mikro-orm/core"

export default {
  entities: ["dist/src/entities/"],
  entitiesTs: ["src/entities"],
  dbName: "corssy-word",
  type: "mongo",
  clientUrl: process.env.DB,
  tsNode: process.env.NODE_ENV !== "production",
  ensureIndexes: true,
} as Parameters<typeof MikroORM.init>[0]
