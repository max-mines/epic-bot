# CLAUDE.md

Slack bot that helps students create user stories from epic descriptions, reviews them with AI, then pushes to GitHub as issues.

## Commands

```bash
npm install    # Install dependencies
npm start      # Run bot (port 3000)
```

## Structure

```
bot.js       # Main Slack bot, state machine, session handling
claude.js    # Claude API calls + story parsing
github.js    # GitHub issue/milestone management via Octokit
prompts.js   # AI prompt templates
epics/       # Saved epic JSON files (only for /story command)
```

## Key Patterns

**State Machine (bot.js):** Q1 → Q2 → Q3 → GENERATING → APPROVAL → REVIEWING → REVIEW_APPROVAL → REFINING → INTERACTIVE_MODE → STORY_FOCUSED

**Sessions:** In-memory Map keyed by message timestamp. Tracks state, answers, stories, epic data. 1-hour cleanup.

**Story Flow:**
1. `/story` command → 3 guided questions
2. Claude generates 4-6 stories with acceptance criteria
3. AI review for quality issues
4. User approves or refines
5. GitHub Milestone created, then story issues assigned to it

**Parsing (claude.js):** Flexible regex handles formats like `1. Title`, `**1. Title**`, `## 1. Title`. Extracts title, "As a..." story, acceptance criteria list.

## Slack Commands

- `/story` - Start new epic creation
- `/review-epic` - Opens modal to select milestone from GitHub, then runs AI review
- `/delete-epic <milestone#>` - Close milestone and its issues

## Environment Variables

```
SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, ANTHROPIC_API_KEY
GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, PORT
```

## Tech Stack

Node.js, @slack/bolt, @anthropic-ai/sdk (Claude Sonnet), @octokit/rest

## Notes

- HTTP webhooks mode (ExpressReceiver) for Render.com deployment
- Epics are GitHub Milestones; story issues are assigned to them
- `/review-epic` fetches milestone + issues from GitHub (no local files)
- Answer caching: users can type "same" to reuse previous answers
- Fetches repo README for AI context awareness
- Sessions lost on restart (in-memory only)
