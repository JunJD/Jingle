# The Boring Feature Every Desktop Agent Needs: Local Diagnostics

[中文](./production-logs-and-diagnostics-cn.md)

"It failed" is not enough information for a desktop agent.

The failure could live almost anywhere: a model request, a missing credential, a
rejected approval, a window crash, an operating-system permission, an extension
connection, a command policy, or a malformed piece of state.

Without diagnostics, all of those failures collapse into the same user
experience: something went wrong and nobody knows where to look.

That is why local diagnostics matter.

They are not glamorous. They do not make for a good demo. But they are part of
the product's trust surface. If an agent workspace is going to touch files,
commands, windows, models, services, and user decisions, it needs a way to make
failure observable.

Good diagnostics are bounded. They should explain enough about app lifecycle,
tool execution, window behavior, connection state, and unexpected errors to give
support a starting point. They should not casually expose secrets, private
project contents, or unnecessary model payloads.

Good diagnostics are local-first. The user should not have to surrender a whole
workspace just to explain that something broke. The product should leave a small,
inspectable trail on the user's machine.

Good diagnostics also shape engineering behavior. When a failure is visible, it
can be assigned to a real boundary. When it can be assigned to a boundary, the
team can repair the contract instead of adding another vague fallback.

This is the quiet discipline behind reliable agent products:

make the work visible, make risk reviewable, make failure diagnosable.

For desktop agents, local diagnostics are not a developer luxury. They are the
difference between "the agent did something weird" and "we know where the system
crossed a boundary it could not handle."
