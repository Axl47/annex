# Familiars

A Familiar is a standing agent with a role. It has one pinned channel thread that you talk to, and a
**Tome**: notes it keeps across sessions, so it remembers decisions and preferences after a
compaction or a new session. Talking to a Familiar is planning. Real work goes through
[geasa](geasa.md) it lays, and Annex tells it when one of them needs it. Familiars are an Annex
feature on web and desktop.

## Summon a Familiar

1. Open **Familiars** from the cat icon in the sidebar, or choose **Summon a Familiar** in the
   command palette.
2. Start from a role template or a blank role, then pick a name, the project, and a model.
3. Choose its autonomy. **Enact and start** lets it lay geasa and start their runs. **Backlog only**
   lets it lay geasa in the backlog, and you start them.

The channel is pinned and never settles on its own. Talk to the Familiar there like any thread.

## The Tome

The Familiar adds durable facts, decisions, and your standing preferences to its Tome as you work,
and the whole Tome rides along when a new session starts. Edit it on the Familiar's page; your edit
never overwrites a change the Familiar made meanwhile. The Tome holds at most 16 KB. Never put
secrets in it.

## Routines and wakes

A routine is a scheduled task that posts to the Familiar's channel. Ask the Familiar to schedule one,
or add one in **Settings → Scheduled tasks**.

When a geas a Familiar laid asks for input, moves to review, fails a run, hits its loop guard, lands,
or is canceled, Annex posts one **Wake** message to the channel once that geas's run ends.

Each Familiar has a daily budget of runs it didn't get from you: routine turns and wakes, 20 a day by
default. Once it is spent, its routines are turned off until tomorrow and wakes wait on its page.
Waiting wakes go out with your next message in the channel, or the next day.

## Pause and dismiss

- **Pause** turns off the channel's routines and holds wakes. **Resume** turns back on exactly the
  routines it turned off and delivers waiting wakes as one message. A one-off routine whose time
  passed while paused stays off, and Annex tells you.
- **Dismiss** unpins the channel and stops its routines; the archive button on the Familiars page
  shows dismissed Familiars, and **Restore** brings one back. Deleting the channel thread dismisses
  its Familiar for good.

## Claude · Familiars

The gear on the Familiars page sets up a Claude instance for long-lived channels. It compacts once a
session reaches the token count you choose, never compacts while idle, and uses your default Claude
sign-in. Pick it in the model picker when you summon. It needs permission to manage providers on that
environment.
