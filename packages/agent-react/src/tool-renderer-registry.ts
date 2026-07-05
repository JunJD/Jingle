export interface JingleToolRendererDefinition {
  name: string
}

export interface JingleToolRendererRegistry<TDefinition extends JingleToolRendererDefinition> {
  define: (definition: TDefinition) => TDefinition
  get: (name: string) => TDefinition | undefined
  register: (definition: TDefinition) => () => void
}

export function createJingleToolRendererRegistry<
  TDefinition extends JingleToolRendererDefinition
>(): JingleToolRendererRegistry<TDefinition> {
  const registry = new Map<string, TDefinition>()

  return {
    define: (definition) => {
      registry.set(definition.name, definition)
      return definition
    },
    get: (name) => registry.get(name),
    register: (definition) => {
      registry.set(definition.name, definition)

      return () => {
        if (registry.get(definition.name) === definition) {
          registry.delete(definition.name)
        }
      }
    }
  }
}
