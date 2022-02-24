import { Entity, Property, SerializedPrimaryKey } from "@mikro-orm/core"
import { Base } from "./Base"

@Entity()
export default class APIConsumer extends Base<APIConsumer> {
  @SerializedPrimaryKey()
  id!: string

  @Property()
  name: string

  @Property()
  email: string

  @Property()
  key: string
}
