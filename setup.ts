import prompts, { PromptObject } from "prompts"
import { randomBytes } from "crypto"
import { existsSync } from "fs"
import { writeFile } from "fs/promises"
import chalk from "chalk"
import { APIConsumerResolver } from "./src/modules/api/APIConsumer"
import "dotenv/config"
import ormConfig from "./orm.config"
import { Configuration, MikroORM } from "@mikro-orm/core"
import { MongoDriver } from "@mikro-orm/mongodb"

const camelToUpperSnakeCase = (str: string): string => {
  return str.replace(/[A-Z]/g, letter => `_${letter}`).toUpperCase()
}

const envQuestions: PromptObject[] = [
  {
    type: "select",
    name: "nodeEnv",
    message: "Production or development environment?",
    choices: [
      {
        title: "development",
        value: "development",
      },
      {
        title: "production",
        value: "production",
      },
    ],
  },
  {
    type: "text",
    name: "protocol",
    message: "Protocol?",
    initial: "http://",
  },
  {
    type: "text",
    name: "domain",
    message: "Hostname?",
    initial: "localhost",
  },
  {
    type: "text",
    name: "gridUrl",
    message: "Grid url?",
    initial: "https://grid.crossy.me",
  },
  {
    type: "text",
    name: "apiKeygenSecret",
    message: "AES Secret?",
    initial: randomBytes(32).toString("hex"),
  },
  {
    type: "text",
    name: "apiKeygenIv",
    message: "AES Init vector?",
    initial: randomBytes(16).toString("hex"),
  },
  {
    type: "text",
    name: "mongoInitdbRootUsername",
    message: "Docker Mongodb root username?",
    initial: "admin",
  },
  {
    type: "text",
    name: "mongoInitdbRootPassword",
    message: "Docker Mongodb root password?",
    initial: randomBytes(32).toString("base64url"),
  },
  {
    type: "text",
    name: "db",
    message: "Database connection string?",
    initial: "mongodb://localhost:27017/?readPreference=primary&ssl=false",
  },
]

;(async () => {
  const envExists = existsSync(".env")
  const configExists = existsSync("app.config.json")
  const configDefaults = { allowApiRegistration: false }

  if (!envExists) {
    const envResponse = await prompts(envQuestions)
    let envFileString: string = ""
    for (const property in envResponse) {
      envFileString += `${camelToUpperSnakeCase(property)}="${
        envResponse[property]
      }"`
      envFileString += "\n"
    }

    await writeFile(".env", envFileString)
    console.log("Created " + chalk.bold.green(".env"))
  } else {
    console.log(chalk.bold.blue(".env already exists."))
  }

  if (!configExists) {
    // const configResponse = await prompts(configQuestions)
    await writeFile("app.config.json", JSON.stringify(configDefaults, null, 2))
    console.log("Created " + chalk.bold.green("app.config.json"))
  } else {
    console.log(chalk.bold.blue("app.config.json already exists."))
  }

  const createApiConsumers = await prompts([
    {
      type: "text",
      name: "email",
      message: "Email for API consumers?",
    },
    {
      type: "text",
      name: "nameBot",
      message: "Name for API bot consumer?",
      initial: "crossy-bot",
    },
    {
      type: "text",
      name: "nameWeb",
      message: "Name for API web consumer?",
      initial: "crossy-main",
    },
  ])

  const { email, nameBot, nameWeb } = createApiConsumers

  if (!email || !nameBot || !nameWeb) return

  // const orm = await MikroORM.init<MongoDriver>(
  //   ormConfig as Configuration<MongoDriver>
  // )

  const botKey = await APIConsumerResolver.createAPIConsumerAndLeaveHanging({
    email,
    name: nameBot,
  })
  const webKey = await APIConsumerResolver.createAPIConsumerAndLeaveHanging({
    email,
    name: nameWeb,
  })

  console.log("\n")
  console.log("".padStart(botKey.length, "="))

  console.log("Add the following entities to apiconsumers:")

  console.log(botKey)
  console.log(webKey)

  // console.log(chalk.bold.red("These API keys will only be shown here once.\n"))

  // console.log("Bot API key: \n" + chalk.bold.green(botKey))
  // console.log("\nWeb API key: \n" + chalk.bold.green(webKey))

  console.log("".padStart(botKey.length, "="))

  console.log("\n")

  // await orm.close()
})()
