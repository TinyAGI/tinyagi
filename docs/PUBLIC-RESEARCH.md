# Public evidence handoff with an optional MCP tool

TinyAGI's [research assistant](AGENTS.md#adding-agents) can collect public
documentation for a teammate. This walkthrough connects one researcher's Claude
Code workspace to Parallel's hosted MCP server, then uses the existing
[team handoff](TEAMS.md#teammate-mention-formats) to send original source URLs and
short excerpts to a writer. It requires no TinyAGI runtime changes.

The optional connection needs no Parallel API key for rate-limited web search.
Your existing Claude Code authentication is still required. Search queries are
sent to Parallel; use public topics, such as the documentation lookup below.
See [Parallel MCP setup](https://docs.parallel.ai/integrations/mcp/quickstart)
for service details and [Claude Code's MCP guide](https://code.claude.com/docs/en/mcp)
for client configuration.

## 1. Create the specialists

Use `tinyagi agent add` twice to create `researcher` and `writer`, choosing the
Anthropic provider and your usual model for each. If those IDs already exist,
use two new IDs and substitute them throughout this example. Run
`tinyagi agent show researcher` to find its `working_directory`.

Use `tinyagi team add` to create a team named `evidence` with members
`researcher` and `writer`, and `researcher` as leader. Use an unused team ID if
`evidence` already exists.

## 2. Connect only the researcher's workspace

Run these commands as the same OS user that runs TinyAGI. Replace the directory
with the researcher's actual `working_directory` if you use a custom workspace:

```bash
cd ~/tinyagi-workspace/researcher
claude mcp list
```

Check for an existing connection to Parallel before adding another. If there is
none, add a local-scoped connection:

```bash
claude mcp add --transport http --scope local parallel-public \
  'https://mcp.parallel.ai/mcp?tools=web_search' \
  --header 'User-Agent: TinyAGI/0.0.20'
claude mcp get parallel-public
```

The status should be connected. The `tools` parameter selects only `web_search`
from Parallel. Local scope associates this connection with the current directory
in the OS user's Claude Code configuration. TinyAGI invokes Claude Code in each
agent's `working_directory`, so a writer in a different directory does not inherit
this local entry. Keep any existing MCP settings and approvals in place; if you
reuse a connection under another name, use that name in the prompt below.

## 3. Define the handoff

Add the following instructions to the researcher's workspace `AGENTS.md`, keeping
any existing content:

```text
For public documentation requests, use parallel-public's web_search at most once
per user request, with one focused objective and one short keyword query. Prefer
official documentation. Send at most three relevant original source URLs, one
short supporting excerpt and a brief finding for each source, and any uncertainty
to writer using
[@writer: your findings, excerpts, and source URLs]. Keep the sources inside the
handoff. If the tool is unavailable, rate limited, or returns no relevant evidence,
hand that limitation to writer and stop; do not invent sources or keep retrying.
```

Add these instructions to the writer's workspace `AGENTS.md`:

```text
Your reply to a public evidence handoff is intended for the user. Summarize the
provided findings and retain the original source URLs as Markdown links next to
the claims they support. Preserve short supporting excerpts as quotes. State any
evidence gaps. Reply directly to the user without delegating or mentioning a
teammate. Do not perform additional research.
```

The call and source budgets are prompt instructions. The MCP selection limits
the tools exposed by this Parallel connection; the CLI's other tools and
TinyAGI's existing permission behavior still apply.

## 4. Run a documentation lookup

```bash
tinyagi start
tinyagi agent reset researcher
tinyagi agent reset writer
tinyagi send "@evidence Find the official Python venv documentation explaining how to create a virtual environment. Hand your findings, short excerpts, and original links to writer."
tinyagi logs queue
```

The resets start fresh conversations for these specialists. In the queue log,
look for the researcher's `web_search` call, a `researcher` to `writer` handoff
containing original URLs and excerpts, and the writer's final reply retaining
those links and excerpts. You can also inspect each agent's messages in TinyOffice. A successful CLI
enqueue alone does not show that research or the handoff completed. If a search
fails, the reply should describe that gap instead of presenting a sourced answer.

## Remove the optional connection

From the same researcher's working directory and OS user:

```bash
claude mcp remove --scope local parallel-public
tinyagi agent reset researcher
```

Remove the added research instructions if you no longer want that workflow.
If you reused an existing connection, keep it and remove only the instructions
added for this example. Other agents and the default agent need no MCP changes.
