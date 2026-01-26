# Epic Bot

A lightweight Slack bot that helps students create well-structured epics and user stories, then pushes them to GitHub as issues.

## Features

- **Interactive Epic Creation**: Answer 3 simple questions to generate 4-6 user stories with AI assistance
- **Repository Context Awareness**: Automatically fetches your GitHub README to ensure stories align with existing project structure
- **AI Quality Review**: Get actionable feedback on story quality, size, and completeness
- **Bulk Refinement**: Address multiple review issues at once (e.g., "add acceptance criteria to all stories")
- **Interactive Story Editor**: Navigate between stories and refine them individually with natural language
- **GitHub Integration**: Automatically creates linked epic and story issues with proper formatting
- **Answer Caching**: Type `same` to reuse previous answers for faster epic creation
- **Epic Management**: Review existing epics, update GitHub issues, or delete entire epics

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

You should see: `⚡️ Epic Bot v0.3.0 is running!`

## Usage

### Creating an Epic

1. **Start the epic** in Slack:
   ```
   /story Build a student dashboard
   ```

2. **Answer 3 questions** (or type `same` to reuse your previous answers):
   - Q1: Who is this for? (e.g., "students", "instructors")
   - Q2: What problem does it solve?
   - Q3: Tech stack? (e.g., "React, Node, Postgres")

3. **AI generates 4-6 stories** with acceptance criteria:
   - Automatically fetches your repo's README.md for context
   - Stories align with your existing project structure
   - Each story includes 1-2 suggested acceptance criteria

4. **Review and refine** (choose one):
   - `review` - Run AI quality review (recommended for first-time epics)
   - `refine` - Interactively edit individual stories
   - `Y` - Create GitHub issues immediately (skip review)

5. **Address review issues** (if you chose review):
   ```
   Bot: ⚠️ Issues:
        1. Stories lack acceptance criteria
        2. Missing error handling stories
        3. Stories too large, should be split

        Type `all` to address all issues, or `1, 2` for specific ones

   You: all
   ```
   - Bot refines all stories to address the issues
   - Acceptance criteria are automatically added/improved

6. **Finalize**:
   - Type `Y` to create GitHub issues
   - Type `refine` to make manual adjustments before publishing

Done! Your epic and stories are now GitHub issues with:
- Epic issue linking to all story issues
- Story issues linking back to the epic
- Acceptance criteria as checkboxes
- Proper labels (`epic`, `user-story`, `epic-bot`)

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

### Re-reviewing and Updating an Existing Epic

You can re-run the review process on any epic that was previously saved:

1. **Find the epic ID** from the `epics/` folder:
   ```
   ls epics/
   # Shows: epic-2026-01-20T03-22-56.json
   ```

2. **Load and review the epic**:
   ```
   /review-epic epic-2026-01-20T03-22-56
   ```

3. **Review and refine**:
   ```
   Bot: 📝 Reviewing epic: "Build a student dashboard"

        Running review...

        🔍 Review complete!

        ✅ Good:
        - Clear user value in all stories

        ⚠️ Issues:
        1. Stories lack acceptance criteria
        2. Missing error handling stories
        3. Stories too large, should be split

        Would you like me to address these issues?
        Type `all` to address all issues, or `1, 2` for specific ones

   You: all
   ```

4. **Update GitHub issues** (if epic was already published):
   ```
   You: Y

   Bot: Updating GitHub issues...

        ✅ Updated epic #42: Build a student dashboard

        Stories:
        - #43: User Login
        - #44: Dashboard View
        ...

        Done! 🎉
   ```

**Use cases:**
- Add acceptance criteria to existing stories (common after review)
- Split large stories that were flagged in review
- Add missing error handling or edge case stories
- Update GitHub issues after refining stories locally

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

## How It Works

### Story Generation Flow

1. **Context Collection**: Bot asks 3 questions and fetches README.md
2. **AI Generation**: Claude Sonnet 4.5 generates stories using prompt templates
3. **Parsing**: Response is parsed into structured story objects with:
   - Story ID (e.g., `story-001`)
   - Title
   - User story ("As a... I want... so that...")
   - Acceptance criteria array

### Review and Refinement

- **Review**: Claude analyzes all stories for quality issues
- **Bulk Refinement**: Claude addresses selected issues across all stories
- **Interactive Refinement**: Users edit individual stories with natural language
- **Parsing Flexibility**: Parser handles multiple formats (with/without headers)

### GitHub Integration

1. **Story Issues Created**: Each story becomes an issue with checkboxes for acceptance criteria
2. **Epic Issue Created**: Links to all story issues using `#123` syntax
3. **Story Issues Updated**: Epic link added to each story (`Part of epic #42`)
4. **JSON Updated**: GitHub issue numbers saved to epic JSON for future updates

### State Machine

The bot uses a conversation state machine with these states:
- `Q1`, `Q2`, `Q3`: Question flow
- `GENERATING`: Calling Claude API
- `APPROVAL`: After generation, before review
- `REVIEWING`: Running quality review
- `REVIEW_APPROVAL`: After review, can address issues
- `REFINING`: Bulk refinement in progress
- `INTERACTIVE_MODE`: Story selection menu
- `STORY_FOCUSED`: Editing a specific story
- `DELETE_CONFIRMATION`: Confirming epic deletion

## Project Structure

```
epic-bot/
├── bot.js           # Main Slack bot logic and state machine
├── claude.js        # Claude API integration and response parsing
├── github.js        # GitHub issue creation/update/deletion
├── prompts.js       # Prompt templates for generation, review, refinement
├── package.json     # Dependencies (@slack/bolt, @anthropic-ai/sdk, @octokit/rest)
├── .env             # Environment variables (secrets)
└── epics/           # Saved epic JSON files with GitHub issue numbers
```

## Troubleshooting

**Bot doesn't respond to `/story`:**
- Check Socket Mode is enabled in Slack app settings
- Verify `SLACK_APP_TOKEN` is correct in `.env`
- Check bot has `commands` scope in OAuth settings
- Look at console logs for connection errors

**Claude errors:**
- Verify `ANTHROPIC_API_KEY` is valid
- Check you have API credits at https://console.anthropic.com/
- Look for `[generateStories]` or `[refineStories]` logs in console

**GitHub errors:**
- Verify `GITHUB_TOKEN` has `repo` scope
- Check `GITHUB_OWNER` and `GITHUB_REPO` are correct
- Ensure token has access to the repository
- Look for `[createIssues]` or `[updateIssues]` logs in console

**Stories missing acceptance criteria:**
- This was fixed in v0.3.0
- If you're still seeing empty criteria, check console logs for parsing warnings
- Try running `/review-epic` on existing epics to add criteria

**Parser issues:**
- Check console logs for `[parseStories]` output
- Look for "WARNING: No stories parsed!" messages
- The parser handles multiple formats: `## 1. Title`, `**1. Title**`, `1. Title`
- Acceptance criteria work with or without "Acceptance Criteria:" header

## Development

### Modifying Prompts

Edit `prompts.js` to customize:
- `storyGeneration()` - Initial story generation prompt
- `storyRefinement()` - Bulk refinement prompt
- `review()` - Quality review prompt
- `singleStoryRefinement()` - Interactive single-story refinement

### Adding New Commands

1. Add command in Slack app settings
2. Create command handler in `bot.js` using `app.command()`
3. Add to state machine if it requires multi-turn conversation

### Debugging

Enable verbose logging by checking console output for:
- `[generateStories]`, `[refineStories]` - Claude API calls
- `[parseStories]` - Story parsing with line-by-line breakdown
- `[createIssues]`, `[updateIssues]` - GitHub API calls
- `[deleteEpic]` - Epic deletion with detailed steps

### Version History

- **v0.3.0** (2026-01-22): Fixed acceptance criteria parsing in bulk refinement
- **v0.2.1**: Added interactive refinement mode, answer caching
- **v0.2.0**: Added quality review and bulk refinement
- **v0.1.0**: Initial release with basic story generation

## License

MIT
