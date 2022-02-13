import { ObjectType, Field, ID } from "type-graphql"

@ObjectType()
export class Notification {
  @Field(type => ID)
  id: number

  @Field({ nullable: true })
  message?: string

  @Field(type => Date)
  date: Date
}

export interface NotificationPayload {
  id: number
  message?: string
}

@ObjectType()
export class AnswerNotification {
  @Field(type => ID)
  gameId: string

  // @Field(type => String)
  // guildId: string

  @Field(type => [String!], { nullable: "items" })
  answers: Array<string | null>

  // @Field(type => Date)
  // date: Date
}

export interface AnswerNotificationPayload {
  gameId: string
  answers: Array<string | null>
}
