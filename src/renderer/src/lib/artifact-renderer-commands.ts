export const artifactRendererCommands = {
  async openArtifact(artifactId: string): Promise<void> {
    const resolution = await window.api.artifacts.open(artifactId)

    if (resolution.type === "copy-link") {
      await navigator.clipboard.writeText(resolution.value)
    }
  }
}
