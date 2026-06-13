# Permission Modes

[中文](./permission-modes-cn.md)

Permission modes control how much the agent can do before asking you. They are a
trust and safety boundary, not just a UI preference.

## What They Affect

Permission modes can affect:

- shell commands,
- file edits,
- desktop automation,
- extension write actions,
- external service changes such as creating issues, updating reminders, or adding
  Notion content.

The exact approval depends on the tool and task. When the app shows an approval
card, that approval card is the current decision point.

## Common Modes

The launcher AI surface exposes permission choices such as:

- `Auto`: lower-friction for actions the app considers safe or already allowed.
- `Explore`: better for read-heavy investigation and cautious exploration.
- `Ask to edit`: asks before write-oriented actions.

Use the most restrictive mode when you are working in a sensitive workspace or
when you are not sure what the task will require.

## Approval Cards

When an approval appears:

1. Read the command or action.
2. Check the target file, app, service, or account.
3. Approve only if it matches your intent.
4. Reject if the action is surprising or too broad.

Rejecting an approval is safe. The agent should continue from that decision or
explain what it cannot do.

## Practical Rule

For a new project, start cautious. After you trust the workspace, model, and task
shape, you can loosen the permission mode for routine work.
