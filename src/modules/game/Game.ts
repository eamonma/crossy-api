import axios from "axios"
import fs from "fs/promises"
import {
  Arg,
  Authorized,
  Ctx,
  Field,
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
import User from "../../entities/User"
import {
  addAcross,
  addDown,
  checkGameAnswersMatch,
  checkGameIsAllFilled,
  getPage,
  screenshotGrid,
} from "./gameOperations"
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

  @Query()
  @Authorized()
  secret(): string {
    return "big secret"
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

    const page = await getPage(game, ctx)

    const crosswordGrid = await page.$("#crossword-grid")
    game.image = await screenshotGrid(crosswordGrid)

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

    return checkGameIsAllFilled(game)
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
    const page = await getPage(game, ctx)

    const mismatched = await checkGameAnswersMatch(game)

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
    game.image = await screenshotGrid(crosswordGrid)

    await page.click("#clear-highlights")

    await em.persist(game).flush()

    return game
  }

  @Mutation(type => Correctness)
  async checkCorrect(
    @Arg("guildId") guildId: string,
    @Arg("channelId") channelId: string,
    @PubSub() pubSub: PubSubEngine,

    @Ctx() ctx: ExpressContext
  ): Promise<Correctness> {
    const { req, res, em, b, pages } = ctx
    const game = (await em.findOne(Game, {
      guildId,
      channelId,
      active: true,
    })) as Game

    const mismatched = await checkGameAnswersMatch(game)

    const allCorrect = mismatched.length === 0

    if (allCorrect) {
      this.endGame(guildId, channelId, pubSub, ctx)
    }

    em.persist(game).flush()

    return { allCorrect, mismatched }
  }

  @Mutation(type => Game)
  async endGame(
    @Arg("guildId") guildId: string,
    @Arg("channelId") channelId: string,
    @PubSub() pubSub: PubSubEngine,

    @Ctx() { req, res, em, b, pages }: ExpressContext
  ): Promise<Game> {
    const game: Game = (await em.findOne(Game, {
      guildId,
      channelId,
      active: true,
    })) as Game

    game.active = false
    game.image = ""

    // PubSub push notification
    const payload: AnswerNotificationPayload = {
      answers: game.answers as Array<string>,
      gameId: game.id,
      updatedAt: game.updatedAt,
      active: game.active,
    }

    await pubSub.publish(game.id, payload)

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
    await page.goto(process.env.GRID_URL as string)
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
    const imageBase64 = await screenshotGrid(crosswordGrid)

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

  @Subscription({
    topics: ({ args }) => args.topic,
  })
  subscribeToGameUpdate(
    @Arg("topic") topic: string,
    @Root() { gameId, answers, updatedAt, active }: AnswerNotificationPayload
  ): AnswerNotification {
    return { gameId, answers, updatedAt, active }
  }

  @Mutation(type => Game)
  @Authorized()
  async fillById(
    @Arg("nthAnswer", { nullable: true }) nthAnswer: number,
    @Arg("gridNum", { nullable: true }) gridNum: number,
    @Arg("direction") direction: "across" | "down",
    @Arg("answer") answer: string,
    @Arg("gameId") gameId: string,
    @Arg("playerId") playerId: string,
    @Arg("generateNewImage", { defaultValue: false }) generateNewImage: boolean,
    @PubSub() pubSub: PubSubEngine,
    @Ctx() ctx: ExpressContext
  ): Promise<Game | null> {
    const game: Game = (await ctx.em.findOne(
      Game,
      {
        id: gameId,
        active: true,
      },
      { populate: ["players"] }
    )) as Game

    let player: User = (await ctx.em.findOne(User, {
      discordId: playerId,
    })) as User

    if (!player) player = new User({ discordId: playerId })

    if (!game.players || !game.players.contains(player))
      game.players.add(player)

    return this.fill(
      direction,
      answer,
      game,
      player,
      pubSub,
      ctx,
      generateNewImage,
      !!gridNum,
      gridNum,
      nthAnswer
    )
  }

  @Mutation(type => Game)
  @Authorized()
  async fillByChannelAndGuildIds(
    @Arg("nthAnswer", { nullable: true }) nthAnswer: number,
    @Arg("gridNum", { nullable: true }) gridNum: number,
    @Arg("direction") direction: "across" | "down",
    @Arg("answer") answer: string,
    @Arg("guildId") guildId: string,
    @Arg("channelId") channelId: string,
    @Arg("playerId") playerId: string,
    @Arg("generateNewImage", { defaultValue: true }) generateNewImage: boolean,
    @PubSub() pubSub: PubSubEngine,
    @Ctx() ctx: ExpressContext
  ): Promise<Game | null> {
    const game: Game = (await ctx.em.findOne(
      Game,
      {
        guildId,
        channelId,
        active: true,
      },
      { populate: ["players"] }
    )) as Game

    let player: User = (await ctx.em.findOne(User, {
      discordId: playerId,
    })) as User

    if (!player) player = new User({ discordId: playerId })

    if (!game.players.contains(player)) game.players.add(player)

    return this.fill(
      direction,
      answer,
      game,
      player,
      pubSub,
      ctx,
      generateNewImage,
      !!gridNum,
      gridNum,
      nthAnswer
    )
  }

  // @Mutation(type => Game)
  // @Authorized()
  async fill(
    direction: "across" | "down",
    answer: string,
    game: Game,
    player: User,
    pubSub: PubSubEngine,
    ctx: ExpressContext,
    generateNewImage: boolean = true,
    fillByGridNum: boolean = true,
    gridNum?: number,
    nthAnswer?: number
  ): Promise<Game | null> {
    const { req, res, em, b, pages } = ctx

    console.log(
      `Filling ${answer} in ${direction} direction in game ${game.id}`
    )

    if (!game) throw new Error("No such game")

    // Get the web page
    const page = await getPage(game, ctx)

    // Type the entry
    // const newAnswers =
    const puzzle = JSON.parse(game.puzzle)
    if (direction === "across") {
      game.answers = addAcross(answer, puzzle, game.answers, gridNum, nthAnswer)
    } else if (direction === "down") {
      game.answers = addDown(answer, puzzle, game.answers, gridNum, nthAnswer)
    }

    // PubSub push notification
    const payload: AnswerNotificationPayload = {
      answers: game.answers as Array<string>,
      gameId: game.id,
      updatedAt: game.updatedAt,
      active: game.active,
    }

    await pubSub.publish(game.id, payload)

    if (fillByGridNum) {
      const numberInput = await page.$("#number")
      if (!numberInput) throw new Error("No such input")

      await numberInput.click({ clickCount: 3 })
      await page.keyboard.press("Backspace")
      await page.type("#number", JSON.stringify(gridNum))
      await page.select("#direction", direction)
      await page.type("#answer", answer)
      await page.click("#add-answer")
    } else {
      // Fill by nthAnswer
      const nthAnswerInput = await page.$("#nthAnswer")
      if (!nthAnswerInput) throw new Error("No such input")

      await nthAnswerInput.click({ clickCount: 3 })
      await page.keyboard.press("Backspace")
      await page.type("#nthAnswer", JSON.stringify(nthAnswer))
      await page.type("#letter", answer)
      await page.click("#set-letter")
    }

    // await page.click("#set-answers")

    if (!game.history) game.history = []

    game.history.push({
      playerId: player.id,
      answer: answer.toUpperCase(),
      direction,
      nthAnswer: gridNum
        ? puzzle.gridnums.findIndex((num: number) => num === gridNum)
        : (nthAnswer as number),
    })

    // If no new image is needed
    if (!generateNewImage) {
      await em.persist(game).flush()

      console.log(
        `Filled ${answer} in ${direction} direction in game ${game.id}`
      )

      return game
    }

    // const pageAnswers = await (
    //   await allAnswers?.getProperty("value")
    // )?.jsonValue()

    // if (!pageAnswers) throw new Error("No such textarea")

    // const answers = await JSON.parse(pageAnswers as string)

    // // TODO: Change this from react-given to server-given
    // game.answers = answers

    const crosswordGrid = await page.$("#crossword-grid")

    game.image = await screenshotGrid(crosswordGrid)

    await em.persist(game).flush()

    return game
  }
}
