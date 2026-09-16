# Meme bot

Finds a meme by description, using FlyHash — a similarity hash modelled on the
fruit fly's olfactory circuit. No embedding API, no vector database, no model
to host. Each meme is 256 bytes of tag, matching takes microseconds.

```
/meme description:losing my mind panicking
/meme description:gore tone:dark
/meme description:nope alastor
```

It shows the best few matches privately. You pick one, the bot posts it to the
channel. A bad match is never visible to anyone but you.

## Setup

**1. Create the Discord application**

discord.com/developers/applications → New Application → Bot → Reset Token.
Copy the token; it is shown once.

Under **OAuth2 → URL Generator**, tick `bot` and `applications.commands`, then
under Bot Permissions tick **Send Messages** and **Attach Files**. Open the
generated URL to add the bot to your server.

No privileged intents are needed. Leave Message Content Intent off.

**2. Configure**

```bash
cp .env.example .env
```

Fill in `DISCORD_TOKEN` and `CLIENT_ID` (Application ID, on the General
Information page). `GUILD_ID` is already set.

**3. Install and register the command**

```bash
npm install
npm run deploy     # registers /meme, run again only if the command changes
npm start
```

You should see `10 memes loaded`. The command appears in the server
immediately, because it is registered per-guild rather than globally.

## Adding memes

Drop the image in `memes/images/` and add an entry to `memes/index.json`:

```json
{
  "file": "this-is-fine.jpg",
  "tone": "normal",
  "aliases": ["this is fine", "fine dog"],
  "description": "dog sitting in a burning room saying this is fine, denial, pretending everything is okay while disaster happens, ignoring a problem, cheerful in a catastrophe"
}
```

**Write the description the way someone would ask for it, not the way the
image looks.** The words people type are usually nowhere in the picture —
"denial", "ignoring a problem" — and those are the words that make it match.
Three words of description means it will almost never come up; twenty
synonyms means it comes up when it should.

`aliases` are matched exactly and always win, so `/meme this is fine` returns
that meme regardless of score. Put the names people actually use there.

`tone` is `normal` or `dark`, and filters before searching. Default `normal`
if omitted.

Then check your work without touching Discord:

```bash
npm run check                          # validate + sample queries
npm run check -- "everything is on fire"
npm run check -- "gore" dark
```

`check` also verifies every entry has its image and every image has an entry —
a meme missing from disk otherwise fails only when someone picks it.

## Why the settings are what they are

**`sparsity: 0.10`**, not the library default of 0.05. Descriptions run 20–40
words and 102 bits cannot hold that: winner-take-all squeezes individual words
out, so a query matching real words scored no better than noise. Measured
against queries with known right answers, 0.05 put true matches at 0.25 and
false positives at 0.26. At 0.10 it is 0.55 versus 0.40 — a gap you can
threshold. The tag is 256 bytes either way.

**`MIN_SCORE=0.45`** sits in that gap. Raise it if you see junk, lower it if
real matches are being hidden. It is a measurement, not a guess, and it is
worth re-measuring once the library is much larger.

**The relative cutoff (60% of the best score)** exists because containment
divides by the smaller bit count, so two-word queries inflate everything.
"hating ai" put the right meme at 1.00 but dragged two unrelated ones to 0.54
and 0.46 — above any threshold that still allows real matches on longer
queries. Asking "is this competitive with the winner" separates them; asking
"is this good" cannot.

## What it cannot do

It matches shared words and spelling, not meaning. "my deploy failed and the
client is calling" will not find the this-is-fine dog, because they share
almost no characters — even though that is exactly when you would want it.

Typos, word order and partial words are all fine. Synonyms you did not write
into the description are not. That is what the description field is for.

## Deploying

The images live in the repo, so there is nothing external to host. Push and it
works.

```bash
cd meme-bot
git init
git add .
git commit -m "Meme bot"
git branch -M main
git remote add origin git@github.com:blade361/meme-bot.git
git push -u origin main
```

`.env` is gitignored. Set the secrets in Render's dashboard instead.

**Register the slash command from your own machine**, once, before or after
deploying:

```bash
npm run deploy
```

It only writes to Discord's API, so it does not need to run on the server.

Commands are registered per server, not globally — they appear instantly that
way instead of taking up to an hour. So a server that has the bot but was
never in `GUILD_ID` will show no `/meme` at all. For several servers, list the
ids separated by commas:

```
GUILD_ID=111111111111111111,222222222222222222
```

and run `npm run deploy` again. Existing registrations are not removed, so
adding a server later is safe.

### Which Render service

A Discord bot holds an outbound websocket and receives no HTTP traffic, so
Render's free Web Service tier — which sleeps after 15 minutes without a
request — is the wrong shape for it.

**Background Worker** is the right product. Always on, nothing to work around,
around $7/month. Uncomment block A in `render.yaml`.

**Free Web Service** works because the bot keeps itself awake. When `PORT` is
set it starts a health endpoint, and when `RENDER_EXTERNAL_URL` is set it
pings that URL every 10 minutes — inbound traffic through Render's router,
which resets the 15-minute idle timer. Nothing external to configure. This is
block B and the default in `render.yaml`.

Two limits worth knowing. The timer cannot wake an instance that has already
gone down, since a sleeping instance runs no timers — after a crash or a
redeploy it takes a real visit to the URL to bring it back. And staying up
continuously uses roughly 730 of Render's 750 free instance hours per month,
so this is one free always-on service, not several.

Set `KEEPALIVE_MINUTES` lower if Render ever tightens the timeout; it just has
to stay under it.

Either way, set `DISCORD_TOKEN`, `CLIENT_ID` and `GUILD_ID` under Environment
in the Render dashboard.

### Always returning something

`/meme` never answers "not found". If nothing clears `MIN_SCORE` it says so
and shows the closest few anyway; if a query overlaps nothing at all it offers
a random meme of the right tone. The picker is private, so a bad suggestion
costs one glance, while a dead end costs the whole interaction.

Confident results are filtered harder than guesses: a companion result must
clear both the absolute threshold and 60% of the winner's score. Guesses skip
both, because among noise the ranking is arbitrary and more choice is better.
