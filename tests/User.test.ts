import { Connection, EntityManager, IDatabaseDriver } from "@mikro-orm/core"
import { decode, JwtPayload } from "jsonwebtoken"
import { MongoClient } from "mongodb"
import supertest, { SuperTest, Test } from "supertest"
import Application from "../src/application"

let request: SuperTest<Test>
let application: Application
let em: EntityManager<IDatabaseDriver<Connection>>

const clearDatabase = async (): Promise<void> => {
  const client = await MongoClient.connect(process.env.DB as string, {
    useUnifiedTopology: true,
  })
  const db = client.db("crossy-test")
  await db.dropDatabase()
  await client.close()
}

describe("User resolvers", () => {
  beforeAll(async () => {
    application = new Application()
    await application.connect({
      entities: ["dist/src/entities/"],
      entitiesTs: ["src/entities"],
      dbName: "crossy-test",
      type: "mongo",
      clientUrl: process.env.DB,
      ensureIndexes: true,
    })
    await application.init()

    em = application.orm.em.fork()

    request = supertest(application.app)
    await clearDatabase()
  })

  afterAll(async () => {
    application.server.close()

    // Not documented
    await em.getConnection().close()
  })

  it("should pass", () => {
    expect(true).toBe(true)
  })

  it("should get basic query", async () => {
    const res = await request
      .post("/api")
      .send({
        query: `query {
        datetime
      }`,
      })
      .expect(200)
    expect(typeof res.body.data.datetime).toBe("string")
    expect(new Date(res.body.data.datetime)).toBeInstanceOf(Date)
  })
})
