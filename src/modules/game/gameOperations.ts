import { ExpressContext } from "../../contexts/ExpressContext"
import Game from "../../entities/Game"
import { CrosswordData } from "./Game"
import puppeteer from "puppeteer"
import fs from "fs/promises"

export async function revitalizePage(
  game: Game,
  guildId: string,
  channelId: string,
  browser: puppeteer.Browser,
  pages: Map<string, puppeteer.Page>
): Promise<puppeteer.Page> {
  const page = await browser.newPage()
  await page.goto(process.env.GRID_URL as string)
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

export async function getPage(
  game: Game,
  ctx: ExpressContext
): Promise<puppeteer.Page> {
  const { pages, b } = ctx
  let page = pages.get(game.id)

  const { guildId, channelId } = game

  try {
    if (page && page.isClosed()) page = undefined
    if (!page) {
      page = await revitalizePage(game, guildId, channelId, b, pages)
    }
    await page.$("#crossword-grid")
  } catch (error) {
    page = await revitalizePage(game, guildId, channelId, b, pages)
  }

  return page
}

export async function screenshotGrid(
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

export async function checkGameIsAllFilled(game: Game): Promise<boolean> {
  const puzzle: CrosswordData = JSON.parse(game.puzzle)

  return puzzle.grid.every((grid, i) => {
    return grid === "."
      ? true
      : game.answers[i] !== null && game.answers[i] !== undefined
  })
}

export async function checkGameAnswersMatch(
  game: Game
): Promise<Array<number>> {
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

export function addAcross(
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

export function addDown(
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
