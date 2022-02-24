import {
  Collection,
  Entity,
  ManyToMany,
  OneToMany,
  Property,
  SerializedPrimaryKey,
} from "@mikro-orm/core"
import { IsEmail } from "class-validator"
import { Field, ID, ObjectType } from "type-graphql"
import { Base } from "./Base"
import Game from "./Game"

@ObjectType()
@Entity()
export default class User extends Base<User> {
  @Field(type => ID)
  @SerializedPrimaryKey()
  id!: string

  @Field()
  @Property({ unique: true })
  discordId: string

  @Field(type => String)
  @Property({ nullable: true, unique: true })
  @IsEmail()
  email: string | null

  // @Property()
  // password: string

  // @Property()
  // refreshTokenCount: number = 0

  @Field(type => [Game], { nullable: true })
  @ManyToMany({ entity: () => Game })
  games = new Collection<Game>(this)
  // @Field(type => [Project], { nullable: true })
  // @OneToMany(type => Project, (project: Project) => project.owner)
  // projects = new Collection<Project>(this)
}
