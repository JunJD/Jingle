# Workspace

[中文](./workspace-cn.md)

A workspace is the local project or folder boundary for an agent task.

The workspace matters because Openwork/Jingle is a desktop agent. It can inspect
local files, reference workspace paths, run commands, and create artifacts. Use a
workspace you trust and understand.

## Default Workspace

Settings -> General lets you set a default workspace. The launcher and new
threads use that workspace unless a thread chooses a different one.

Thread-level workspace choices can override the default. This lets you keep
separate projects separate.

## What The Agent Can See

Depending on the task and approvals, the agent may use:

- the current workspace path,
- files you attach,
- workspace file mentions,
- local memory and workspace context sources,
- tool outputs from approved commands.

Do not choose a folder that contains secrets or unrelated private projects unless
you are comfortable giving the agent task-level access to that context.

## What Gets Saved

Openwork/Jingle stores thread history, run state, artifacts, memory records, and
local logs under the local Openwork data directory. By default that directory is
`~/.openwork`. Tests and support builds can override it with `OPENWORK_HOME`.

## When To Change Workspace

Change workspace when:

- the task belongs to another project,
- the agent says it cannot find the expected files,
- a run was started in the wrong folder,
- you want memory and context to stay scoped to a different project.
