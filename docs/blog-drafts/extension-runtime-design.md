# Designing Extensions For Agent Workflows

[中文](./extension-runtime-design-cn.md)

Desktop extensions are usually designed around a person invoking a command:
search, open, choose, submit, done.

Agent workflows add another actor. The assistant also needs capabilities. It may
need to search a service, create a record, summarize a source, open a file, or
prepare an action for the user to approve.

If the human surface and the agent surface are designed separately, trust breaks
quietly.

The person may see a connected command while the assistant sees no usable
capability. The assistant may know a tool exists while the visible interface
cannot explain what account, permission, or state it depends on. A capability may
work once and then become impossible to debug because every layer carries a
different version of the truth.

The extension model for agent work has to resist that split.

An extension should have one clear identity, one clear account boundary, and one
clear capability contract. Human commands and assistant tools do not need to be
the same interface, but they should be different views of the same underlying
capability.

That means a few product rules matter:

- connection state should have one owner;
- secrets should not leak into rendering or prompt construction;
- a command should not imply a capability that the agent cannot actually use;
- an agent tool should not bypass the visible permission model;
- display state should be derived from real capability state, not guessed from
  labels.

This is not architecture for architecture's sake. It is how extensions stay
understandable when they are used by both people and agents.

For a person, an extension is a way to do something quickly. For an agent, an
extension is a capability with context, permissions, and consequences. The
product has to make those two views meet without collapsing them into one messy
surface.

The goal is simple:

a connected capability should behave like one thing, not two half-connected
things.
