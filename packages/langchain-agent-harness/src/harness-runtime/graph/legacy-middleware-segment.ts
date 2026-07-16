import { END, Send } from "@langchain/langgraph"
import type { AgentMiddleware } from "langchain"
import { getHookConstraint } from "./middleware/utils.js"
import { LegacyAfterAgentNode } from "./nodes/legacy/LegacyAfterAgentNode.js"
import { LegacyAfterModelNode } from "./nodes/legacy/LegacyAfterModelNode.js"
import { LegacyBeforeAgentNode } from "./nodes/legacy/LegacyBeforeAgentNode.js"
import { LegacyBeforeModelNode } from "./nodes/legacy/LegacyBeforeModelNode.js"
import {
  LEGACY_MODEL_REQUEST_NODE_NAME,
  LEGACY_TOOLS_NODE_NAME,
  mapRuntimeDestination,
  parseRuntimeJumpTarget,
  type RuntimeDestinationMappingInput
} from "./legacy-destination-compat.js"
import type { StateManager } from "./state.js"

export const INTERNAL_MIDDLEWARE_NODE_PREFIX = "__internal_middleware__"

interface RuntimeGraphNodeGroup {
  readonly allowed?: readonly string[]
  readonly name: string
}

interface LegacyMiddlewareGraph {
  addConditionalEdges(
    source: string,
    path: (state: any) => unknown,
    pathMap?: readonly string[]
  ): void
  addEdge(source: string, target: string): void
  addNode(name: string, node: unknown, options?: unknown): void
}

interface LegacyMiddlewareSegmentInput {
  readonly graph: LegacyMiddlewareGraph
  readonly middleware: readonly AgentMiddleware[]
  readonly stateManager: StateManager
}

interface LegacyMiddlewareFlowInput extends RuntimeDestinationMappingInput {
  readonly graph: LegacyMiddlewareGraph
  readonly hasToolsAvailable: boolean
}

interface LegacyBeforeFlowInput extends LegacyMiddlewareFlowInput {
  readonly loopEntryNode: string
}

interface LegacyAfterModelFlowInput extends LegacyMiddlewareFlowInput {
  readonly afterModelEntryNode: string
  readonly modelStepResultNode: string
}

interface LegacyAfterAgentFlowInput extends LegacyMiddlewareFlowInput {}

interface LegacyMiddlewareNodeSegmentInput extends Omit<LegacyMiddlewareFlowInput, "exitNode"> {
  readonly afterModelEntryNode: string
  readonly modelStepResultNode: string
  readonly terminalNode: string
}

export interface MountedLegacyMiddlewareSegment {
  readonly allowsAfterModelResultJump: boolean
  readonly exitNode: string
  readonly loopEntryNode: string
  readonly runEntryNode: string
}

function isRuntimeDestination(destination: string | undefined): destination is string {
  return typeof destination === "string"
}

function createBeforeAgentRouter(input: {
  readonly exitNode: string
  readonly hasToolsAvailable: boolean
  readonly modelEntryNode: string
  readonly nextDefault: string
  readonly permissionGateNode: string
}) {
  return (state: any) => {
    if (!state.jumpTo) return input.nextDefault
    const destination = parseRuntimeJumpTarget(state.jumpTo)
    if (destination === END) return input.exitNode
    if (destination === LEGACY_TOOLS_NODE_NAME) {
      if (!input.hasToolsAvailable) return input.exitNode
      return new Send(input.permissionGateNode, {
        ...state,
        jumpTo: undefined
      })
    }
    return new Send(input.modelEntryNode, {
      ...state,
      jumpTo: undefined
    })
  }
}

function createBeforeModelRouter(input: {
  readonly exitNode: string
  readonly hasToolsAvailable: boolean
  readonly modelEntryNode: string
  readonly nextDefault: string
  readonly permissionGateNode: string
}) {
  return (state: any) => {
    if (!state.jumpTo) return input.nextDefault
    const destination = parseRuntimeJumpTarget(state.jumpTo)
    if (destination === END) return input.exitNode
    if (destination === LEGACY_TOOLS_NODE_NAME) {
      if (!input.hasToolsAvailable) return input.exitNode
      return new Send(input.permissionGateNode, {
        ...state,
        jumpTo: undefined
      })
    }
    return new Send(input.modelEntryNode, {
      ...state,
      jumpTo: undefined
    })
  }
}

function createAfterModelSequenceRouter(input: {
  readonly allowed: readonly string[]
  readonly exitNode: string
  readonly hasToolsAvailable: boolean
  readonly modelEntryNode: string
  readonly nextDefault: string
  readonly permissionGateNode: string
}) {
  const allowedSet = new Set(input.allowed.map((target) => parseRuntimeJumpTarget(target)))
  return (state: any) => {
    if (state.jumpTo) {
      const destination = parseRuntimeJumpTarget(state.jumpTo)
      if (destination === END && allowedSet.has(END)) return input.exitNode
      if (destination === LEGACY_TOOLS_NODE_NAME && allowedSet.has(LEGACY_TOOLS_NODE_NAME)) {
        if (!input.hasToolsAvailable) return input.exitNode
        return new Send(input.permissionGateNode, {
          ...state,
          jumpTo: undefined
        })
      }
      if (
        destination === LEGACY_MODEL_REQUEST_NODE_NAME &&
        allowedSet.has(LEGACY_MODEL_REQUEST_NODE_NAME)
      ) {
        return new Send(input.modelEntryNode, {
          ...state,
          jumpTo: undefined
        })
      }
    }
    return input.nextDefault
  }
}

function collectAllowedDestinations(
  node: RuntimeGraphNodeGroup,
  input: RuntimeDestinationMappingInput & { hasToolsAvailable: boolean; nextDefault: string }
): string[] {
  const allowedMapped = (node.allowed ?? [])
    .map((target) => parseRuntimeJumpTarget(target))
    .filter(isRuntimeDestination)
    .filter((destination) => destination !== LEGACY_TOOLS_NODE_NAME || input.hasToolsAvailable)

  return Array.from(
    new Set([
      input.nextDefault,
      ...allowedMapped.map((destination) =>
        mapRuntimeDestination(destination, {
          exitNode: input.exitNode,
          modelEntryNode: input.modelEntryNode,
          permissionGateNode: input.permissionGateNode
        })
      )
    ])
  )
}

export class LegacyMiddlewareSegment {
  readonly #afterAgentNodes: RuntimeGraphNodeGroup[] = []
  readonly #afterModelNodes: RuntimeGraphNodeGroup[] = []
  readonly #beforeAgentNodes: RuntimeGraphNodeGroup[] = []
  readonly #beforeModelNodes: RuntimeGraphNodeGroup[] = []

  constructor(input: LegacyMiddlewareSegmentInput) {
    const middlewareNames = new Set<string>()

    for (let index = 0; index < input.middleware.length; index++) {
      const middleware = input.middleware[index]
      if (middlewareNames.has(middleware.name)) {
        throw new Error(`Middleware ${middleware.name} is defined multiple times`)
      }
      middlewareNames.add(middleware.name)
      if (middleware.beforeAgent) {
        const node = new LegacyBeforeAgentNode(middleware, {
          getState: () => input.stateManager.getState(middleware.name)
        })
        input.stateManager.addNode(middleware, node)
        const name = `${INTERNAL_MIDDLEWARE_NODE_PREFIX}.${middleware.name}.before_agent`
        this.#beforeAgentNodes.push({
          allowed: getHookConstraint(middleware.beforeAgent),
          name
        })
        input.graph.addNode(name, node, node.nodeOptions)
      }

      if (middleware.beforeModel) {
        const node = new LegacyBeforeModelNode(middleware, {
          getState: () => input.stateManager.getState(middleware.name)
        })
        input.stateManager.addNode(middleware, node)
        const name = `${INTERNAL_MIDDLEWARE_NODE_PREFIX}.${middleware.name}.before_model`
        this.#beforeModelNodes.push({
          allowed: getHookConstraint(middleware.beforeModel),
          name
        })
        input.graph.addNode(name, node, node.nodeOptions)
      }

      if (middleware.afterModel) {
        const node = new LegacyAfterModelNode(middleware, {
          getState: () => input.stateManager.getState(middleware.name)
        })
        input.stateManager.addNode(middleware, node)
        const name = `${INTERNAL_MIDDLEWARE_NODE_PREFIX}.${middleware.name}.after_model`
        this.#afterModelNodes.push({
          allowed: getHookConstraint(middleware.afterModel),
          name
        })
        input.graph.addNode(name, node, node.nodeOptions)
      }

      if (middleware.afterAgent) {
        const node = new LegacyAfterAgentNode(middleware, {
          getState: () => input.stateManager.getState(middleware.name)
        })
        input.stateManager.addNode(middleware, node)
        const name = `${INTERNAL_MIDDLEWARE_NODE_PREFIX}.${middleware.name}.after_agent`
        this.#afterAgentNodes.push({
          allowed: getHookConstraint(middleware.afterAgent),
          name
        })
        input.graph.addNode(name, node, node.nodeOptions)
      }
    }
  }

  mountInternalNodes(input: LegacyMiddlewareNodeSegmentInput): MountedLegacyMiddlewareSegment {
    const runEntryNode = this.#runEntryNode(input.modelEntryNode)
    const loopEntryNode = this.#loopEntryNode(input.modelEntryNode)
    const exitNode = this.#exitNode(input.terminalNode)

    this.#mountBeforeModelLoop({
      exitNode,
      graph: input.graph,
      hasToolsAvailable: input.hasToolsAvailable,
      loopEntryNode,
      modelEntryNode: input.modelEntryNode,
      permissionGateNode: input.permissionGateNode
    })
    this.#mountAfterModel({
      exitNode,
      graph: input.graph,
      hasToolsAvailable: input.hasToolsAvailable,
      modelEntryNode: input.modelEntryNode,
      afterModelEntryNode: input.afterModelEntryNode,
      modelStepResultNode: input.modelStepResultNode,
      permissionGateNode: input.permissionGateNode
    })
    this.#mountAfterAgent({
      exitNode: input.terminalNode,
      graph: input.graph,
      hasToolsAvailable: input.hasToolsAvailable,
      modelEntryNode: input.modelEntryNode,
      permissionGateNode: input.permissionGateNode
    })

    return {
      allowsAfterModelResultJump: this.#allowsAfterModelResultJump(),
      exitNode,
      loopEntryNode,
      runEntryNode
    }
  }

  #runEntryNode(defaultTargetNode: string): string {
    return this.#beforeAgentNodes[0]?.name ?? this.#beforeModelNodes[0]?.name ?? defaultTargetNode
  }

  #loopEntryNode(defaultTargetNode: string): string {
    return this.#beforeModelNodes[0]?.name ?? defaultTargetNode
  }

  #exitNode(defaultExitNode: string): string {
    return this.#afterAgentNodes.at(-1)?.name ?? defaultExitNode
  }

  #allowsAfterModelResultJump(): boolean {
    const firstAfterModel = this.#afterModelNodes[0]
    return Boolean(firstAfterModel?.allowed && firstAfterModel.allowed.length > 0)
  }

  #mountBeforeModelLoop(input: LegacyBeforeFlowInput): void {
    for (let index = 0; index < this.#beforeAgentNodes.length; index++) {
      const node = this.#beforeAgentNodes[index]
      const nextDefault =
        index === this.#beforeAgentNodes.length - 1
          ? input.loopEntryNode
          : this.#beforeAgentNodes[index + 1].name
      if (node.allowed && node.allowed.length > 0) {
        input.graph.addConditionalEdges(
          node.name,
          createBeforeAgentRouter({
            exitNode: input.exitNode,
            hasToolsAvailable: input.hasToolsAvailable,
            modelEntryNode: input.modelEntryNode,
            nextDefault,
            permissionGateNode: input.permissionGateNode
          }),
          collectAllowedDestinations(node, {
            exitNode: input.exitNode,
            hasToolsAvailable: input.hasToolsAvailable,
            modelEntryNode: input.modelEntryNode,
            nextDefault,
            permissionGateNode: input.permissionGateNode
          })
        )
      } else {
        input.graph.addEdge(node.name, nextDefault)
      }
    }

    for (let index = 0; index < this.#beforeModelNodes.length; index++) {
      const node = this.#beforeModelNodes[index]
      const nextDefault =
        index === this.#beforeModelNodes.length - 1
          ? input.modelEntryNode
          : this.#beforeModelNodes[index + 1].name
      if (node.allowed && node.allowed.length > 0) {
        input.graph.addConditionalEdges(
          node.name,
          createBeforeModelRouter({
            exitNode: input.exitNode,
            hasToolsAvailable: input.hasToolsAvailable,
            modelEntryNode: input.modelEntryNode,
            nextDefault,
            permissionGateNode: input.permissionGateNode
          }),
          collectAllowedDestinations(node, {
            exitNode: input.exitNode,
            hasToolsAvailable: input.hasToolsAvailable,
            modelEntryNode: input.modelEntryNode,
            nextDefault,
            permissionGateNode: input.permissionGateNode
          })
        )
      } else {
        input.graph.addEdge(node.name, nextDefault)
      }
    }
  }

  #mountAfterModel(input: LegacyAfterModelFlowInput): void {
    const firstAfterModel = this.#afterModelNodes[0]
    const lastAfterModel = this.#afterModelNodes.at(-1)
    if (lastAfterModel) {
      input.graph.addEdge(input.afterModelEntryNode, lastAfterModel.name)
    } else {
      input.graph.addEdge(input.afterModelEntryNode, input.modelStepResultNode)
      return
    }

    for (let index = this.#afterModelNodes.length - 1; index > 0; index--) {
      const node = this.#afterModelNodes[index]
      const nextDefault = this.#afterModelNodes[index - 1].name
      if (node.allowed && node.allowed.length > 0) {
        input.graph.addConditionalEdges(
          node.name,
          createAfterModelSequenceRouter({
            allowed: node.allowed,
            exitNode: input.exitNode,
            hasToolsAvailable: input.hasToolsAvailable,
            modelEntryNode: input.modelEntryNode,
            nextDefault,
            permissionGateNode: input.permissionGateNode
          }),
          collectAllowedDestinations(node, {
            exitNode: input.exitNode,
            hasToolsAvailable: input.hasToolsAvailable,
            modelEntryNode: input.modelEntryNode,
            nextDefault,
            permissionGateNode: input.permissionGateNode
          })
        )
      } else {
        input.graph.addEdge(node.name, nextDefault)
      }
    }

    if (firstAfterModel) input.graph.addEdge(firstAfterModel.name, input.modelStepResultNode)
  }

  #mountAfterAgent(input: LegacyAfterAgentFlowInput): void {
    for (let index = this.#afterAgentNodes.length - 1; index > 0; index--) {
      const node = this.#afterAgentNodes[index]
      const nextDefault = this.#afterAgentNodes[index - 1].name
      if (node.allowed && node.allowed.length > 0) {
        input.graph.addConditionalEdges(
          node.name,
          createAfterModelSequenceRouter({
            allowed: node.allowed,
            exitNode: input.exitNode,
            hasToolsAvailable: input.hasToolsAvailable,
            modelEntryNode: input.modelEntryNode,
            nextDefault,
            permissionGateNode: input.permissionGateNode
          }),
          collectAllowedDestinations(node, {
            exitNode: input.exitNode,
            hasToolsAvailable: input.hasToolsAvailable,
            modelEntryNode: input.modelEntryNode,
            nextDefault,
            permissionGateNode: input.permissionGateNode
          })
        )
      } else {
        input.graph.addEdge(node.name, nextDefault)
      }
    }

    const firstAfterAgent = this.#afterAgentNodes[0]
    if (!firstAfterAgent) return

    if (firstAfterAgent.allowed && firstAfterAgent.allowed.length > 0) {
      const allowedMapped = firstAfterAgent.allowed
        .map((target) => parseRuntimeJumpTarget(target))
        .filter(isRuntimeDestination)
        .filter((destination) => destination !== LEGACY_TOOLS_NODE_NAME || input.hasToolsAvailable)
      const destinations = Array.from(
        new Set([
          input.exitNode,
          ...allowedMapped.map((destination) =>
            mapRuntimeDestination(destination, {
              exitNode: input.exitNode,
              modelEntryNode: input.modelEntryNode,
              permissionGateNode: input.permissionGateNode
            })
          )
        ])
      )
      input.graph.addConditionalEdges(
        firstAfterAgent.name,
        createAfterModelSequenceRouter({
          allowed: firstAfterAgent.allowed,
          exitNode: input.exitNode,
          hasToolsAvailable: input.hasToolsAvailable,
          modelEntryNode: input.modelEntryNode,
          nextDefault: input.exitNode,
          permissionGateNode: input.permissionGateNode
        }),
        destinations
      )
    } else {
      input.graph.addEdge(firstAfterAgent.name, input.exitNode)
    }
  }
}

export function createLegacyMiddlewareSegment(
  input: LegacyMiddlewareSegmentInput
): LegacyMiddlewareSegment {
  return new LegacyMiddlewareSegment(input)
}
