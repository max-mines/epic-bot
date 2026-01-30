require('dotenv').config();
const { App, ExpressReceiver } = require('@slack/bolt');
const fs = require('fs');

const VERSION = 'v0.4.0';

// Use ExpressReceiver for HTTP webhooks (instead of Socket Mode)
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  receiver
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

// /delete-epic command handler (now works with milestones)
app.command('/delete-epic', async ({ command, ack, client }) => {
  await ack();

  const milestoneNumber = command.text.trim();

  if (!milestoneNumber || isNaN(milestoneNumber)) {
    await client.chat.postEphemeral({
      channel: command.channel_id,
      user: command.user_id,
      text: 'Please provide a milestone number: `/delete-epic 5`'
    });
    return;
  }

  try {
    // Fetch milestone details
    const { getMilestone } = require('./github');
    const milestone = await getMilestone(parseInt(milestoneNumber));

    const openIssues = milestone.issues.filter(i => i.state === 'open');
    const storyList = milestone.issues.map(s => `- #${s.number}: ${s.title} (${s.state})`).join('\n');

    // Post confirmation message
    const result = await client.chat.postMessage({
      channel: command.channel_id,
      text: `⚠️ Confirm closing milestone #${milestoneNumber}: ${milestone.title}\n\n**Stories (${milestone.issues.length} total, ${openIssues.length} open):**\n${storyList || '(none)'}\n\n⚠️ **Reply to this message** with \`Y\` to close milestone and all open issues, or anything else to cancel.`
    });

    // Store deletion session
    sessions.set(result.ts, {
      state: 'DELETE_CONFIRMATION',
      milestoneNumber: parseInt(milestoneNumber),
      milestoneTitle: milestone.title,
      storyCount: openIssues.length,
      userId: command.user_id,
      channelId: command.channel_id,
      lastActivity: Date.now()
    });

  } catch (error) {
    console.error('Error fetching milestone:', error);
    await client.chat.postEphemeral({
      channel: command.channel_id,
      user: command.user_id,
      text: `❌ Error fetching milestone #${milestoneNumber}: ${error.message}`
    });
  }
});

// /review-epic command handler - opens modal with milestone picker
app.command('/review-epic', async ({ command, ack, client }) => {
  await ack();

  try {
    // Fetch open milestones from GitHub
    const { listOpenMilestones } = require('./github');
    const milestones = await listOpenMilestones();

    if (milestones.length === 0) {
      await client.chat.postEphemeral({
        channel: command.channel_id,
        user: command.user_id,
        text: '❌ No open milestones found in the repository.\n\nUse `/story` to create an epic first.'
      });
      return;
    }

    // Build milestone options for dropdown
    const milestoneOptions = milestones.map(m => ({
      text: {
        type: 'plain_text',
        text: `#${m.number}: ${m.title}`.substring(0, 75),
        emoji: true
      },
      value: String(m.number)
    }));

    // Open modal with milestone picker
    await client.views.open({
      trigger_id: command.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'review_epic_modal',
        private_metadata: JSON.stringify({ channel_id: command.channel_id }),
        title: {
          type: 'plain_text',
          text: 'Select Epic to Review'
        },
        submit: {
          type: 'plain_text',
          text: 'Review Epic'
        },
        close: {
          type: 'plain_text',
          text: 'Cancel'
        },
        blocks: [
          {
            type: 'section',
            block_id: 'milestone_select_block',
            text: {
              type: 'mrkdwn',
              text: `*Choose a milestone to review:*\n\n${milestones.length} open milestone(s) found`
            },
            accessory: {
              type: 'static_select',
              action_id: 'milestone_select',
              placeholder: {
                type: 'plain_text',
                text: 'Select milestone...'
              },
              options: milestoneOptions
            }
          }
        ]
      }
    });

  } catch (error) {
    console.error('Error opening review modal:', error);
    await client.chat.postEphemeral({
      channel: command.channel_id,
      user: command.user_id,
      text: `❌ Error: ${error.message}`
    });
  }
});

// Handle modal submission for /review-epic
app.view('review_epic_modal', async ({ ack, body, view, client }) => {
  await ack();

  try {
    const metadata = JSON.parse(view.private_metadata);
    const channelId = metadata.channel_id;
    const userId = body.user.id;

    // Get selected milestone number
    const selectedMilestone = view.state.values.milestone_select_block.milestone_select.selected_option;
    if (!selectedMilestone) {
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: '❌ Please select a milestone.'
      });
      return;
    }

    const milestoneNumber = parseInt(selectedMilestone.value);

    // Post initial message
    const result = await client.chat.postMessage({
      channel: channelId,
      text: `📝 Loading milestone #${milestoneNumber}...`
    });

    // Fetch milestone and issues from GitHub
    const {
      fetchMilestoneWithIssues,
      parseMilestoneDescription,
      parseIssueToStory
    } = require('./github');

    const { milestone, issues } = await fetchMilestoneWithIssues(milestoneNumber);

    // Parse milestone description for metadata
    const epicMetadata = parseMilestoneDescription(milestone.description);

    // Parse issues into stories
    const stories = issues.map(issue => parseIssueToStory(issue));

    // Extract epic ID from milestone title (format: "epic-XXX: Title")
    const titleMatch = milestone.title.match(/^(epic-[^:]+):\s*(.+)/);
    const epicId = titleMatch?.[1] || `epic-${milestoneNumber}`;
    const epicTitle = titleMatch?.[2] || milestone.title;

    // Build epic object
    const epicData = {
      id: epicId,
      title: epicTitle,
      users: epicMetadata.users,
      problem: epicMetadata.problem,
      tech_stack: epicMetadata.tech_stack,
      stories: stories,
      github_milestone_number: milestoneNumber,
      github_milestone_url: milestone.html_url
    };

    // Update message
    await client.chat.update({
      channel: channelId,
      ts: result.ts,
      text: `📝 Reviewing epic: "${epicTitle}"\n\n${stories.length} stories found. Running review...`
    });

    // Create session
    const session = {
      state: 'REVIEWING',
      description: epicTitle,
      userId: userId,
      channelId: channelId,
      answers: {
        users: epicMetadata.users,
        problem: epicMetadata.problem,
        techStack: epicMetadata.tech_stack
      },
      stories: stories,
      epic: epicData,
      isExistingEpic: true,
      lastActivity: Date.now()
    };

    sessions.set(result.ts, session);

    // Run review
    await runReview(epicData, result.ts, client, channelId);

  } catch (error) {
    console.error('Error in review modal submission:', error);
    // Try to notify user of error
    try {
      const metadata = JSON.parse(view.private_metadata);
      await client.chat.postEphemeral({
        channel: metadata.channel_id,
        user: body.user.id,
        text: `❌ Error loading milestone: ${error.message}`
      });
    } catch (e) {
      console.error('Could not send error message:', e);
    }
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
      // Check if epic has GitHub milestone number (meaning it was previously published)
      if (session.epic.github_milestone_number) {
        // Update existing GitHub issues
        await client.chat.postMessage({
          channel: session.channelId,
          thread_ts: threadTs,
          text: 'Updating GitHub issues...'
        });

        const { updateIssues } = require('./github');
        const result = await updateIssues(session.epic);

        const storyList = result.stories.map(i => `- #${i.number}: ${i.title}`).join('\n');
        await client.chat.postMessage({
          channel: session.channelId,
          thread_ts: threadTs,
          text: `✅ Updated milestone #${result.milestone.number}: ${result.milestone.title}\n\nStories:\n${storyList}\n\nDone! 🎉`
        });

        sessions.delete(threadTs);
      } else {
        // Epic exists locally but was never published to GitHub
        await client.chat.postMessage({
          channel: session.channelId,
          thread_ts: threadTs,
          text: `✅ Epic updated and saved to epics/${session.epic.id}.json\n\n💡 This epic has not been published to GitHub yet. Type \`Y\` to create GitHub issues, or type \`done\` to exit without publishing.`
        });
      }
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
        text: `✅ Created milestone #${result.milestone.number}: ${result.milestone.title}\n\nStories:\n${storyList}\n\nDone! 🎉`
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

  // Update the epic in session (will be synced to GitHub when user finishes)
  if (session.epic) {
    session.epic.stories = session.stories;
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
          text: `✅ Created milestone #${result.milestone.number}: ${result.milestone.title}\n\nStories:\n${storyList}\n\nDone! 🎉`
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

        // Check if single issue references a specific story
        let targetStoryIndex = -1;
        if (issuesToAddress.length === 1) {
          const issueText = issuesToAddress[0].text;
          // Match story references like "Story-006", "story-078", "Story 006"
          const storyMatch = issueText.match(/story[-\s]?(\d+)/i);
          if (storyMatch) {
            const storyNum = parseInt(storyMatch[1]);
            // Find the story with matching ID or index
            targetStoryIndex = session.stories.findIndex(s => {
              const storyIdMatch = s.id?.match(/story-(\d+)/i);
              if (storyIdMatch) {
                return parseInt(storyIdMatch[1]) === storyNum;
              }
              return false;
            });
            // If not found by ID, try by 1-based index
            if (targetStoryIndex === -1 && storyNum >= 1 && storyNum <= session.stories.length) {
              targetStoryIndex = storyNum - 1;
            }
          }
        }

        session.state = 'REFINING';
        await client.chat.postMessage({
          channel: session.channelId,
          thread_ts: threadTs,
          text: `Addressing ${issuesToAddress.length} issue(s)...`
        });

        // If single issue targets a specific story, only refine that story
        if (targetStoryIndex >= 0) {
          const { refineSingleStory } = require('./claude');
          const currentStory = session.stories[targetStoryIndex];
          const epicContext = {
            description: session.description,
            users: session.answers.users,
            problem: session.answers.problem,
            techStack: session.answers.techStack
          };

          const updatedStory = await refineSingleStory(
            currentStory,
            issuesToAddress[0].text,
            epicContext
          );

          // Preserve story ID and GitHub info
          updatedStory.id = currentStory.id;
          updatedStory.github_issue_number = currentStory.github_issue_number;
          updatedStory.github_issue_url = currentStory.github_issue_url;

          // Update only this story
          session.stories[targetStoryIndex] = updatedStory;
          if (session.epic) {
            session.epic.stories = session.stories;
          }

          // Track which story was modified for selective GitHub update
          session.modifiedStoryIndices = [targetStoryIndex];

          session.state = 'REVIEW_APPROVAL';
          const storyNum = targetStoryIndex + 1;
          const criteria = updatedStory.acceptance_criteria.map(c => `   - ${c}`).join('\n');
          await client.chat.postMessage({
            channel: session.channelId,
            thread_ts: threadTs,
            text: `✅ Updated Story #${storyNum}: ${updatedStory.title}\n\n   ${updatedStory.story}\n\nAcceptance Criteria:\n${criteria}\n\nCreate GitHub issues? [Y/n/refine]`
          });
        } else {
          // Multiple issues or no specific story - refine all stories
          const issuesList = issuesToAddress.map(issue => `- ${issue.text}`).join('\n');
          session.feedback = `Address the following issues from the review:\n${issuesList}`;

          const { refineStories } = require('./claude');
          const updatedStories = await refineStories(session);
          session.stories = updatedStories;

          // Update epic in session (will be synced to GitHub when user finishes)
          if (session.epic) {
            session.epic.stories = updatedStories;
          }

          // Clear modified tracking since all stories were regenerated
          session.modifiedStoryIndices = null;

          session.state = 'REVIEW_APPROVAL';
          const storyText = formatStories(updatedStories);
          await client.chat.postMessage({
            channel: session.channelId,
            thread_ts: threadTs,
            text: `✅ Updated stories:\n\n${storyText}\n\nCreate GitHub issues? [Y/n/refine]`
          });
        }

      } else if (trimmedText.startsWith('y')) {
        // Check if this is an existing epic
        if (session.isExistingEpic && session.epic.github_milestone_number) {
          // Check if only one story was modified - update only that one
          if (session.modifiedStoryIndices && session.modifiedStoryIndices.length === 1) {
            const storyIndex = session.modifiedStoryIndices[0];
            const story = session.stories[storyIndex];

            if (story.github_issue_number) {
              await client.chat.postMessage({
                channel: session.channelId,
                thread_ts: threadTs,
                text: `Updating issue #${story.github_issue_number}...`
              });

              const { updateSingleIssue } = require('./github');
              const result = await updateSingleIssue(story);

              await client.chat.postMessage({
                channel: session.channelId,
                thread_ts: threadTs,
                text: `✅ Updated issue #${result.number}: ${result.title}\n\nDone! 🎉`
              });

              sessions.delete(threadTs);
              return;
            }
          }

          // Update all GitHub issues
          await client.chat.postMessage({
            channel: session.channelId,
            thread_ts: threadTs,
            text: 'Updating GitHub issues...'
          });

          const { updateIssues } = require('./github');
          const result = await updateIssues(session.epic);

          const storyList = result.stories.map(i => `- #${i.number}: ${i.title}`).join('\n');
          await client.chat.postMessage({
            channel: session.channelId,
            thread_ts: threadTs,
            text: `✅ Updated milestone #${result.milestone.number}: ${result.milestone.title}\n\nStories:\n${storyList}\n\nDone! 🎉`
          });

          sessions.delete(threadTs);
          return;
        }

        // Create GitHub issues for new epics or existing epics without GitHub milestone numbers
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
          text: `✅ Created milestone #${result.milestone.number}: ${result.milestone.title}\n\nStories:\n${storyList}\n\nDone! 🎉`
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
          text: `Closing milestone #${session.milestoneNumber}...`
        });

        try {
          const { deleteEpic } = require('./github');
          console.log(`Attempting to close milestone #${session.milestoneNumber}`);
          const result = await deleteEpic(session.milestoneNumber);
          console.log(`Delete result:`, result);

          await client.chat.postMessage({
            channel: session.channelId,
            thread_ts: threadTs,
            text: `✅ Closed milestone #${session.milestoneNumber} and ${result.storiesClosed} story issues on GitHub.\n\n💡 The local epic JSON file was kept in the \`epics/\` folder. You can restore it later using \`/review-epic\` if needed.`
          });
        } catch (error) {
          console.error('Error closing milestone:', error);
          await client.chat.postMessage({
            channel: session.channelId,
            thread_ts: threadTs,
            text: `❌ Error closing milestone: ${error.message}\n\nPlease check the logs for details.`
          });
        }

        sessions.delete(threadTs);
      } else {
        // User cancelled deletion
        await client.chat.postMessage({
          channel: session.channelId,
          thread_ts: threadTs,
          text: '❌ Cancelled.'
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

const PORT = process.env.PORT || 3000;

(async () => {
  try {
    await app.start(PORT);
    console.log(`⚡️ Epic Bot ${VERSION} is running on port ${PORT}!`);
  } catch (error) {
    console.error('❌ Failed to start Epic Bot:', error.message);

    // Check for common configuration issues
    if (!process.env.SLACK_BOT_TOKEN) {
      console.error('Missing SLACK_BOT_TOKEN in .env file');
    }
    if (!process.env.SLACK_SIGNING_SECRET) {
      console.error('Missing SLACK_SIGNING_SECRET in .env file');
    }

    console.error('\nPlease check your .env file and Slack app configuration.');
    console.error('See README.md for setup instructions.');
    process.exit(1);
  }
})();

// Handle uncaught errors to prevent crashes
process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  // Don't exit - let the bot try to continue
});
