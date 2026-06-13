# Why Agent Work Needs A Local Workspace, Not Just A Prompt Box

[中文](./local-first-agent-workspace-cn.md)

A prompt box is a good place to ask a question. It is a poor place to manage a
unit of work.

Real work has state. It has files, decisions, attempts, approvals, partial
results, failures, and outputs that someone may need to inspect later. If an
agent product hides that state behind a disposable conversation, the user gets a
strange kind of power: the software can do more, but the person can understand
less.

A local workspace changes the contract.

It says: this is the place where the work is happening. This is the boundary for
context, files, commands, memory, history, and recovery. A task in a scratch
folder is not the same thing as a task in an important project. The product
should make that difference visible.

Local-first does not mean pretending the network does not exist. An agent may
use cloud models or connected services because the user chose them. Local-first
means the user's work state and control surfaces begin from the user's machine.

That matters for trust.

Memory should not feel like invisible model magic. It should feel like product
state the user can understand and control.

Approvals should not feel like interruptions. They should appear where the
delegated work crosses a boundary that deserves human judgment.

History should not be a transcript graveyard. It should be a way to return to
unfinished work with context still attached.

Diagnostics should not be an afterthought. They should make failures legible
without requiring the user to explain the whole environment from memory.

The point of a local workspace is not nostalgia for desktop software. It is
operational clarity. When state has a place, debugging has a path. When risk has
a surface, trust has a shape. When work leaves a trail, delegation becomes
something a person can live with.

Agent work should not disappear into a remote black box. It should land in a
workspace the user can see, understand, and control.
