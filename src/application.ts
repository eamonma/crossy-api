import { Connection, IDatabaseDriver, MikroORM } from "@mikro-orm/core"
import { MongoDriver } from "@mikro-orm/mongodb"
import { ApolloServer } from "apollo-server-express"
import chalk from "chalk"
import cors from "cors"
import express from "express"
import { Server } from "http"
import process from "process"
import "reflect-metadata"
import { buildSchema } from "type-graphql"
import ormConfig from "../orm.config"
import { ExpressContext } from "./contexts/ExpressContext"
import { GameResolver } from "./modules/game/Game"
import { authChecker } from "./modules/user/authChecker"
import { AuthorizationResolver } from "./modules/user/Authorization"
import { LoginResolver } from "./modules/user/Login"
import { RegisterResolver } from "./modules/user/Register"
import puppeteer from "puppeteer"
import { SampleResolver } from "./modules/game/sampleSubscription"
import http from "http"

const port = process.env.PORT || 4000

export default class Application {
  orm: MikroORM<IDatabaseDriver<Connection>>
  app: express.Application
  server: Server
  browser: puppeteer.Browser
  pages: Map<string, puppeteer.Page>

  async connect(config: any = ormConfig): Promise<void> {
    try {
      this.orm = await MikroORM.init<MongoDriver>(config)
      this.browser = await puppeteer.launch({
        args: [
          "--disable-gpu",
          "--disable-dev-shm-usage",
          "--disable-setuid-sandbox",
          "--no-sandbox",
        ],
      })
      this.pages = new Map<string, puppeteer.Page>()
    } catch (error) {
      console.error(chalk.red("📌 Could not connect to the database"), error)
      throw Error(error as string)
    }
  }

  async init(): Promise<void> {
    this.app = express()
    const schema = await buildSchema({
      resolvers: [
        LoginResolver,
        RegisterResolver,
        AuthorizationResolver,
        GameResolver,
        SampleResolver,
      ],
      authChecker,
    })

    const apolloServer = new ApolloServer({
      schema,
      subscriptions: {
        path: "/subscriptions",
      },
      context: ({ req, res }: any) =>
        ({
          req,
          res,
          em: this.orm.em.fork(),
          b: this.browser,
          pages: this.pages,
        } as ExpressContext),
    })

    this.app.use((req, res, next) => {
      // res.set("Access-Control-Expose-Headers", "*")
      res.set("Access-Control-Expose-Headers", ["Token", "Refresh-Token"])
      next()
    })

    this.app.disable("x-powered-by")

    this.app.use(cors())

    apolloServer.applyMiddleware({ app: this.app, path: "/api" })

    const httpServer = http.createServer(this.app)

    apolloServer.installSubscriptionHandlers(httpServer)

    this.server = httpServer.listen(port, () => {
      const { PROTOCOL, DOMAIN } = process.env
      console.log(`Server up on ${PROTOCOL}${DOMAIN}:${port}/api`)
      console.log(
        `Subscriptions ready at ws://localhost:${port}${apolloServer.subscriptionsPath}`
      )
    })

    // this.server = this.app.listen(port, () => {
    //   const { PROTOCOL, DOMAIN } = process.env
    //   console.log(`Server up on ${PROTOCOL}${DOMAIN}:${port}/api`)
    // })
  }
}
