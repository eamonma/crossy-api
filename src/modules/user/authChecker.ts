import { verify } from "jsonwebtoken"
import crypto from "crypto"
import { AuthChecker } from "type-graphql"
import { ExpressContext } from "../../contexts/ExpressContext"
import APIConsumer from "../../entities/APIConsumer"
import User from "../../entities/User"
import { createTokens } from "./createTokens"

export const authChecker: AuthChecker<ExpressContext> = async (
  { context: { req, res, em }, args: { clientRequesting } },
  roles
): Promise<boolean> => {
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    Buffer.from(process.env.API_KEYGEN_SECRET as string, "hex"),
    Buffer.from(process.env.API_KEYGEN_IV as string, "hex")
  )

  const apiToken = req.header("Authorization") as string

  console.log(req.headers)

  let encryptedKey = cipher.update(apiToken, "utf-8", "base64")

  encryptedKey += cipher.final("base64")

  const apiConsumer = await em.findOne(APIConsumer, { key: encryptedKey })
  console.log(apiConsumer)

  if (!apiConsumer) return false

  res.locals.apiConsumer = apiConsumer
  return true
}
