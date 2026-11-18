# Geasa

A geas is one piece of work you hand to an agent. The agent works in its own thread and hands back a
report: the result, risks, proof, and checks. You review the report instead of reading the
conversation. Geasa live in the **Grimoire**, which you open from the book icon in the sidebar or
**Open Grimoire** in the command palette. Geasa are an Annex feature on web and desktop.

## Enact a geas

1. In the Grimoire, choose **Enact**, or choose **Enact a geas** in the command palette.
2. Describe the work and what done looks like. Pick the project, a workspace (a new worktree or the
   project checkout), and a model. Annex remembers these for the next geas.
3. Choose **Enact** to start now, or **Add to backlog** to start it later.

Each geas gets a key such as `ANX-12`. The prefix comes from the project name; you can change it in
the Grimoire settings. The title is written from your request, the way thread titles are; select it
on the geas page to rename it.

## Review and steer

The Grimoire groups geasa by what they need from you. **Needs you** means the agent asked something,
a run failed, or a run ended without handing back a report.

- A comment reaches a running agent right away when its provider supports steering (Claude and
  Codex). Other providers read it when their next run starts. When no run is going, a comment starts
  one.
- Buttons under an agent's comment answer it. When it offers options, tick any and choose **Send**.
  Only the latest unanswered ask has live buttons.
- Select text in the report to cite it in a comment, the way **Cite** works in chat, or to enact a
  new geas about it in the same project. **Queue** hands that request to the geas's own agent
  instead, which files the new geas after its current run, with what it knows.
- When a geas is in review, the delivery buttons send their prompt to the agent. **Land it** sends
  "Land this." and **Full Stop** sends "Use Full Stop.", which run those skills if you have them.
- Archiving a geas hides it from the Grimoire; the archive button there shows archived geasa again.
- Moving a geas to **Done** or **Canceled** settles its thread; moving it back unsettles it. A geas
  in review moves to Done on its own when its pull request merges.

## Checks

The agent declares each check as the exact command it ran. Annex marks the check passed or failed
from that command's real exit code in the thread, or **not verified** when it never saw the command
run, or saw it run behind a pipe, `;` or `|| true` that could hide its exit code. In the Grimoire
settings, list the check commands a project vouches for; once any are listed, only declared commands
that start with one of them can pass.

## Project settings

Open the gear in the Grimoire to set, per project:

- **Key prefix**: up to 8 letters and digits. Existing keys keep their prefix.
- **Checks**: the commands described above.
- **Delivery actions**: the buttons shown on a geas in review and the prompt each sends.
- **Rules**: text added to the instructions of every run in that project.

You can also ask an agent in any thread to set these up for its project.
