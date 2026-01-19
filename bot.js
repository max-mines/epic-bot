require('dotenv').config();
const { App } = require('@slack/bolt');
const fs = require('fs');

const VERSION = 'v0.2';

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
});

// In-memory session storage
const sessions = new Map();

// /story command handler
app.command('/story', async ({ command, ack, client }) => {
  await ack();

  const description = command.text;

  if (!description) {
    await client.chat.postEphemeral({
      channel: command.channel_id,
      user: command.user_id,
      text: 'Please provide a description: `/story Build a student dashboard`'
    });
    return;
  }

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
    answers: {},
    lastActivity: Date.now()
  });

  // Ask first question
  await client.chat.postMessage({
    channel: command.channel_id,
    thread_ts: result.ts,
    text: 'Q1: Who is this for? (e.g., "students", "instructors and students")'
  });
});

// /delete-epic command handler
app.command('/delete-epic', async ({ command, ack, client }) => {
  await ack();

  const epicNumber = command.text.trim();

  if (!epicNumber || isNaN(epicNumber)) {
    await client.chat.postEphemeral({
      channel: command.channel_id,
      user: command.user_id,
      text: 'Please provide an epic issue number: `/delete-epic 42`'
    });
    return;
  }

  try {
    // Fetch epic details first
    const { Octokit } = require('@octokit/rest');
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

    const epicIssue = await octokit.issues.get({
      owner: process.env.GITHUB_OWNER,
      repo: process.env.GITHUB_REPO,
      issue_number: parseInt(epicNumber)
    });

    // Find all related story issues
    const searchQuery = `repo:${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO} is:issue label:user-story,epic-bot "Part of epic #${epicNumber}"`;
    const searchResults = await octokit.search.issuesAndPullRequests({
      q: searchQuery
    });

    const storyIssues = searchResults.data.items;
    const storyList = storyIssues.map(s => `- #${s.number}: ${s.title}`).join('\n');

    // Post confirmation message in a thread
    const result = await client.chat.postMessage({
      channel: command.channel_id,
      text: `⚠️ Confirm deletion of epic #${epicNumber}: ${epicIssue.data.title}\n\n**Stories to be closed (${storyIssues.length}):**\n${storyList || '(none)'}\n\nType \`Y\` to confirm deletion, or anything else to cancel.`
    });

    // Store deletion session
    sessions.set(result.ts, {
      state: 'DELETE_CONFIRMATION',
      epicNumber: parseInt(epicNumber),
      epicTitle: epicIssue.data.title,
      storyCount: storyIssues.length,
      userId: command.user_id,
      channelId: command.channel_id,
      lastActivity: Date.now()
    });

  } catch (error) {
    console.error('Error fetching epic:', error);
    await client.chat.postEphemeral({
      channel: command.channel_id,
      user: command.user_id,
      text: `❌ Error fetching epic #${epicNumber}: ${error.message}`
    });
  }
});

// Listen for thread replies
app.message(async ({ message, client }) => {
  console.log('Received message:', {
    text: message.text,
    thread_ts: message.thread_ts,
    bot_id: message.bot_id,
    has_session: !!sessions.get(message.thread_ts)
  });

  if (!message.thread_ts) return; // Ignore non-thread messages
  if (message.bot_id) return; // Ignore bot messages

  const session = sessions.get(message.thread_ts);
  if (!session) {
    console.log('No session found for thread:', message.thread_ts);
    return; // Not our conversation
  }

  console.log('Processing message in state:', session.state);
  session.lastActivity = Date.now();
  await handleMessage(session, message.text, message.thread_ts, client);
});

async function handleMessage(session, text, threadTs, client) {
  try {
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
          text: `✅ Epic saved to epics/${epic.id}.json\n\nRunning review...`
        });

        // Run review immediately
        await runReview(epic, threadTs, client, session.channelId);

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
        await client.chat.postMessage({
          channel: session.channelId,
          thread_ts: threadTs,
          text: 'Creating GitHub issues...'
        });

        const { createIssues } = require('./github');
        const result = await createIssues(session.epic);

        const storyList = result.stories.map(i => `- #${i.number}: ${i.title}`).join('\n');
        await client.chat.postMessage({
          channel: session.channelId,
          thread_ts: threadTs,
          text: `✅ Created epic #${result.epic.number}: ${result.epic.title}\n\nStories:\n${storyList}\n\nDone! 🎉`
        });

        sessions.delete(threadTs);
      } else {
        // User wants more changes - back to refining
        session.state = 'REFINING';
        session.refinementCount = (session.refinementCount || 0) + 1;

        if (session.refinementCount >= 2) {
          await client.chat.postMessage({
            channel: session.channelId,
            thread_ts: threadTs,
            text: 'Maximum refinements reached. Proceeding with current stories...'
          });
          session.state = 'REVIEW_APPROVAL';
          // Re-trigger approval
          await handleMessage(session, 'Y', threadTs, client);
        } else {
          await client.chat.postMessage({
            channel: session.channelId,
            thread_ts: threadTs,
            text: 'What should I fix?'
          });
        }
      }
    } else if (session.state === 'DELETE_CONFIRMATION') {
      if (text.toLowerCase().startsWith('y')) {
        // User confirmed deletion
        await client.chat.postMessage({
          channel: session.channelId,
          thread_ts: threadTs,
          text: `Deleting epic #${session.epicNumber}...`
        });

        const { deleteEpic } = require('./github');
        const result = await deleteEpic(session.epicNumber);

        // Also delete local epic file if it exists
        const fs = require('fs');
        if (fs.existsSync('./epics')) {
          const epicFiles = fs.readdirSync('./epics').filter(f => f.endsWith('.json'));
          for (const file of epicFiles) {
            const epicData = JSON.parse(fs.readFileSync(`./epics/${file}`, 'utf8'));
            if (session.epicTitle.includes(epicData.id)) {
              fs.unlinkSync(`./epics/${file}`);
              break;
            }
          }
        }

        await client.chat.postMessage({
          channel: session.channelId,
          thread_ts: threadTs,
          text: `✅ Deleted epic #${session.epicNumber} and closed ${result.storiesClosed} story issues.`
        });

        sessions.delete(threadTs);
      } else {
        // User cancelled deletion
        await client.chat.postMessage({
          channel: session.channelId,
          thread_ts: threadTs,
          text: '❌ Deletion cancelled.'
        });

        sessions.delete(threadTs);
      }
    }
  } catch (error) {
    console.error('Error in handleMessage:', error);
    await client.chat.postMessage({
      channel: session.channelId,
      thread_ts: threadTs,
      text: `❌ Error: ${error.message}`
    });
  }
}

function formatStories(stories) {
  return stories.map((s, i) => {
    const criteria = s.acceptance_criteria.map(c => `   - ${c}`).join('\n');
    return `${i + 1}. ${s.title}\n   ${s.story}\n${criteria}`;
  }).join('\n\n');
}

function saveEpic(session) {
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
  try {
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
  } catch (error) {
    console.error('Error in runReview:', error);
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: `❌ Review error: ${error.message}\n\nCreate GitHub issues anyway? [Y/n]`
    });

    const session = sessions.get(threadTs);
    if (session) {
      session.state = 'REVIEW_APPROVAL';
    }
  }
}

// Clean up old sessions after 1 hour
setInterval(() => {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [key, session] of sessions.entries()) {
    if (session.lastActivity < oneHourAgo) {
      console.log(`Cleaning up stale session: ${key}`);
      sessions.delete(key);
    }
  }
}, 10 * 60 * 1000); // Check every 10 minutes

(async () => {
  await app.start();
  console.log(`⚡️ Epic Bot ${VERSION} is running!`);
})();
