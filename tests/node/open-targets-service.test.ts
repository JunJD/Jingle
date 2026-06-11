import assert from "node:assert/strict"
import test from "node:test"
import { OpenTargetsService } from "../../src/main/open-targets/service"

test("open targets reject blank folder paths", async () => {
  const service = new OpenTargetsService()

  await assert.rejects(service.listTargets({ folderPath: " " }), /Missing folder path/)
  await assert.rejects(
    service.openTarget({
      folderPath: "",
      targetId: "finder"
    }),
    /Missing folder path/
  )
})
