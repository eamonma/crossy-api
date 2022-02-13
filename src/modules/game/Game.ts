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
  PubSub,
  PubSubEngine,
  Query,
  Resolver,
  Root,
  Subscription,
} from "type-graphql"
import { ExpressContext } from "../../contexts/ExpressContext"
import Game from "../../entities/Game"
import { FileInput } from "./FileInput"
import s3 from "./s3"
import axios from "axios"
import puppeteer, { InterceptResolutionAction, Puppeteer } from "puppeteer"
import User from "../../entities/User"
import {
  AnswerNotification,
  AnswerNotificationPayload,
} from "./notification.type"

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
  @Field(type => [Number])
  mismatched: Array<number>
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

  async getPage(game: Game, ctx: ExpressContext): Promise<puppeteer.Page> {
    const { pages, b } = ctx
    let page = pages.get(game.id)

    const { guildId, channelId } = game

    try {
      if (page && page.isClosed()) page = undefined
      if (!page) {
        page = await this.revitalizePage(game, guildId, channelId, b, pages)
      }
      await page.$("#crossword-grid")
    } catch (error) {
      page = await this.revitalizePage(game, guildId, channelId, b, pages)
    }

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

  async checkGameAnswersMatch(game: Game): Promise<Array<number>> {
    const puzzle: CrosswordData = JSON.parse(game.puzzle)
    const mismatched: Array<number> = []

    puzzle.grid.forEach((grid, i) => {
      if (!game.answers || !game.answers[i]) return

      if (
        grid === "." ||
        grid[0].toUpperCase() === game.answers[i]!.toUpperCase()
      )
        return

      return mismatched.push(i)
    })

    return mismatched
  }

  addAcross(
    answer: string,
    gridNum: number,
    puzzle: CrosswordData,
    answers: Array<string | null>
  ): Array<string | null> {
    const newAnswers = [...answers]
    const index = puzzle.gridnums.findIndex(num => num === gridNum)

    const newUpdatedAnswers: Array<number> = []
    Array.from(answer).forEach((letter, i) => {
      newAnswers[index + i] = letter.toUpperCase()
      newUpdatedAnswers[index + i] = 1
    })

    return newAnswers
  }

  addDown(
    answer: string,
    gridNum: number,
    puzzle: CrosswordData,
    answers: Array<string | null>
  ): Array<string | null> {
    const newAnswers = [...answers]
    const index = puzzle.gridnums.findIndex(num => num === gridNum)

    const newUpdatedAnswers: Array<number> = []
    Array.from(answer).forEach((letter, i) => {
      newAnswers[index + i * puzzle.size.cols] = letter.toUpperCase()
      newUpdatedAnswers[index + i * puzzle.size.cols] = 1
    })

    return newAnswers
  }

  @Query(type => Game)
  async game(
    @Arg("guildId") guildId: string,
    @Arg("channelId") channelId: string,
    @Ctx() ctx: ExpressContext
  ): Promise<Game> {
    const { req, res, em, b, pages } = ctx

    const game: Game = (await em.findOne(Game, {
      guildId,
      channelId,
      active: true,
    })) as Game

    console.log(!game)

    if (!game) throw new Error("No such game.")

    const page = await this.getPage(game, ctx)

    const crosswordGrid = await page.$("#crossword-grid")
    game.image = await this.screenshotGrid(crosswordGrid)

    await em.persist(game).flush()

    return game
  }

  @Query(type => Game)
  async gameById(
    @Arg("gameId") gameId: string,
    @Ctx() ctx: ExpressContext
  ): Promise<Game> {
    const { em } = ctx

    const game: Game = (await em.findOne(Game, {
      id: gameId,
    })) as Game

    if (!game) throw new Error("No such game.")

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
    @Ctx() ctx: ExpressContext
  ): Promise<Game> {
    const { req, res, em, b, pages } = ctx
    const game: Game = (await em.findOne(Game, {
      guildId,
      channelId,
      active: true,
    })) as Game
    const page = await this.getPage(game, ctx)

    const mismatched = await this.checkGameAnswersMatch(game)

    const mismatchedObject: { [gridNum: number]: string } = {}

    for (const mismatch of mismatched.values()) {
      mismatchedObject[mismatch] = "#ffa196"
    }

    // Set highlights colour
    // await page.click("#reset-highlights-colour")
    // await page.click("#highlights-colour")
    // await page.keyboard.press("Backspace")
    // await page.keyboard.press("Backspace")
    // await page.keyboard.press("Backspace")
    // await page.keyboard.press("Backspace")
    // await page.keyboard.press("Backspace")
    // await page.keyboard.press("Backspace")
    // await page.keyboard.press("Backspace")
    // await page.keyboard.press("Backspace")
    // await page.keyboard.press("Backspace")
    // await page.type("#highlights-colour", "#ffa196")

    // // Set highlights
    await page.click("#clear-highlights")

    const highlightsElement = await page.$("#highlights-input")

    await highlightsElement!.click({ clickCount: 3 })

    await highlightsElement?.type(JSON.stringify(mismatchedObject))

    await page.click("#set-highlights")
    // await page.click("#highlights-input")
    // await page.keyboard.press("Backspace")
    // await page.keyboard.press("Backspace")
    // await page.keyboard.type(JSON.stringify(mismatched))
    // await page.click("#set-highlights")

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

    const mismatched = await this.checkGameAnswersMatch(game)

    const allCorrect = mismatched.length === 0

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

  // @Mutation(returns => Boolean)
  // async filledSubscription(
  //   @PubSub() pubSub: PubSubEngine,
  //   @Arg("topic") topic: string,
  //   @Arg("message", { nullable: true }) message?: string
  // ): Promise<boolean> {
  //   const payload: AnswerNotificationPayload = {channelId }
  //   await pubSub.publish(topic, payload)
  //   return true
  // }

  @Subscription({
    topics: ({ args }) => args.topic,
  })
  subscribeToGameUpdate(
    @Arg("topic") topic: string,
    @Root() { gameId, answers }: AnswerNotificationPayload
  ): AnswerNotification {
    return { gameId, answers }
  }

  @Mutation(type => Game)
  async fill(
    @Arg("gridNum") gridNum: number,
    @Arg("direction") direction: "across" | "down",
    @Arg("answer") answer: string,
    @Arg("guildId") guildId: string,
    @Arg("channelId") channelId: string,
    @Arg("playerId") playerId: string,
    @PubSub() pubSub: PubSubEngine,
    @Ctx() ctx: ExpressContext
  ): Promise<Game | null> {
    const { req, res, em, b, pages } = ctx
    const game: Game = (await em.findOne(
      Game,
      {
        guildId,
        channelId,
        active: true,
      },
      { populate: ["players"] }
    )) as Game

    if (!game) throw new Error("No such game")

    // Get the web page
    const page = await this.getPage(game, ctx)

    // Type the entry
    // const newAnswers =
    const puzzle = JSON.parse(game.puzzle)
    if (direction === "across") {
      game.answers = this.addAcross(answer, gridNum, puzzle, game.answers)
    } else if (direction === "down") {
      game.answers = this.addDown(answer, gridNum, puzzle, game.answers)
    }

    // PubSub push notification
    const payload: AnswerNotificationPayload = {
      answers: game.answers as Array<string>,
      gameId: game.id,
    }

    await pubSub.publish(game.id, payload)

    const numberInput = await page.$("#number")
    if (!numberInput) throw new Error("No such input")

    await numberInput.click()
    await page.keyboard.press("Backspace")
    await page.type("#number", JSON.stringify(gridNum))
    await page.select("#direction", direction)
    await page.type("#answer", answer)
    await page.click("#add-answer")

    await page.click("#set-answers")

    // const pageAnswers = await (
    //   await allAnswers?.getProperty("value")
    // )?.jsonValue()

    // if (!pageAnswers) throw new Error("No such textarea")

    // const answers = await JSON.parse(pageAnswers as string)

    // // TODO: Change this from react-given to server-given
    // game.answers = answers

    const crosswordGrid = await page.$("#crossword-grid")

    game.image = await this.screenshotGrid(crosswordGrid)

    if (!game.history) game.history = []

    game.history.push({
      playerId,
      answer: answer.toUpperCase(),
      direction,
      gridNum,
    })

    // if(!game.players) game.players = []

    // wrap(game).assign({players: })
    // Player information
    let player: User = (await em.findOne(User, { discordId: playerId })) as User

    if (!player) player = new User({ discordId: playerId })

    if (!game.players.contains(player)) game.players.add(player)

    await em.persist(game).flush()

    return game
  }
}
