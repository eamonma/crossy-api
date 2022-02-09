import {
  Entity,
  ManyToOne,
  Property,
  SerializedPrimaryKey,
} from "@mikro-orm/core"
import { Field, ID, Int, ObjectType, Root } from "type-graphql"
import { Base } from "./Base"
/*
 * File key format:
 * project.client/project.name/file.name
 */
@ObjectType()
@Entity()
export default class Game extends Base<Game> {
  @Field(type => ID)
  @SerializedPrimaryKey()
  id!: string

  // @Field()
  // @Property()
  // name: string

  @Field(type => String)
  @Property()
  puzzle: string

  @Field(type => String, { nullable: true })
  @Property()
  image: string

  @Field(type => [String], { nullable: "items" })
  @Property()
  answers: Array<string> = []

  @Field(type => String)
  @Property()
  guildId: string

  @Field(type => String)
  @Property()
  channelId: string

  @Field(type => Boolean)
  @Property()
  active: boolean = true

  // @Field(type => Project)
  // @ManyToOne(type => Project, { wrappedReference: true })
  // project: IdentifiedReference<Project>

  // constructor(project: Project, ...args: any[]) {
  //   super(...args)
  //   project = Reference.create(project)
  // }

  // @Field()
  // url(): string {
  //   const { AWS_BUCKET, AWS_ENDPOINT } = process.env
  //   return `https://${AWS_BUCKET}.${AWS_ENDPOINT}/${this.key}`
  // }

  // @Field(type => Project)
  // @ManyToOne(type => Project)
  // project: Project
}
