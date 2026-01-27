# Epic Bot

A lightweight Slack bot that helps students create well-structured epics and user stories, then pushes them to GitHub as issues.

## Why Epic Bot?

Writing good user stories is hard. It takes time to break down large ideas into small, actionable chunks. Epic Bot streamlines this process by:

-   **Guiding the process:** The bot asks simple questions to help you think through the problem you're solving.
-   **Automating the tedious parts:** It generates user stories and acceptance criteria for you, so you can focus on the core functionality.
-   **Providing a fresh perspective:** The AI-powered review helps you catch missing edge cases and improve the quality of your stories.
-   **Integrating with your workflow:** By creating GitHub issues directly from Slack, it fits seamlessly into your development process.

## Features

-   **Interactive Epic Creation**: Answer 3 simple questions to generate 4-6 user stories with AI assistance
-   **Repository Context Awareness**: Automatically fetches your GitHub README to ensure stories align with existing project structure
-   **AI Quality Review**: Get actionable feedback on story quality, size, and completeness
-   **Bulk Refinement**: Address multiple review issues at once (e.g., "add acceptance criteria to all stories")
-   **Interactive Story Editor**: Navigate between stories and refine them individually with natural language
-   **GitHub Integration**: Automatically creates linked epic and story issues with proper formatting
-   **Answer Caching**: Type `same` to reuse previous answers for faster epic creation
-   **Epic Management**: Review existing epics, update GitHub issues, or delete entire epics

## Quick Start

### Prerequisites

-   [Node.js](https://nodejs.org/) (v14 or higher)
-   [npm](https://www.npmjs.com/)

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up Slack App

1.  Go to https://api.slack.com/apps
2.  Click "Create New App" → "From scratch"
3.  Name it "Epic Bot" and select your workspace
4.  Navigate to "OAuth & Permissions" and add these Bot Token Scopes:
    -   `commands`
    -   `chat:write`
    -   `im:write`
    -   `channels:history`
    -   `groups:history`
    -   `im:history`
    -   `mpim:history`
5.  Navigate to "Slash Commands" and create these commands:
    -   `/story` - Description: "Create an epic with user stories"
    -   `/review-epic` - Description: "Review an existing epic from saved file (provide epic ID)"
    -   `/delete-epic` - Description: "Delete an epic and its stories (provide issue number)"
6.  Navigate to "Socket Mode" and enable it
    -   Generate an App-Level Token with `connections:write` scope
7.  Navigate to "Event Subscriptions" and enable events
    -   Subscribe to bot events: `message.channels`, `message.im`, `message.groups`, `message.mpim`
8.  Install the app to your workspace
9.  Copy the tokens (you'll need them for `.env`)

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

1.  **Start the epic** in Slack:
    `/story Build a student dashboard`

2.  **Answer 3 questions** (or type `same` to reuse your previous answers):
    -   Q1: Who is this for? (e.g., "students", "instructors")
    -   Q2: What problem does it solve?
    -   Q3: Tech stack? (e.g., "React, Node, Postgres")

3.  **AI generates 4-6 stories** with acceptance criteria:
    -   Automatically fetches your repo's README.md for context
    -   Stories align with your existing project structure
    -   Each story includes 1-2 suggested acceptance criteria

4.  **Review and refine** (choose one):
    -   `review` - Run AI quality review (recommended for first-time epics)
    -   `refine` - Interactively edit individual stories
    -   `Y` - Create GitHub issues immediately (skip review)

5.  **Address review issues** (if you chose review):
    ```
    Bot: ⚠️ Issues:
         1. Stories lack acceptance criteria
         2. Missing error handling stories
         3. Stories too large, should be split

         Type `all` to address all issues, or `1, 2` for specific ones

    You: all
    ```
    -   Bot refines all stories to address the issues
    -   Acceptance criteria are automatically added/improved

6.  **Finalize**:
    -   Type `Y` to create GitHub issues
    -   Type `refine` to make manual adjustments before publishing

Done! Your epic and stories are now GitHub issues with:

-   Epic issue linking to all story issues
-   Story issues linking back to the epic
-   Acceptance criteria as checkboxes
-   Proper labels (`epic`, `user-story`, `epic-bot`)

### Example Conversation

```
You: /story Build a student dashboard

Bot: 📝 Creating epic: "Build a student dashboard"

     I'll ask 3 quick questions.

     Q1: Who is this for? (e.g., "students", "instructors and students")

You: students

Bot: Q2: What problem does it solve?

You: Students need a single place to see all their assignments and due dates.

Bot: Q3: Tech stack? (e.g., "React, Node, Postgres")

You: React, Node, and Postgres

Bot: Generating stories...

Bot: ✅ Generated 4 stories:

     1. View Assignments
        As a student, I want to see a list of all my assignments,
        so that I can track my upcoming work.
        Acceptance Criteria:
        - Display assignment title
        - Display assignment due date
        - Sort assignments by due date

     ... (3 more stories) ...

     What's next?

     Type `review` to run quality review, `refine` for interactive refinement, or `Y` to create GitHub issues.
```

## How It Works

### Story Generation Flow

1.  **Context Collection**: Bot asks 3 questions and fetches README.md
2.  **AI Generation**: Claude 3 Sonnet generates stories using prompt templates
3.  **Parsing**: Response is parsed into structured story objects with:
    -   Story ID (e.g., `story-001`)
    -   Title
    -   User story ("As a... I want... so that...")
    -   Acceptance criteria array

### Review and Refinement

-   **Review**: Claude analyzes all stories for quality issues
-   **Bulk Refinement**: Claude addresses selected issues across all stories
-   **Interactive Refinement**: Users edit individual stories with natural language
-   **Parsing Flexibility**: Parser handles multiple formats (with/without headers)

### GitHub Integration

1.  **Story Issues Created**: Each story becomes an issue with checkboxes for acceptance criteria
2.  **Epic Issue Created**: Links to all story issues using `#123` syntax
3.  **Story Issues Updated**: Epic link added to each story (`Part of epic #42`)
4.  **JSON Updated**: GitHub issue numbers saved to epic JSON for future updates

### State Machine

The bot uses a conversation state machine with these states:

-   `Q1`, `Q2`, `Q3`: Question flow
-   `GENERATING`: Calling Claude API
-   `APPROVAL`: After generation, before review
-   `REVIEWING`: Running quality review
-   `REVIEW_APPROVAL`: After review, can address issues
-   `REFINING`: Bulk refinement in progress
-   `INTERACTIVE_MODE`: Story selection menu
-   `STORY_FOCUSED`: Editing a specific story
-   `DELETE_CONFIRMATION`: Confirming epic deletion

## Project Structure

```
epic-bot/
├── DESIGN_SPEC.md   # Project design document
├── bot.js           # Main Slack bot logic and state machine
├── claude.js        # Claude API integration and response parsing
├── github.js        # GitHub issue creation/update/deletion
├── prompts.js       # Prompt templates for generation, review, refinement
├── package.json     # Dependencies (@slack/bolt, @anthropic-ai/sdk, @octokit/rest)
├── .env.example     # Example environment variables
└── epics/           # Saved epic JSON files with GitHub issue numbers
```

## Roadmap

Here are some features we're planning to add:

-   [ ] `/list-epics` command to show all epics created by a user
-   [ ] `/edit-epic` command to modify existing epics
-   [ ] Prettier formatting for Slack messages using Block Kit
-   [ ] Persistence for sessions to handle bot restarts

## Contributing

Contributions are welcome! Please feel free to open an issue or submit a pull request.

1.  Fork the repository
2.  Create your feature branch (`git checkout -b feature/AmazingFeature`)
3.  Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4.  Push to the branch (`git push origin feature/AmazingFeature`)
5.  Open a pull request

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