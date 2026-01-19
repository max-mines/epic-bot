# Epic Bot - Implementation Plan

## Goal

Build a simple Slack bot in an afternoon that helps 3 students create epics and user stories, then push them to GitHub as issues.

**Time Budget:** 3-4 hours coding session

---

## Project Structure

```
epic-bot/
├── .env                 # Secrets (don't commit!)
├── .gitignore
├── package.json
├── bot.js               # Main Slack bot
├── claude.js            # LLM integration
├── github.js            # GitHub issue creation
├── prompts.js           # Prompt templates
└── epics/               # Saved epic JSON files
```

---

## Setup (15 minutes)

### 1. Initialize Project

```bash
mkdir epic-bot
cd epic-bot
npm init -y
npm install @slack/bolt @anthropic-ai/sdk @octokit/rest dotenv
```

### 2. Create `.env`

```bash
# Slack (create app at api.slack.com)
SLACK_BOT_TOKEN=xoxb-your-token
SLACK_SIGNING_SECRET=your-secret
SLACK_APP_TOKEN=xapp-your-token  # for socket mode

# Anthropic
ANTHROPIC_API_KEY=sk-ant-your-key

# GitHub
GITHUB_TOKEN=ghp_your-token
GITHUB_OWNER=your-org
GITHUB_REPO=your-repo
```

### 3. Create `.gitignore`

```
node_modules/
.env
epics/*.json
```

### 4. Set Up Slack App

1. Go to https://api.slack.com/apps
2. Create New App → "From scratch"
3. Add Bot Token Scopes:
   - `commands`
   - `chat:write`
   - `im:write`
4. Create slash command: `/story`
5. Enable Socket Mode (easier than webhooks)
6. Install to workspace
7. Copy tokens to `.env`

---

## Implementation Tasks

### Task 1: Basic Slack Bot (30 minutes)

**File:** `bot.js`

```javascript
require('dotenv').config();
const { App } = require('@slack/bolt');

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
});

// In-memory session storage
const sessions = new Map();

// /story command handler
app.command('/story', async ({ command, ack, say, client }) => {
  await ack();

  const description = command.text;
  const threadTs = command.ts; // This won't work, need to post first

  // Start conversation in thread
  const result = await client.chat.postMessage({
    channel: command.channel_id,
    text: `📝 Creating epic: "${description}"\n\nI'll ask 3 quick questions.`,
  });

  // Store session
  sessions.set(result.ts, {
    state: 'Q1',
    description,
    userId: command.user_id,
    channelId: command.channel_id,
    answers: {}
  });

  // Ask first question
  await client.chat.postMessage({
    channel: command.channel_id,
    thread_ts: result.ts,
    text: 'Q1: Who is this for? (e.g., "students", "instructors and students")'
  });
});

// Listen for thread replies
app.message(async ({ message, client }) => {
  if (!message.thread_ts) return; // Ignore non-thread messages

  const session = sessions.get(message.thread_ts);
  if (!session) return; // Not our conversation

  await handleMessage(session, message.text, message.thread_ts, client);
});

async function handleMessage(session, text, threadTs, client) {
  // State machine for questions
  if (session.state === 'Q1') {
    session.answers.users = text;
    session.state = 'Q2';
    await client.chat.postMessage({
      channel: session.channelId,
      thread_ts: threadTs,
      text: 'Q2: What problem does it solve?'
    });
  } else if (session.state === 'Q2') {
    session.answers.problem = text;
    session.state = 'Q3';
    await client.chat.postMessage({
      channel: session.channelId,
      thread_ts: threadTs,
      text: 'Q3: Tech stack? (e.g., "React, Node, Postgres")'
    });
  } else if (session.state === 'Q3') {
    session.answers.techStack = text;
    session.state = 'GENERATING';

    await client.chat.postMessage({
      channel: session.channelId,
      thread_ts: threadTs,
      text: 'Generating stories...'
    });

    // Call Claude to generate stories
    const { generateStories } = require('./claude');
    const stories = await generateStories(session);
    session.stories = stories;
    session.state = 'APPROVAL';

    // Format and post stories
    const storyText = formatStories(stories);
    await client.chat.postMessage({
      channel: session.channelId,
      thread_ts: threadTs,
      text: `✅ Generated ${stories.length} stories:\n\n${storyText}\n\nLook good? [Y/n]`
    });
  } else if (session.state === 'APPROVAL') {
    if (text.toLowerCase().startsWith('y')) {
      // Save epic and start review
      const epic = saveEpic(session);
      session.state = 'REVIEWING';

      await client.chat.postMessage({
        channel: session.channelId,
        thread_ts: threadTs,
        text: `✅ Epic saved to epics/${epic.id}.json\n\nStarting review in 2 minutes...`
      });

      // Schedule review
      setTimeout(async () => {
        await runReview(epic, threadTs, client, session.channelId);
      }, 2 * 60 * 1000); // 2 minutes

    } else {
      // User wants changes
      session.state = 'REFINING';
      await client.chat.postMessage({
        channel: session.channelId,
        thread_ts: threadTs,
        text: 'What would you like to change?'
      });
    }
  } else if (session.state === 'REFINING') {
    // Re-generate with feedback
    session.feedback = text;
    session.state = 'GENERATING';

    await client.chat.postMessage({
      channel: session.channelId,
      thread_ts: threadTs,
      text: 'Regenerating stories...'
    });

    const { refineStories } = require('./claude');
    const stories = await refineStories(session);
    session.stories = stories;
    session.state = 'APPROVAL';

    const storyText = formatStories(stories);
    await client.chat.postMessage({
      channel: session.channelId,
      thread_ts: threadTs,
      text: `✅ Updated stories:\n\n${storyText}\n\nLook good? [Y/n]`
    });
  } else if (session.state === 'REVIEW_APPROVAL') {
    if (text.toLowerCase().startsWith('y')) {
      // Create GitHub issues
      const { createIssues } = require('./github');
      const issues = await createIssues(session.epic);

      const issueList = issues.map(i => `- #${i.number}: ${i.title}`).join('\n');
      await client.chat.postMessage({
        channel: session.channelId,
        thread_ts: threadTs,
        text: `✅ Created ${issues.length} issues:\n${issueList}\n\nDone! 🎉`
      });

      sessions.delete(threadTs);
    } else {
      // User wants more changes
      await client.chat.postMessage({
        channel: session.channelId,
        thread_ts: threadTs,
        text: 'What should I fix?'
      });
      session.state = 'REFINING';
    }
  }
}

function formatStories(stories) {
  return stories.map((s, i) => {
    const criteria = s.acceptance_criteria.map(c => `   - ${c}`).join('\n');
    return `${i + 1}. ${s.title}\n   ${s.story}\n${criteria}`;
  }).join('\n\n');
}

function saveEpic(session) {
  const fs = require('fs');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const epic = {
    id: `epic-${timestamp}`,
    title: session.description,
    created_by: session.userId,
    created_at: new Date().toISOString(),
    users: session.answers.users,
    problem: session.answers.problem,
    tech_stack: session.answers.techStack,
    stories: session.stories
  };

  if (!fs.existsSync('./epics')) {
    fs.mkdirSync('./epics');
  }

  fs.writeFileSync(
    `./epics/${epic.id}.json`,
    JSON.stringify(epic, null, 2)
  );

  session.epic = epic;
  return epic;
}

async function runReview(epic, threadTs, client, channelId) {
  const { reviewEpic } = require('./claude');
  const review = await reviewEpic(epic);

  await client.chat.postMessage({
    channel: channelId,
    thread_ts: threadTs,
    text: `🔍 Review complete!\n\n${review}\n\nCreate GitHub issues? [Y/n]`
  });

  const session = sessions.get(threadTs);
  if (session) {
    session.state = 'REVIEW_APPROVAL';
  }
}

(async () => {
  await app.start();
  console.log('⚡️ Epic Bot is running!');
})();
```

**Test it:**
```bash
node bot.js
```

Try `/story Build a dashboard` in Slack.

---

### Task 2: Claude Integration (45 minutes)

**File:** `claude.js`

```javascript
const Anthropic = require('@anthropic-ai/sdk');
const prompts = require('./prompts');

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function generateStories(session) {
  const prompt = prompts.storyGeneration(session);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: prompt
    }]
  });

  const text = response.content[0].text;
  return parseStories(text);
}

async function refineStories(session) {
  const prompt = prompts.storyRefinement(session);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: prompt
    }]
  });

  const text = response.content[0].text;
  return parseStories(text);
}

async function reviewEpic(epic) {
  const prompt = prompts.review(epic);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: prompt
    }]
  });

  return response.content[0].text;
}

function parseStories(text) {
  // Simple parsing - look for numbered stories
  const stories = [];
  const lines = text.split('\n');

  let currentStory = null;
  let inAcceptanceCriteria = false;

  for (let line of lines) {
    // Match story number: "1. Title" or "**1. Title**"
    const titleMatch = line.match(/^\*?\*?(\d+)\.\s*\*?\*?(.+)/);
    if (titleMatch) {
      if (currentStory) {
        stories.push(currentStory);
      }
      currentStory = {
        id: `story-${String(titleMatch[1]).padStart(3, '0')}`,
        title: titleMatch[2].replace(/\*\*/g, '').trim(),
        story: '',
        acceptance_criteria: []
      };
      inAcceptanceCriteria = false;
      continue;
    }

    // Match "As a..." pattern
    if (line.trim().startsWith('As a') || line.trim().startsWith('As an')) {
      if (currentStory) {
        currentStory.story = line.trim();
      }
      continue;
    }

    // Match acceptance criteria
    if (line.includes('Acceptance') || line.includes('acceptance')) {
      inAcceptanceCriteria = true;
      continue;
    }

    // Match criteria items: "- [ ] ..." or just "- ..."
    if (inAcceptanceCriteria && currentStory) {
      const criteriaMatch = line.match(/^\s*-\s*(?:\[\s*\]\s*)?(.+)/);
      if (criteriaMatch) {
        currentStory.acceptance_criteria.push(criteriaMatch[1].trim());
      }
    }
  }

  if (currentStory) {
    stories.push(currentStory);
  }

  return stories;
}

module.exports = { generateStories, refineStories, reviewEpic };
```

**File:** `prompts.js`

```javascript
function storyGeneration(session) {
  return `You are helping students create user stories for their project.

Epic: ${session.description}
Users: ${session.answers.users}
Problem: ${session.answers.problem}
Tech Stack: ${session.answers.techStack}

Generate 4-6 user stories that break down this epic.

Format each story exactly like this:
1. [Title]
   As a [user], I want to [action] so that [benefit]
   - [acceptance criterion 1]
   - [acceptance criterion 2]
   - [acceptance criterion 3]

2. [Next story...]

Keep stories small (3-5 acceptance criteria each). Make acceptance criteria specific and testable.`;
}

function storyRefinement(session) {
  const existingStories = session.stories.map((s, i) =>
    `${i + 1}. ${s.title}\n   ${s.story}`
  ).join('\n');

  return `You previously generated these stories:

${existingStories}

The user wants changes: "${session.feedback}"

Generate the updated list of stories in the same format:
1. [Title]
   As a [user], I want to [action] so that [benefit]
   - [acceptance criterion 1]
   - [acceptance criterion 2]
   - [acceptance criterion 3]`;
}

function review(epic) {
  return `Review this epic for quality. Keep feedback brief and actionable.

Epic: ${JSON.stringify(epic, null, 2)}

Check:
1. Are stories small enough? (3-5 acceptance criteria)
2. Do stories have clear user value? ("so that" clause)
3. Are there obvious missing stories? (error handling, edge cases)
4. Are acceptance criteria specific and testable?

Format your response as:
✅ Good:
- [what's good]

⚠️ Issues:
- [issue 1]
- [issue 2]

Keep it under 10 lines total.`;
}

module.exports = { storyGeneration, storyRefinement, review };
```

**Test it:**
The bot should now generate stories with Claude!

---

### Task 3: GitHub Integration (30 minutes)

**File:** `github.js`

```javascript
const { Octokit } = require('@octokit/rest');

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN
});

const owner = process.env.GITHUB_OWNER;
const repo = process.env.GITHUB_REPO;

async function createIssues(epic) {
  const issues = [];

  for (const story of epic.stories) {
    const body = formatIssueBody(story, epic);

    const response = await octokit.issues.create({
      owner,
      repo,
      title: `${story.id}: ${story.title}`,
      body,
      labels: ['user-story', 'epic-bot']
    });

    issues.push({
      number: response.data.number,
      title: story.title,
      url: response.data.html_url
    });
  }

  return issues;
}

function formatIssueBody(story, epic) {
  const criteria = story.acceptance_criteria
    .map(c => `- [ ] ${c}`)
    .join('\n');

  return `${story.story}

## Acceptance Criteria
${criteria}

---
Part of epic: ${epic.id}`;
}

module.exports = { createIssues };
```

**Test it:**
Make sure GitHub token has `repo` scope and test with a real repo.

---

### Task 4: Polish & Error Handling (30 minutes)

Add to `bot.js`:

```javascript
// Add error handling wrapper
async function safeHandler(fn, ...args) {
  try {
    await fn(...args);
  } catch (error) {
    console.error('Error:', error);
    const client = args[args.length - 2]; // Hacky but works
    const channelId = args[args.length - 1];

    if (client && channelId) {
      await client.chat.postMessage({
        channel: channelId,
        text: `❌ Error: ${error.message}`
      });
    }
  }
}

// Wrap handlers
app.command('/story', async (args) => {
  await safeHandler(handleStoryCommand, args);
});

app.message(async (args) => {
  await safeHandler(handleMessageEvent, args);
});
```

Add session timeout:

```javascript
// Clean up old sessions after 1 hour
setInterval(() => {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [key, session] of sessions.entries()) {
    if (session.lastActivity < oneHourAgo) {
      sessions.delete(key);
    }
  }
}, 10 * 60 * 1000); // Check every 10 minutes
```

---

## Testing Checklist

- [ ] `/story` command creates thread
- [ ] Bot asks 3 questions
- [ ] Claude generates stories
- [ ] User can approve with "Y"
- [ ] Epic saves to `./epics/`
- [ ] Review runs after 2 minutes
- [ ] User can request changes
- [ ] GitHub issues are created
- [ ] Labels are applied
- [ ] Error messages are clear

---

## Deployment Options

### Option 1: Run Locally
```bash
node bot.js
# Keep terminal open
```

### Option 2: Run on Server
```bash
# On a VPS or EC2 instance
npm install pm2 -g
pm2 start bot.js --name epic-bot
pm2 save
pm2 startup
```

### Option 3: Docker
```dockerfile
FROM node:18
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
CMD ["node", "bot.js"]
```

```bash
docker build -t epic-bot .
docker run -d --env-file .env epic-bot
```

---

## Usage Instructions (for students)

Share this with your 3 students:

```
How to use Epic Bot:

1. Type: /story [your feature idea]
   Example: /story Build a user profile page

2. Answer 3 questions:
   - Who is this for?
   - What problem does it solve?
   - What's your tech stack?

3. Review the generated stories
   - Type "Y" to approve
   - Or describe changes you want

4. Wait 2 minutes for design review

5. Approve to create GitHub issues
   - Type "Y" to create issues
   - Or request more changes

That's it! Your stories are now GitHub issues ready for development.
```

---

## Troubleshooting

**Bot doesn't respond to /story:**
- Check Socket Mode is enabled
- Check app token is correct
- Check bot has `commands` scope

**Claude errors:**
- Check API key is valid
- Check you have credits
- Check model name is correct

**GitHub errors:**
- Check token has `repo` scope
- Check owner/repo are correct
- Check repo exists and token has access

**Stories parse incorrectly:**
- Check Claude's response format
- Adjust parsing logic in `parseStories()`
- Add more robust regex patterns

---

## Time Breakdown

- Setup (15 min)
- Task 1: Basic bot (30 min)
- Task 2: Claude integration (45 min)
- Task 3: GitHub integration (30 min)
- Task 4: Polish (30 min)
- Testing (30 min)

**Total: ~3 hours**

---

## Next Steps

After the bot works:
1. Use it to create your first epic
2. Have students try it
3. Iterate on prompts based on story quality
4. Add more features if needed (see DESIGN_SPEC.md Future Ideas)

Good luck! 🚀
