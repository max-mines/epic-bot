require('dotenv').config();
const { App } = require('@slack/bolt');
const fs = require('fs');

const VERSION = 'v0.2.1';

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
});

// In-memory session storage
// TODO: Consider persisting sessions to handle bot restarts
const sessions = new Map();

// Cache for previous answers (per user)
const answerCache = new Map();

// /story command handler
// TODO: Add /list-epics command to show all epics for a user
// TODO: Add /edit-epic command to modify existing epics
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

  // Check if user has cached answers
  const cached = answerCache.get(command.user_id);

  // Ask first question
  if (cached && cached.users) {
    await client.chat.postMessage({
      channel: command.channel_id,
      thread_ts: result.ts,
      text: `Q1: Who is this for?\n\nPrevious answer: "${cached.users}"\n\nType \`same\` to reuse, or provide a new answer.`
    });
  } else {
    await client.chat.postMessage({
      channel: command.channel_id,
      thread_ts: result.ts,
      text: 'Q1: Who is this for? (e.g., "students", "instructors and students")'
    });
  }
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

    // Post confirmation message
    const result = await client.chat.postMessage({
      channel: command.channel_id,
      text: `⚠️ Confirm deletion of epic #${epicNumber}: ${epicIssue.data.title}\n\n**Stories to be closed (${storyIssues.length}):**\n${storyList || '(none)'}\n\n⚠️ **Reply to this message** with \`Y\` to confirm deletion, or anything else to cancel.`
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

// /review-epic command handler
app.command('/review-epic', async ({ command, ack, client }) => {
  await ack();

  const epicId = command.text.trim();

  if (!epicId) {
    await client.chat.postEphemeral({
      channel: command.channel_id,
      user: command.user_id,
      text: 'Please provide an epic ID: `/review-epic epic-2026-01-20T03-22-56`\n\nYou can find epic IDs in the `epics/` folder.'
    });
    return;
  }

  try {
    // Load epic from JSON file
    const epicPath = `./epics/${epicId}.json`;

    if (!fs.existsSync(epicPath)) {
      await client.chat.postEphemeral({
        channel: command.channel_id,
        user: command.user_id,
        text: `❌ Epic file not found: ${epicPath}\n\nMake sure the epic ID is correct.`
      });
      return;
    }

    const epicData = JSON.parse(fs.readFileSync(epicPath, 'utf-8'));

    // Create a new thread for the review
    const result = await client.chat.postMessage({
      channel: command.channel_id,
      text: `📝 Reviewing epic: "${epicData.title}"\n\nRunning review...`
    });

    // Create session with loaded epic data
    const session = {
      state: 'REVIEWING',
      description: epicData.title,
      userId: command.user_id,
      channelId: command.channel_id,
      answers: {
        users: epicData.users,
        problem: epicData.problem,
        techStack: epicData.tech_stack
      },
      stories: epicData.stories,
      epic: epicData,
      isExistingEpic: true, // Flag to prevent duplicate GitHub issue creation
      lastActivity: Date.now()
    };

    sessions.set(result.ts, session);

    // Run review
    await runReview(epicData, result.ts, client, command.channel_id);

  } catch (error) {
    console.error('Error loading epic:', error);
    await client.chat.postEphemeral({
      channel: command.channel_id,
      user: command.user_id,
      text: `❌ Error loading epic: ${error.message}`
    });
  }
});

// Listen for thread replies
app.message(async ({ message, client }) => {
  console.log('Received message:', {
    text: message.text,
    thread_ts: message.thread_ts,
    ts: message.ts,
    bot_id: message.bot_id,
    has_session: !!sessions.get(message.thread_ts)
  });

  if (message.bot_id) return; // Ignore bot messages

  // Check for session - either in thread or as a reply to the original message
  const threadTs = message.thread_ts || message.ts;
  if (!message.thread_ts && !sessions.get(message.ts)) {
    return; // Ignore non-thread messages that aren't part of a session
  }

  const session = sessions.get(threadTs);
  if (!session) {
    console.log('No session found for thread:', threadTs);
    return; // Not our conversation
  }

  console.log('Processing message in state:', session.state);
  session.lastActivity = Date.now();
  await handleMessage(session, message.text, threadTs, client);
});

async function showStoryMenu(session, threadTs, client) {
  const storyList = session.stories.map((s, i) =>
    `${i + 1}. ${s.title}`
  ).join('\n');

  let doneText;
  if (session.isExistingEpic) {
    doneText = '• Type "done" to save changes and exit';
  } else if (session.hasBeenReviewed) {
    doneText = '• Type "done" to create GitHub issues';
  } else {
    doneText = '• Type "done" to finish refining';
  }

  await client.chat.postMessage({
    channel: session.channelId,
    thread_ts: threadTs,
    text: `📝 Interactive Refinement Mode\n\nSelect a story to refine:\n${storyList}\n\n💡 Commands:\n• Type story number (e.g., "1" or "3")\n• Type "overview" to see all stories\n${doneText}`
  });
}

async function handleInteractiveCommand(session, text, threadTs, client) {
  const trimmed = text.trim().toLowerCase();

  // Check if user wants to exit
  if (trimmed === 'done') {
    // Check if this is an existing epic (loaded via /review-epic)
    if (session.isExistingEpic) {
      // Save the updated epic and exit - don't create new GitHub issues
      await client.chat.postMessage({
        channel: session.channelId,
        thread_ts: threadTs,
        text: `✅ Epic updated and saved to epics/${session.epic.id}.json\n\n💡 This epic was loaded from an existing file. If you want to update GitHub issues, use \`/delete-epic\` to close the old issues, then create a new epic with \`/story\`.`
      });
      sessions.delete(threadTs);
      return;
    }

    // Check if we've already reviewed (for new epics)
    if (session.hasBeenReviewed) {
      // Already reviewed, go straight to GitHub
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
      // Not reviewed yet, offer review option
      session.state = 'APPROVAL';
      await client.chat.postMessage({
        channel: session.channelId,
        thread_ts: threadTs,
        text: `✅ Stories refined. What's next?\n\nType \`review\` to run quality review, or \`Y\` to create GitHub issues immediately.`
      });
    }
    return;
  }

  // Check if user wants overview
  if (trimmed === 'overview') {
    const storyText = formatStories(session.stories);
    await client.chat.postMessage({
      channel: session.channelId,
      thread_ts: threadTs,
      text: `📋 All Stories:\n\n${storyText}`
    });
    await showStoryMenu(session, threadTs, client);
    return;
  }

  // Check if user selected a story number
  const storyNum = parseInt(trimmed);
  if (!isNaN(storyNum) && storyNum >= 1 && storyNum <= session.stories.length) {
    const storyIndex = storyNum - 1;
    session.currentStoryIndex = storyIndex;
    session.state = 'STORY_FOCUSED';

    const story = session.stories[storyIndex];
    const criteria = story.acceptance_criteria.map(c => `   - ${c}`).join('\n');

    await client.chat.postMessage({
      channel: session.channelId,
      thread_ts: threadTs,
      text: `🔍 Story #${storyNum}: ${story.title}\n\n   ${story.story}\n\nAcceptance Criteria:\n${criteria}\n\n💡 What would you like to change?\n\nCommands: "next" | "prev" | "back" | or describe changes`
    });
    return;
  }

  // Invalid command
  await client.chat.postMessage({
    channel: session.channelId,
    thread_ts: threadTs,
    text: `❌ Invalid command. Please type a story number (1-${session.stories.length}), "overview", or "done".`
  });
}

async function handleStoryFocused(session, text, threadTs, client) {
  const trimmed = text.trim().toLowerCase();

  // Navigation commands
  if (trimmed === 'next') {
    if (session.currentStoryIndex < session.stories.length - 1) {
      session.currentStoryIndex++;
      const storyNum = session.currentStoryIndex + 1;
      const story = session.stories[session.currentStoryIndex];
      const criteria = story.acceptance_criteria.map(c => `   - ${c}`).join('\n');

      await client.chat.postMessage({
        channel: session.channelId,
        thread_ts: threadTs,
        text: `🔍 Story #${storyNum}: ${story.title}\n\n   ${story.story}\n\nAcceptance Criteria:\n${criteria}\n\n💡 What would you like to change?\n\nCommands: "next" | "prev" | "back" | or describe changes`
      });
    } else {
      await client.chat.postMessage({
        channel: session.channelId,
        thread_ts: threadTs,
        text: '❌ Already at the last story. Type "back" to return to menu or "done" to create GitHub issues.'
      });
    }
    return;
  }

  if (trimmed === 'prev') {
    if (session.currentStoryIndex > 0) {
      session.currentStoryIndex--;
      const storyNum = session.currentStoryIndex + 1;
      const story = session.stories[session.currentStoryIndex];
      const criteria = story.acceptance_criteria.map(c => `   - ${c}`).join('\n');

      await client.chat.postMessage({
        channel: session.channelId,
        thread_ts: threadTs,
        text: `🔍 Story #${storyNum}: ${story.title}\n\n   ${story.story}\n\nAcceptance Criteria:\n${criteria}\n\n💡 What would you like to change?\n\nCommands: "next" | "prev" | "back" | or describe changes`
      });
    } else {
      await client.chat.postMessage({
        channel: session.channelId,
        thread_ts: threadTs,
        text: '❌ Already at the first story. Type "back" to return to menu or continue refining.'
      });
    }
    return;
  }

  if (trimmed === 'back') {
    session.state = 'INTERACTIVE_MODE';
    await showStoryMenu(session, threadTs, client);
    return;
  }

  // User is making a refinement request
  await client.chat.postMessage({
    channel: session.channelId,
    thread_ts: threadTs,
    text: 'Refining story...'
  });

  const { refineSingleStory } = require('./claude');
  const currentStory = session.stories[session.currentStoryIndex];
  const epicContext = {
    description: session.description,
    users: session.answers.users,
    problem: session.answers.problem,
    techStack: session.answers.techStack
  };

  const updatedStory = await refineSingleStory(currentStory, text, epicContext);

  // Preserve the story ID
  updatedStory.id = currentStory.id;

  // Update the story in the session
  session.stories[session.currentStoryIndex] = updatedStory;

  // Update the epic file
  if (session.epic) {
    session.epic.stories = session.stories;
    const fs = require('fs');
    fs.writeFileSync(
      `./epics/${session.epic.id}.json`,
      JSON.stringify(session.epic, null, 2)
    );
  }

  const storyNum = session.currentStoryIndex + 1;
  const criteria = updatedStory.acceptance_criteria.map(c => `   - ${c}`).join('\n');

  await client.chat.postMessage({
    channel: session.channelId,
    thread_ts: threadTs,
    text: `✅ Updated Story #${storyNum}: ${updatedStory.title}\n\n   ${updatedStory.story}\n\nAcceptance Criteria:\n${criteria}\n\n💡 Anything else?\n\nCommands: "next" | "prev" | "back" | or describe more changes`
  });
}

async function handleMessage(session, text, threadTs, client) {
  try {
    // State machine for questions
    if (session.state === 'Q1') {
      const cached = answerCache.get(session.userId);

      // Handle "same" to reuse cached answer
      if (text.trim().toLowerCase() === 'same' && cached && cached.users) {
        session.answers.users = cached.users;
      } else {
        session.answers.users = text;
      }

      session.state = 'Q2';

      // Check for cached Q2 answer
      if (cached && cached.problem) {
        await client.chat.postMessage({
          channel: session.channelId,
          thread_ts: threadTs,
          text: `Q2: What problem does it solve?\n\nPrevious answer: "${cached.problem}"\n\nType \`same\` to reuse, or provide a new answer.`
        });
      } else {
        await client.chat.postMessage({
          channel: session.channelId,
          thread_ts: threadTs,
          text: 'Q2: What problem does it solve?'
        });
      }
    } else if (session.state === 'Q2') {
      const cached = answerCache.get(session.userId);

      // Handle "same" to reuse cached answer
      if (text.trim().toLowerCase() === 'same' && cached && cached.problem) {
        session.answers.problem = cached.problem;
      } else {
        session.answers.problem = text;
      }

      session.state = 'Q3';

      // Check for cached Q3 answer
      if (cached && cached.techStack) {
        await client.chat.postMessage({
          channel: session.channelId,
          thread_ts: threadTs,
          text: `Q3: Tech stack?\n\nPrevious answer: "${cached.techStack}"\n\nType \`same\` to reuse, or provide a new answer.`
        });
      } else {
        await client.chat.postMessage({
          channel: session.channelId,
          thread_ts: threadTs,
          text: 'Q3: Tech stack? (e.g., "React, Node, Postgres")'
        });
      }
    } else if (session.state === 'Q3') {
      const cached = answerCache.get(session.userId);

      // Handle "same" to reuse cached answer
      if (text.trim().toLowerCase() === 'same' && cached && cached.techStack) {
        session.answers.techStack = cached.techStack;
      } else {
        session.answers.techStack = text;
      }

      // Cache the answers for this user
      answerCache.set(session.userId, {
        users: session.answers.users,
        problem: session.answers.problem,
        techStack: session.answers.techStack
      });

      session.state = 'GENERATING';

      await client.chat.postMessage({
        channel: session.channelId,
        thread_ts: threadTs,
        text: 'Generating stories...'
      });

      // Fetch README from GitHub for context
      const { fetchReadme } = require('./github');
      const readme = await fetchReadme();
      if (readme) {
        session.repoContext = readme;
      }

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
        text: `✅ Generated ${stories.length} stories:\n\n${storyText}\n\nWhat's next?\n\nType \`review\` to run quality review, \`refine\` for interactive refinement, or \`Y\` to create GitHub issues.`
      });
    } else if (session.state === 'APPROVAL') {
      if (text.toLowerCase().startsWith('y')) {
        // Create GitHub issues directly (skip review)
        const epic = session.epic || saveEpic(session);

        await client.chat.postMessage({
          channel: session.channelId,
          thread_ts: threadTs,
          text: 'Creating GitHub issues...'
        });

        const { createIssues } = require('./github');
        const result = await createIssues(epic);

        const storyList = result.stories.map(i => `- #${i.number}: ${i.title}`).join('\n');
        await client.chat.postMessage({
          channel: session.channelId,
          thread_ts: threadTs,
          text: `✅ Created epic #${result.epic.number}: ${result.epic.title}\n\nStories:\n${storyList}\n\nDone! 🎉`
        });

        sessions.delete(threadTs);

      } else if (text.toLowerCase() === 'review') {
        // Save epic and start review
        const epic = session.epic || saveEpic(session);
        session.state = 'REVIEWING';

        await client.chat.postMessage({
          channel: session.channelId,
          thread_ts: threadTs,
          text: `✅ Epic saved to epics/${epic.id}.json\n\nRunning review...`
        });

        // Run review immediately
        await runReview(epic, threadTs, client, session.channelId);

      } else if (text.toLowerCase() === 'refine') {
        // Save epic first, then enter interactive mode
        saveEpic(session);
        session.state = 'INTERACTIVE_MODE';
        await showStoryMenu(session, threadTs, client);
      } else {
        // User wants changes via bulk refinement
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
      const trimmedText = text.trim().toLowerCase();

      // Check if user wants to address review issues
      if (trimmedText === 'all' || /^\d+(?:\s*,\s*\d+)*$/.test(trimmedText)) {
        // User wants to address all or specific issues
        let issuesToAddress = [];

        if (trimmedText === 'all') {
          issuesToAddress = session.reviewIssues || [];
        } else {
          // Parse issue numbers (e.g., "1, 2, 4")
          const selectedNumbers = trimmedText.split(',').map(n => parseInt(n.trim()));
          const reviewIssues = session.reviewIssues || [];
          issuesToAddress = reviewIssues.filter(issue => selectedNumbers.includes(issue.number));
        }

        if (issuesToAddress.length === 0) {
          await client.chat.postMessage({
            channel: session.channelId,
            thread_ts: threadTs,
            text: '❌ No valid issues selected. Please try again or type `Y` to create GitHub issues as-is.'
          });
          return;
        }

        // Build feedback string from selected issues
        const issuesList = issuesToAddress.map(issue => `- ${issue.text}`).join('\n');
        session.feedback = `Address the following issues from the review:\n${issuesList}`;

        session.state = 'REFINING';
        await client.chat.postMessage({
          channel: session.channelId,
          thread_ts: threadTs,
          text: `Addressing ${issuesToAddress.length} issue(s)...`
        });

        // Trigger refinement with the selected issues
        const { refineStories } = require('./claude');
        const updatedStories = await refineStories(session);
        session.stories = updatedStories;

        // Update epic
        if (session.epic) {
          session.epic.stories = updatedStories;
          const fs = require('fs');
          fs.writeFileSync(
            `./epics/${session.epic.id}.json`,
            JSON.stringify(session.epic, null, 2)
          );
        }

        session.state = 'REVIEW_APPROVAL';
        const storyText = formatStories(updatedStories);
        await client.chat.postMessage({
          channel: session.channelId,
          thread_ts: threadTs,
          text: `✅ Updated stories:\n\n${storyText}\n\nCreate GitHub issues? [Y/n/refine]`
        });

      } else if (trimmedText.startsWith('y')) {
        // Check if this is an existing epic
        if (session.isExistingEpic) {
          await client.chat.postMessage({
            channel: session.channelId,
            thread_ts: threadTs,
            text: `✅ Epic updated and saved to epics/${session.epic.id}.json\n\n💡 This epic was loaded from an existing file. If you want to update GitHub issues, use \`/delete-epic\` to close the old issues, then create a new epic with \`/story\`.`
          });
          sessions.delete(threadTs);
          return;
        }

        // Create GitHub issues for new epics
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
      } else if (trimmedText === 'refine') {
        // User wants interactive refinement mode
        session.state = 'INTERACTIVE_MODE';
        await showStoryMenu(session, threadTs, client);
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
    } else if (session.state === 'INTERACTIVE_MODE') {
      await handleInteractiveCommand(session, text, threadTs, client);
    } else if (session.state === 'STORY_FOCUSED') {
      await handleStoryFocused(session, text, threadTs, client);
    } else if (session.state === 'DELETE_CONFIRMATION') {
      if (text.toLowerCase().startsWith('y')) {
        // User confirmed deletion
        await client.chat.postMessage({
          channel: session.channelId,
          thread_ts: threadTs,
          text: `Deleting epic #${session.epicNumber}...`
        });

        try {
          const { deleteEpic } = require('./github');
          console.log(`Attempting to delete epic #${session.epicNumber}`);
          const result = await deleteEpic(session.epicNumber);
          console.log(`Delete result:`, result);

          await client.chat.postMessage({
            channel: session.channelId,
            thread_ts: threadTs,
            text: `✅ Closed epic #${session.epicNumber} and ${result.storiesClosed} story issues on GitHub.\n\n💡 The local epic JSON file was kept in the \`epics/\` folder. You can restore it later using \`/review-epic\` if needed.`
          });
        } catch (error) {
          console.error('Error deleting epic:', error);
          await client.chat.postMessage({
            channel: session.channelId,
            thread_ts: threadTs,
            text: `❌ Error deleting epic: ${error.message}\n\nPlease check the logs for details.`
          });
        }

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
  // TODO: Add prettier formatting with Slack Block Kit for better visual presentation
  return stories.map((s, i) => {
    const criteria = s.acceptance_criteria.map(c => `   - ${c}`).join('\n');
    return `${i + 1}. ${s.title}\n   ${s.story}\n   Acceptance Criteria:\n${criteria}`;
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

    // Parse issues from review (supports both numbered and bullet point formats)
    const issuesSection = review.match(/⚠️ Issues:\n((?:(?:\d+\.|-).*\n?)+)/);
    const reviewIssues = [];
    if (issuesSection) {
      const issueLines = issuesSection[1].trim().split('\n');
      issueLines.forEach((line) => {
        // Match either "1. text" or "- text"
        const numberedMatch = line.match(/^(\d+)\.\s*(.+)/);
        const bulletMatch = line.match(/^-\s*(.+)/);

        if (numberedMatch) {
          const issueNumber = parseInt(numberedMatch[1]);
          const issueText = numberedMatch[2].trim();
          if (issueText) {
            reviewIssues.push({ number: issueNumber, text: issueText });
          }
        } else if (bulletMatch) {
          const issueText = bulletMatch[1].trim();
          if (issueText) {
            reviewIssues.push({ number: reviewIssues.length + 1, text: issueText });
          }
        }
      });
    }

    const session = sessions.get(threadTs);
    if (session) {
      session.state = 'REVIEW_APPROVAL';
      session.hasBeenReviewed = true;
      session.reviewText = review;
      session.reviewIssues = reviewIssues;
    }

    // Build prompt based on whether issues were found
    let promptText = `🔍 Review complete!\n\n${review}\n\n`;
    if (reviewIssues.length > 0) {
      promptText += `Would you like me to address these issues?\n\nType \`all\` to address all issues, or type issue numbers (e.g., \`1, 2, 4\`) to address specific ones.\n\nOr: \`Y\` to create GitHub issues as-is, \`refine\` for interactive mode.`;
    } else {
      promptText += `Create GitHub issues? [Y/n/refine]`;
    }

    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: promptText
    });
  } catch (error) {
    console.error('Error in runReview:', error);
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: `❌ Review error: ${error.message}\n\nCreate GitHub issues anyway? [Y/n/refine]`
    });

    const session = sessions.get(threadTs);
    if (session) {
      session.state = 'REVIEW_APPROVAL';
      session.hasBeenReviewed = true;
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
