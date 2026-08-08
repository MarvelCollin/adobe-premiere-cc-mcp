# Security

## Reporting

Report a vulnerability through GitHub's private advisory form on this repository, under
Security then Report a vulnerability. Please do not open a public issue for anything
exploitable.

Expect an acknowledgement within a week. This is a personal project rather than a funded
one, so there is no paid bounty.

## What this software can do

Worth understanding before you install it, because the risk is real and by design.

This is an MCP server. It gives an AI assistant the ability to drive Adobe Premiere Pro
on your machine. That includes:

- **Editing and deleting** clips in whatever project is open. `remove_clip`, `split_clip`
  and `trim_clip` change real work.
- **Writing files anywhere your user account can write**, through `export_frame`,
  `export_sequence`, `contact_sheet` and `review_sequence`, which all take an output path.
- **Running arbitrary ExtendScript inside Premiere**, through `run_script`. This is the
  deliberate escape hatch for anything the typed tools do not cover, and it is as
  powerful as anything Premiere itself can do.

Nothing here sandboxes the assistant. Treat the server as you would a terminal.

Practical advice:

- Keep a backup of any project you care about. Nothing auto saves, and `save_project` is
  the only thing that writes the project to disk.
- Point the assistant at a copy first if the work matters.
- `npm run verify -- --destructive` edits the active sequence on purpose. Run it on a
  scratch project.

## The signing certificate

The panel is a CEP extension, and Premiere refuses unsigned extensions. The shipped
`.zxp` is signed with a **self signed** certificate, not one from a public authority.
That means it proves the package has not been altered since it was built, and it does not
prove anything about who built it.

The private key is never committed and never published to npm. If you would rather not
trust the shipped package, run `npm run sign-panel` to generate your own certificate and
build the `.zxp` yourself from the panel source in this repository.

## Dependencies

Two runtime dependencies, `@modelcontextprotocol/sdk` and `zod`. No install scripts, no
native modules, no telemetry, and no network access at runtime beyond the MCP transport
itself. The bridge to Premiere is a local file exchange in your temporary directory.
