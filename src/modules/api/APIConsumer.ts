// import argon2 from "argon2"
import { EntityManager, Connection, IDatabaseDriver } from "@mikro-orm/core"
import crypto from "crypto"
import {
  Args,
  ArgsType,
  Ctx,
  Field,
  Mutation,
  Resolver,
  UseMiddleware,
} from "type-graphql"
import config from "../../../app.config.json"
import { ExpressContext } from "../../contexts/ExpressContext"
import APIConsumer from "../../entities/APIConsumer"
import { Disabled } from "../Disabled"

@ArgsType()
class RegisterAPIConsumerInput {
  @Field(type => String)
  name: string

  @Field(type => String)
  email: string
}

@Resolver()
export class APIConsumerResolver {
  @Mutation(type => String)
  // Disable from calling as GraphQl Mutation if configured
  // @UseMiddleware(Disabled(!config.allowApiRegistration))
  async registerAPIConsumer(
    @Args() registerAPIConsumerInput: RegisterAPIConsumerInput,
    @Ctx() ctx: ExpressContext
  ): Promise<string> {
    if (
      (await ctx.em.count(APIConsumer)) >= 2 &&
      !config.allowApiRegistrationAfterTwoConsumers
    ) {
      throw new Error("Only two API consumers are allowed")
    }

    return await APIConsumerResolver.createAPIConsumer(
      registerAPIConsumerInput,
      ctx.em
    )
  }

  static async createAPIConsumerAndLeaveHanging({
    name,
    email,
  }: RegisterAPIConsumerInput): Promise<any> {
    const key = crypto.randomBytes(64).toString("base64url")

    // Encrypted API key, in case plaintext is needed
    const cipher = crypto.createCipheriv(
      "aes-256-gcm",
      Buffer.from(process.env.API_KEYGEN_SECRET as string, "hex"),
      Buffer.from(process.env.API_KEYGEN_IV as string, "hex")
    )

    let encryptedKey = cipher.update(key, "utf-8", "base64")

    encryptedKey += cipher.final("base64")

    const apiConsumer = new APIConsumer({ key: encryptedKey, name, email })

    return { key, apiConsumer }
  }

  static async createAPIConsumer(
    { name, email }: RegisterAPIConsumerInput,
    em: EntityManager<IDatabaseDriver<Connection>>
  ): Promise<string> {
    const key = crypto.randomBytes(64).toString("base64url")

    // Encrypted API key, in case plaintext is needed
    const cipher = crypto.createCipheriv(
      "aes-256-gcm",
      Buffer.from(process.env.API_KEYGEN_SECRET as string, "hex"),
      Buffer.from(process.env.API_KEYGEN_IV as string, "hex")
    )

    let encryptedKey = cipher.update(key, "utf-8", "base64")

    encryptedKey += cipher.final("base64")

    const apiConsumer = new APIConsumer({ key: encryptedKey, name, email })

    await em.persist(apiConsumer).flush()

    return key
  }
}
