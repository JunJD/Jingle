import { defineJingleHarnessHook } from "./harness-hooks"
import type { RuntimeMiddlewareHook } from "./harness-runtime"
import {
  createJingleTodoListMiddleware,
  type JingleTodoListMiddleware
} from "./harness-runtime/todo-list"

export const JINGLE_TODO_SYSTEM_PROMPT = `## \`write_todos\`

Use \`write_todos\` as jingle's task attention anchor for long-running work. The todo list is the visible working memory that keeps the goal, current step, blockers, verification, and remaining work near the end of context.

Use this tool when:
- The request needs 3+ distinct conceptual steps, not merely 3 tool calls.
- The work is non-trivial, likely to span many tool calls, or may need plan revisions.
- The user gives multiple tasks or adds new instructions during a run.
- New evidence changes the plan and the remaining work should be made explicit.

Rules:
- Create the first list before substantial work begins, and mark the first real step as \`in_progress\`.
- Keep the list minimal, usually 3-6 actionable items.
- Keep exactly one \`in_progress\` item for serial work. Use multiple \`in_progress\` items only for truly independent parallel branches.
- Update statuses in real time. Do not batch completions.
- Mark \`completed\` only after the required work and verification are actually done.
- If blocked or partial, keep the active item \`in_progress\` and add or update a pending item that names the concrete blocker or follow-up.
- Revise stale pending items as new evidence changes the plan. Do not rewrite completed items unless correcting a factual mistake.
- Preserve user-provided commands, filenames, flags, arguments, and explicit requirements verbatim inside todo content when they define the work.
- Do not stop after writing todos unless the user explicitly asked for planning only. Continue with the next action.
- Do not call \`write_todos\` more than once in the same model turn.`

export const JINGLE_TODO_TOOL_DESCRIPTION = `Create and maintain jingle's structured task list for the current task. Use it as an attention anchor for complex, multi-step work: track the active step, remaining work, blockers, and verification so the task does not drift in long tool loops.

Use proactively for 3+ distinct conceptual steps, non-trivial coding or research work, multiple user tasks, new instructions, or plan changes discovered while working.

Skip it for single straightforward tasks, purely conversational answers, or work where tracking adds no value.

Each todo must be specific and actionable. Keep the list small, update it immediately as work changes, keep one in_progress item for serial work, and mark completed only after the work and required verification are actually done.`

function createJingleTodoRuntimeMiddleware(): JingleTodoListMiddleware {
  return createJingleTodoListMiddleware({
    systemPrompt: JINGLE_TODO_SYSTEM_PROMPT,
    toolDescription: JINGLE_TODO_TOOL_DESCRIPTION
  })
}

export function createJingleTodoHook(): RuntimeMiddlewareHook<JingleTodoListMiddleware> {
  return defineJingleHarnessHook({
    name: "todo",
    phase: "agent_loop",
    adapterStateKeys: [],
    reads: [],
    runtimeStateKeys: [],
    writes: ["todos"],
    writePolicy: "command-update",
    failureSemantics: "core",
    observableSignals: ["state", "stream"],
    createMiddleware: createJingleTodoRuntimeMiddleware
  })
}
