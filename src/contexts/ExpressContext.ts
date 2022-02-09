import { EntityManager, Connection, IDatabaseDriver } from "@mikro-orm/core"
import { Request, Response } from "express"
import puppeteer from "puppeteer"

export interface ExpressContext {
  req: Request
  res: Response
  em: EntityManager<IDatabaseDriver<Connection>>
  b: puppeteer.Browser
  pages: Map<string, puppeteer.Page>
}
