# Epic Bot

A lightweight Slack bot that helps students create well-structured epics and user stories, then pushes them to GitHub as issues.

## Features

- **Phase 1**: Interactive epic creation with 3 simple questions
- **Phase 2**: Automated design review with fresh context
- **GitHub Integration**: Automatically creates issues from user stories

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up Slack App

1. Go to https://api.slack.com/apps
2. Click "Create New App" → "From scratch"
3. Name it "Epic Bot" and select your workspace
4. Navigate to "OAuth & Permissions" and add these Bot Token Scopes:
   - `commands`
   - `chat:write`
   - `im:write`
   - `channels:history`
   - `groups:history`
   - `im:history`
   - `mpim:history`
5. Navigate to "Slash Commands" and create these commands:
   - `/story` - Description: "Create an epic with user stories"
   - `/delete-epic` - Description: "Delete an epic and its stories (provide issue number)"
6. Navigate to "Socket Mode" and enable it
   - Generate an App-Level Token with `connections:write` scope
7. Navigate to "Event Subscriptions" and enable events
   - Subscribe to bot events: `message.channels`, `message.im`, `message.groups`, `message.mpim`
8. Install the app to your workspace
9. Copy the tokens (you'll need them for `.env`)

### 3. Create `.env` File

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Edit `.env`:
```bash
# From Slack app settings
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
SLACK_APP_TOKEN=xapp-...

# From https://console.anthropic.com/
ANTHROPIC_API_KEY=sk-ant-...

# GitHub personal access token with 'repo' scope
GITHUB_TOKEN=ghp_...
GITHUB_OWNER=your-username
GITHUB_REPO=your-repo
```

### 4. Run the Bot

```bash
npm start
```

You should see: `⚡️ Epic Bot is running!`

## Usage

### Creating an Epic

1. In Slack, type: `/story Build a student dashboard`
2. Answer the 3 questions:
   - Who is this for?
   - What problem does it solve?
   - What's your tech stack?
3. Review the generated stories and type `Y` to approve
4. Review runs automatically
5. Type `Y` to create GitHub issues

Done! Your epic and stories are now GitHub issues ready for development.

### Deleting an Epic

To delete an epic and all its associated stories:

1. Run the command:
   ```
   /delete-epic 42
   ```

2. The bot will show you the epic and all stories that will be closed:
   ```
   ⚠️ Confirm deletion of epic #42: Student Dashboard

   Stories to be closed (5):
   - #43: View all assignments
   - #44: Filter by course
   ...

   Type Y to confirm deletion, or anything else to cancel.
   ```

3. Reply `Y` to confirm or anything else to cancel

This will:
- Close the epic issue (#42)
- Close all associated user story issues
- Delete the local epic JSON file

**Note:** This closes issues rather than deleting them (GitHub doesn't allow permanent deletion via API).

## Project Structure

```
epic-bot/
├── bot.js           # Main Slack bot logic
├── claude.js        # LLM integration
├── github.js        # GitHub issue creation
├── prompts.js       # Prompt templates
├── package.json     # Dependencies
├── .env             # Secrets (don't commit!)
└── epics/           # Saved epic JSON files
```

## Troubleshooting

**Bot doesn't respond to `/story`:**
- Check Socket Mode is enabled in Slack app settings
- Verify `SLACK_APP_TOKEN` is correct
- Check bot has `commands` scope

**Claude errors:**
- Verify `ANTHROPIC_API_KEY` is valid
- Check you have API credits at https://console.anthropic.com/

**GitHub errors:**
- Verify `GITHUB_TOKEN` has `repo` scope
- Check `GITHUB_OWNER` and `GITHUB_REPO` are correct
- Ensure token has access to the repository

## Development

To modify prompts, edit `prompts.js`.

To change the review delay, edit this line in `bot.js`:
```javascript
}, 2 * 60 * 1000); // 2 minutes in milliseconds
```

## License

MIT
