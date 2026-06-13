# Run Your First Agent Task

[中文](./first-agent-run-cn.md)

Use the launcher to start an agent task from your current context.

## Before You Start

Make sure you have:

- configured a model in Settings -> Models,
- chosen a trusted workspace,
- understood the current permission mode.

The agent can read workspace context and may ask to run commands or edit files.
Only approve actions you understand.

## Start From The Launcher

1. Open the launcher.
2. Type the task you want the agent to do.
3. Open the AI surface from the launcher result.
4. Review the selected model and permission mode in the AI header.
5. Submit the task.

During the run, the conversation shows progress, tool activity, approval prompts,
and final results. Generated files, patches, links, and summaries can appear as
artifacts in the thread.

## Approvals

If the agent needs human approval, the run pauses and shows an approval card.
Read the requested action before approving. Reject it if the command, file edit,
or external action is not what you intended.

## Stop Or Continue

You can stop a busy run from the AI surface. Previous work remains in the thread
history, so you can return to it later from the main history window or thread
search.

If a task should continue from an earlier point, use the thread controls to
continue or fork the work rather than starting from scratch.
