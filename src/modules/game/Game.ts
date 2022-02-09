import { Type, wrap } from "@mikro-orm/core"
import { GraphQLResolveInfo } from "graphql"
import { setTimeout } from "timers/promises"
import fs from "fs/promises"
import {
  Arg,
  Args,
  Authorized,
  Ctx,
  Field,
  Info,
  InputType,
  Int,
  Mutation,
  ObjectType,
  Query,
  Resolver,
} from "type-graphql"
import { ExpressContext } from "../../contexts/ExpressContext"
import Game from "../../entities/Game"
import { FileInput } from "./FileInput"
import s3 from "./s3"
import axios from "axios"
import puppeteer, { Puppeteer } from "puppeteer"

type Answers = {
  across: Array<string>
  down: Array<string>
}

type Clues = {
  across: Array<string>
  down: Array<string>
}

type Size = {
  cols: number
  rows: number
}

export interface CrosswordData {
  answers: Answers
  author: string
  clues: Clues
  grid: Array<string>
  gridnums: Array<number>
  date: string
  size: Size
}

@ObjectType()
class Correctness {
  @Field(type => Boolean)
  allCorrect: boolean
  @Field(type => [Boolean])
  mismatched: Array<boolean>
}

@Resolver()
@ObjectType()
export class GameResolver {
  @Query()
  datetime(): string {
    return new Date().toISOString()
  }

  async revitalizePage(
    game: Game,
    guildId: string,
    channelId: string,
    browser: puppeteer.Browser,
    pages: Map<string, puppeteer.Page>
  ): Promise<puppeteer.Page> {
    const page = await browser.newPage()
    await page.goto("http://localhost:3000")
    await page.setViewport({
      width: 1920,
      height: 1080,
      deviceScaleFactor: 2,
    })

    // Set puzzle board
    const jsonFilePath = `temp/${guildId}-${channelId}.json`
    await fs.writeFile(jsonFilePath, game.puzzle)
    const jsonFile = await page.$("input[type=file]")
    await jsonFile?.uploadFile(jsonFilePath)

    // Set all answers from game
    await page.waitForSelector("#all-answer-input")
    const allAnswer = await page.$("#all-answer-input")
    await allAnswer?.click()
    await page.keyboard.press("Backspace")
    await page.keyboard.press("Backspace")
    await page.keyboard.press("Backspace")
    await page.keyboard.press("Backspace")
    await page.type("#all-answer-input", JSON.stringify(game.answers))
    await page.click("#set-answers")

    pages.set(game.id, page)

    await fs.rm(jsonFilePath)

    return page
  }

  async screenshotGrid(
    crosswordGrid: puppeteer.ElementHandle<Element> | null
  ): Promise<string> {
    if (!crosswordGrid) {
      throw new Error("Something went wrong.")
    }

    const imageBuffer: Buffer = (await crosswordGrid.screenshot({
      type: "png",
    })) as Buffer

    return Buffer.from(imageBuffer).toString("base64")
  }

  async checkGameIsAllFilled(game: Game): Promise<boolean> {
    const puzzle: CrosswordData = JSON.parse(game.puzzle)

    return puzzle.grid.every((grid, i) => {
      return grid === "."
        ? true
        : game.answers[i] !== null && game.answers[i] !== undefined
    })
  }

  async checkGameAnswersMatch(game: Game): Promise<[boolean, Array<boolean>]> {
    const puzzle: CrosswordData = JSON.parse(game.puzzle)
    const mismatched: Array<boolean> = []

    puzzle.grid.forEach((grid, i) => {
      if (grid === "." || grid[0] === game.answers[i] || !game.answers[i])
        return (mismatched[i] = false)

      return (mismatched[i] = true)
    })

    return [mismatched.every(grid => !grid), mismatched]
  }

  @Query(type => Game)
  async game(
    @Arg("guildId") guildId: string,
    @Arg("channelId") channelId: string,
    @Ctx() { req, res, em, b, pages }: ExpressContext
  ): Promise<Game> {
    const game: Game = (await em.findOne(Game, {
      guildId,
      channelId,
      active: true,
    })) as Game

    let page = pages.get(game.id)
    if (!game) throw new Error("No such game")

    if (page && page.isClosed()) page = undefined
    if (!page) {
      page = await this.revitalizePage(game, guildId, channelId, b, pages)
    }

    const crosswordGrid = await page.$("#crossword-grid")
    game.image = await this.screenshotGrid(crosswordGrid)

    await em.persist(game).flush()

    return game
  }

  @Query(type => Boolean)
  async allFilled(
    @Arg("guildId") guildId: string,
    @Arg("channelId") channelId: string,
    @Ctx() { em }: ExpressContext
  ): Promise<boolean> {
    const game = (await em.findOne(Game, {
      guildId,
      channelId,
      active: true,
    })) as Game

    return this.checkGameIsAllFilled(game)
  }

  @Mutation(type => Game)
  async whichIncorrect(
    @Arg("guildId") guildId: string,
    @Arg("channelId") channelId: string,
    @Ctx() { req, res, em, b, pages }: ExpressContext
  ): Promise<Game> {
    const game: Game = (await em.findOne(Game, {
      guildId,
      channelId,
      active: true,
    })) as Game
    let page = pages.get(game.id)

    if (!game) throw new Error("No such game")

    if (page && page.isClosed()) page = undefined
    if (!page) {
      page = await this.revitalizePage(game, guildId, channelId, b, pages)
    }

    const [_, mismatched] = await this.checkGameAnswersMatch(game)

    // Set highlights colour
    await page.click("#reset-highlights-colour")
    await page.click("#highlights-colour")
    await page.keyboard.press("Backspace")
    await page.keyboard.press("Backspace")
    await page.keyboard.press("Backspace")
    await page.keyboard.press("Backspace")
    await page.keyboard.press("Backspace")
    await page.keyboard.press("Backspace")
    await page.keyboard.press("Backspace")
    await page.keyboard.press("Backspace")
    await page.keyboard.press("Backspace")
    await page.type("#highlights-colour", "#ffa196")

    // Set highlights
    await page.click("#clear-highlights")
    await page.click("#highlights-input")
    await page.keyboard.press("Backspace")
    await page.keyboard.press("Backspace")
    await page.keyboard.type(JSON.stringify(mismatched))
    await page.click("#set-highlights")

    const crosswordGrid = await page.$("#crossword-grid")
    game.image = await this.screenshotGrid(crosswordGrid)

    await page.click("#clear-highlights")

    await em.persist(game).flush()

    return game
  }

  @Mutation(type => Correctness)
  async checkCorrect(
    @Arg("guildId") guildId: string,
    @Arg("channelId") channelId: string,
    @Ctx() ctx: ExpressContext
  ): Promise<Correctness> {
    const { req, res, em, b, pages } = ctx
    const game = (await em.findOne(Game, {
      guildId,
      channelId,
      active: true,
    })) as Game

    const [allCorrect, mismatched] = await this.checkGameAnswersMatch(game)

    if (allCorrect) {
      game.active = false
      game.image = ""
    }

    em.persist(game).flush()

    return { allCorrect, mismatched }
  }

  @Mutation(type => Game)
  async endGame(
    @Arg("guildId") guildId: string,
    @Arg("channelId") channelId: string,
    @Ctx() { req, res, em, b, pages }: ExpressContext
  ): Promise<Game> {
    const game: Game = (await em.findOne(Game, {
      guildId,
      channelId,
      active: true,
    })) as Game

    game.active = false
    game.image = ""

    await em.persist(game).flush()

    return game
  }

  @Mutation(type => Game)
  async startGame(
    @Arg("guildId") guildId: string,
    @Arg("channelId") channelId: string,
    @Arg("puzzleUrl") puzzleUrl: string,
    @Ctx() { req, res, em, b, pages }: ExpressContext
  ): Promise<Game> {
    const existingGame: Game = (await em.findOne(Game, {
      guildId,
      channelId,
      active: true,
    })) as Game

    if (existingGame) throw new Error("Game in this channel already exists.")

    const page = await b.newPage()
    await page.goto("http://localhost:3000")
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 })

    await page.waitForSelector("#crossword-grid")

    const puzzle = (await axios.get(puzzleUrl)).data as CrosswordData

    const puzzleJSON = JSON.stringify(puzzle)

    const jsonFilePath = `temp/${guildId}-${channelId}.json`
    await fs.writeFile(jsonFilePath, puzzleJSON)

    const jsonFile = await page.$("input[type=file]")
    await jsonFile?.uploadFile(jsonFilePath)

    const crosswordGrid = await page.$("#crossword-grid")

    if (!crosswordGrid) {
      throw new Error("Something went wrong.")
    }
    const imageBase64 = await this.screenshotGrid(crosswordGrid)

    const game = new Game({
      puzzle: puzzleJSON,
      image: imageBase64,
      guildId,
      channelId,
    })

    await em.persist(game).flush()
    pages.set(game.id, page)

    return game
  }

  @Mutation(type => Game)
  async fill(
    @Arg("gridNum") gridNum: number,
    @Arg("direction") direction: "across" | "down",
    @Arg("answer") answer: string,
    @Arg("guildId") guildId: string,
    @Arg("channelId") channelId: string,
    @Ctx() { req, res, em, b, pages }: ExpressContext
  ): Promise<Game | null> {
    const game: Game = (await em.findOne(Game, {
      guildId,
      channelId,
      active: true,
    })) as Game

    let page = pages.get(game.id)
    if (!game) throw new Error("No such game")

    if (page && page.isClosed()) page = undefined
    if (!page) {
      page = await this.revitalizePage(game, guildId, channelId, b, pages)
    }

    const numberInput = await page.$("#number")

    if (!numberInput) throw new Error("No such input")

    await numberInput.click()
    await page.keyboard.press("Backspace")
    await page.type("#number", JSON.stringify(gridNum))
    await page.select("#direction", direction)
    await page.type("#answer", answer)
    await page.click("#add-answer")

    const allAnswers = await page.$("#all-answer-input")

    const pageAnswers = await (
      await allAnswers?.getProperty("value")
    )?.jsonValue()

    if (!pageAnswers) throw new Error("No such textarea")

    const answers = await JSON.parse(pageAnswers as string)

    game.answers = answers

    const crosswordGrid = await page.$("#crossword-grid")

    game.image = await this.screenshotGrid(crosswordGrid)

    await em.persist(game).flush()

    return game
  }
}
