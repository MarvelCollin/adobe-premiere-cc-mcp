# Contributing

Thanks for taking an interest. This project drives a real application on a real machine,
so the bar is that a change is proven against Premiere rather than argued for.

## Getting set up

```bash
npm install
npm run build
npm run sign-panel
npm run install-panel
```

Then restart Premiere and check the bridge is alive:

```bash
npm run smoke -- ping
```

`sign-panel` needs `tools/ZXPSignCmd.exe`, which is Adobe's signing utility from the
Adobe-CEP/CEP-Resources repository. It is deliberately not committed here, since it is
Adobe's to distribute rather than ours. The certificate it generates is also ignored, and
must never be committed.

## The loop

```bash
npm run check                                    # typecheck and tests
npm run build && npm run smoke -- <tool> '<json>' # try one tool for real
npm run verify                                   # read only sweep
npm run verify -- --destructive                  # full sweep, edits the project
npm run docs                                     # regenerate the README tool table
```

`smoke` truncates output at 1500 characters unless you pass `--full`.

Restart your MCP client only when you add a new tool *name*. Changing an existing tool
needs a build and a `smoke` run, nothing more.

## What a good change looks like

- **Every write is verified by reading back.** A tool that returns success without
  checking is the bug this project exists to avoid. Several tools here were found
  reporting success while doing nothing at all.
- **Say what actually happened.** If Premiere clamped a value or refused, report that
  rather than rounding it up to success.
- **Prove it against Premiere.** Include what you ran and what came back. Tests cover the
  generated script, not the host, so a green test suite is necessary and not sufficient.
- **Add sample arguments** for any new tool with a schema, in
  `tests/generated-script.test.ts`. A guard fails the build otherwise.
- **Add read only tools to `scripts/verify.mjs`** so the sweep covers them.
- **Leave the project as you found it.** A sweep that pollutes the user's sequence is a
  bug even when every tool passed; that exact case has already happened here.

## House style

- No comments in the code. Names and structure carry the meaning.
- Commit subjects only, prefixed `feat:`, `fix:`, `docs:`, `refactor:`, `test:` or
  `chore:`. No body, no bullet lists in the message.
- ExtendScript is ES3: `var`, no arrow functions, no template literals, no `JSON`.

## Reporting a Premiere limitation

Findings about what Premiere will and will not do from a script are as valuable as code
here, and belong in `TODO.md` under the known limits. Include the Premiere version. An
API that accepts a value and silently ignores it is worth documenting loudly, because the
next person will otherwise spend a day on it.
