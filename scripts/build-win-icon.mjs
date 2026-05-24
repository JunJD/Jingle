import { writeFile } from "node:fs/promises"
import pngToIco from "png-to-ico"

const icon = await pngToIco("resources/icon.png")
await writeFile("resources/icon.ico", icon)
