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

  @Field(type => Date)
  updatedAt: Date

  @Field(type => Boolean)
  active: boolean

  @Field(type => [String!], { nullable: "items" })
  answers: Array<string | null>

  // @Field(type => Date)
  // date: Date
}

export interface AnswerNotificationPayload {
  gameId: string
  updatedAt: Date
  active: boolean
  answers: Array<string | null>
}
