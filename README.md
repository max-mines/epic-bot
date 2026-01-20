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
   - `/review-epic` - Description: "Review an existing epic from saved file (provide epic ID)"
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

You should see: `⚡️ Epic Bot v0.2 is running!`

## Usage

### Creating an Epic

1. In Slack, type: `/story Build a student dashboard`
2. Answer the 3 questions (or type `same` to reuse your previous answers):
   - Who is this for?
   - What problem does it solve?
   - What's your tech stack?
3. The bot automatically fetches your GitHub repo's README.md for context and generates stories that align with your existing project structure
4. Choose what to do with the generated stories:
   - Type `review` to run AI quality review (recommended)
   - Type `refine` to interactively refine individual stories
   - Type `Y` to create GitHub issues immediately (skip review)
5. After refining or reviewing, finalize:
   - Type `Y` to create GitHub issues
   - Type `refine` to make more refinements (if you ran review first)

Done! Your epic and stories are now GitHub issues ready for development.

### Interactive Refinement Mode

You can refine individual stories at two points:
- After initial story generation (before review)
- After the review (before creating GitHub issues)

1. Type `refine` when prompted
2. Select a story by number (e.g., type `1` or `3`)
3. Make changes using natural language:
   - "add acceptance criteria for error handling"
   - "change this to be for instructors instead"
   - "add validation for email addresses"
4. Navigate between stories:
   - `next` - Move to the next story
   - `prev` - Move to the previous story
   - `back` - Return to story selection menu
   - `overview` - See all stories again
5. When finished, type `done` to create GitHub issues

**Example conversation:**
```
Bot: Create GitHub issues? [Y/n/refine]
You: refine

Bot: Select a story to refine:
     1. User Login
     2. Dashboard View
     3. Data Export

You: 3

Bot: Story #3: Data Export
     As a user, I want to export my data...

You: add acceptance criteria for error handling

Bot: ✅ Updated Story #3: Data Export
     ...
     - Show error message if export fails
     - Disable export button during processing

You: next

Bot: Story #4: Profile Settings
     ...
```

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
- **Keep the local epic JSON file** in the `epics/` folder

**Notes:**
- This closes issues rather than deleting them (GitHub doesn't allow permanent deletion via API)
- The local JSON file is preserved so you can restore the epic later using `/review-epic` if needed

### Re-reviewing an Existing Epic

You can re-run the review process on an epic that was previously saved locally:

1. Find the epic ID from the `epics/` folder (e.g., `epic-2026-01-20T03-22-56`)
2. Run the command:
   ```
   /review-epic epic-2026-01-20T03-22-56
   ```

3. The bot will load the epic from the JSON file and run a fresh review:
   ```
   Bot: 📝 Reviewing epic: "Build a student dashboard"

        Running review...

        🔍 Review complete!

        ✅ Good:
        - Clear user value in all stories

        ⚠️ Issues:
        - Stories too large
        - Missing error handling

        Would you like me to address these issues?
        Type `all` to address all issues, or type issue numbers (e.g., `1, 2, 4`)...
   ```

4. You can then:
   - Address review issues with `all` or specific issue numbers
   - Use `refine` for interactive refinement
   - Create GitHub issues with `Y`

**Use cases:**
- Review epics that were created before the bulk refinement feature
- Get fresh feedback on an epic with different context
- Re-review after manually editing the JSON file

### Quick Testing Mode

For faster testing and iteration, the bot caches your previous answers per user:

1. The first time you run `/story`, you'll answer all 3 questions normally
2. On subsequent runs, each question shows your previous answer:
   ```
   Q1: Who is this for?

   Previous answer: "students"

   Type `same` to reuse, or provide a new answer.
   ```
3. Type `same` to skip typing the same answer again, or provide a new answer to override
4. Mix and match - use `same` for some questions and new answers for others

This is especially useful when:
- Testing different epic descriptions with the same context
- Iterating on story generation
- Quickly creating multiple related epics

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

## License

MIT
