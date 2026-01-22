const { Octokit } = require('@octokit/rest');

console.log('[github.js] Module loaded');
console.log('[github.js] GITHUB_TOKEN exists:', !!process.env.GITHUB_TOKEN);
if (process.env.GITHUB_TOKEN) {
  const token = process.env.GITHUB_TOKEN;
  const obscured = token.substring(0, 4) + '...' + token.substring(token.length - 4);
  console.log('[github.js] GITHUB_TOKEN (obscured):', obscured);
}
console.log('[github.js] GITHUB_OWNER:', process.env.GITHUB_OWNER);
console.log('[github.js] GITHUB_REPO:', process.env.GITHUB_REPO);

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN
});

const owner = process.env.GITHUB_OWNER;
const repo = process.env.GITHUB_REPO;

console.log('[github.js] Octokit initialized');

async function fetchReadme() {
  console.log('[fetchReadme] Function called');
  try {
    console.log('[fetchReadme] Fetching README...');
    const response = await octokit.repos.getReadme({
      owner,
      repo
    });

    // Decode base64 content
    const content = Buffer.from(response.data.content, 'base64').toString('utf-8');
    console.log('[fetchReadme] README fetched successfully, length:', content.length);
    return content;
  } catch (error) {
    console.log('[fetchReadme] Could not fetch README:', error.message);
    return null; // Return null if README doesn't exist or can't be fetched
  }
}

async function createIssues(epic) {
  console.log('[createIssues] Function called with epic:', epic.id);
  // TODO: Add error handling for GitHub API rate limits
  // TODO: Add option to assign issues to team members automatically
  const issues = [];

  // Create story issues first so we have their numbers for the epic
  const storyIssues = [];
  console.log('[createIssues] Creating story issues...');
  for (const story of epic.stories) {
    console.log('[createIssues] Creating story issue:', story.id);

    // Format acceptance criteria for initial creation
    const criteria = story.acceptance_criteria
      .map(c => `- [ ] ${c}`)
      .join('\n');

    const initialBody = `${story.story}

## Acceptance Criteria
${criteria}

---
*Note: Epic issue will be linked once created*`;

    const response = await octokit.issues.create({
      owner,
      repo,
      title: `${story.id}: ${story.title}`,
      body: initialBody,
      labels: ['user-story', 'epic-bot']
    });

    console.log('[createIssues] Story issue created: #' + response.data.number);
    storyIssues.push({
      number: response.data.number,
      title: story.title,
      url: response.data.html_url,
      story: story
    });
  }

  // Create the epic issue with links to all stories
  console.log('[createIssues] Creating epic issue...');
  const epicBody = formatEpicBody(epic, storyIssues);
  const epicResponse = await octokit.issues.create({
    owner,
    repo,
    title: `${epic.id}: ${epic.title}`,
    body: epicBody,
    labels: ['epic', 'epic-bot']
  });

  const epicNumber = epicResponse.data.number;
  const epicUrl = epicResponse.data.html_url;
  console.log('[createIssues] Epic issue created: #' + epicNumber);

  // Update story issues with proper body including epic link
  console.log('[createIssues] Updating story issues with epic link...');
  for (const storyIssue of storyIssues) {
    console.log('[createIssues] Updating story issue #' + storyIssue.number);
    const body = formatIssueBody(storyIssue.story, epic, epicNumber);
    await octokit.issues.update({
      owner,
      repo,
      issue_number: storyIssue.number,
      body
    });

    issues.push({
      number: storyIssue.number,
      title: storyIssue.title,
      url: storyIssue.url
    });
  }

  console.log('[createIssues] All issues created successfully');

  // Save GitHub issue numbers back to epic JSON
  console.log('[createIssues] Saving GitHub issue numbers to epic JSON...');
  epic.github_epic_number = epicNumber;
  epic.github_epic_url = epicUrl;
  epic.stories = epic.stories.map((story, index) => ({
    ...story,
    github_issue_number: storyIssues[index].number,
    github_issue_url: storyIssues[index].url
  }));

  const fs = require('fs');
  fs.writeFileSync(
    `./epics/${epic.id}.json`,
    JSON.stringify(epic, null, 2)
  );
  console.log('[createIssues] Epic JSON updated with GitHub issue numbers');

  return {
    epic: {
      number: epicNumber,
      title: epic.title,
      url: epicUrl
    },
    stories: issues
  };
}

function formatEpicBody(epic, storyIssues) {
  // TODO: Add epic description/context field for more detailed overview
  // TODO: Add estimated story points or complexity indicators
  const storyList = storyIssues
    .map((s, i) => `${i + 1}. #${s.number} - ${s.title}`)
    .join('\n');

  return `## Overview
${epic.problem}

**Users:** ${epic.users}
**Tech Stack:** ${epic.tech_stack}

## User Stories
${storyList}

---
*Created with [Epic Bot](https://github.com/max-mines/epic-bot)*`;
}

function formatIssueBody(story, epic, epicNumber) {
  const criteria = story.acceptance_criteria
    .map(c => `- [ ] ${c}`)
    .join('\n');

  return `${story.story}

## Acceptance Criteria
${criteria}

---
Part of epic #${epicNumber}`;
}

async function updateIssues(epic) {
  console.log('[updateIssues] Function called with epic:', epic.id);
  console.log('[updateIssues] Epic GitHub number:', epic.github_epic_number);

  if (!epic.github_epic_number) {
    throw new Error('Epic does not have a GitHub issue number. Cannot update issues.');
  }

  const epicNumber = epic.github_epic_number;
  const issues = [];

  // Update story issues
  console.log('[updateIssues] Updating story issues...');
  for (const story of epic.stories) {
    if (!story.github_issue_number) {
      console.log('[updateIssues] Story', story.id, 'does not have a GitHub issue number, skipping');
      continue;
    }

    console.log('[updateIssues] Updating story issue #' + story.github_issue_number);
    const body = formatIssueBody(story, epic, epicNumber);
    const response = await octokit.issues.update({
      owner,
      repo,
      issue_number: story.github_issue_number,
      title: `${story.id}: ${story.title}`,
      body
    });

    console.log('[updateIssues] Story issue #' + story.github_issue_number + ' updated successfully');
    issues.push({
      number: story.github_issue_number,
      title: story.title,
      url: response.data.html_url
    });
  }

  // Update epic issue
  console.log('[updateIssues] Updating epic issue #' + epicNumber);
  const storyIssues = epic.stories
    .filter(s => s.github_issue_number)
    .map(s => ({
      number: s.github_issue_number,
      title: s.title,
      url: s.github_issue_url
    }));

  const epicBody = formatEpicBody(epic, storyIssues);
  const epicResponse = await octokit.issues.update({
    owner,
    repo,
    issue_number: epicNumber,
    title: `${epic.id}: ${epic.title}`,
    body: epicBody
  });

  const epicUrl = epicResponse.data.html_url;
  console.log('[updateIssues] Epic issue #' + epicNumber + ' updated successfully');

  console.log('[updateIssues] All issues updated successfully');
  return {
    epic: {
      number: epicNumber,
      title: epic.title,
      url: epicUrl
    },
    stories: issues
  };
}

async function deleteEpic(epicIssueNumber) {
  console.log('[deleteEpic] ========== FUNCTION ENTRY ==========');
  console.log('[deleteEpic] Called with issue number:', epicIssueNumber);
  console.log('[deleteEpic] Issue number type:', typeof epicIssueNumber);
  console.log('[deleteEpic] Using owner:', owner);
  console.log('[deleteEpic] Using repo:', repo);

  try {
    // First, get the epic issue to find all related story issues
    console.log('[deleteEpic] Step 1: Fetching epic issue #' + epicIssueNumber + '...');
    const epicIssue = await octokit.issues.get({
      owner,
      repo,
      issue_number: epicIssueNumber
    });
    console.log('[deleteEpic] Epic issue fetched successfully');
    console.log('[deleteEpic] Epic title:', epicIssue.data.title);
    console.log('[deleteEpic] Epic state:', epicIssue.data.state);

    // Find all issues that reference this epic
    const searchQuery = `repo:${owner}/${repo} is:issue label:user-story,epic-bot "Part of epic #${epicIssueNumber}"`;
    console.log('[deleteEpic] Step 2: Searching for story issues');
    console.log('[deleteEpic] Search query:', searchQuery);

    const searchResults = await octokit.search.issuesAndPullRequests({
      q: searchQuery
    });

    const storyIssues = searchResults.data.items;
    console.log('[deleteEpic] Search complete. Found', storyIssues.length, 'story issues');

    if (storyIssues.length > 0) {
      console.log('[deleteEpic] Story issue numbers:', storyIssues.map(s => '#' + s.number).join(', '));
    }

    // Close all story issues
    console.log('[deleteEpic] Step 3: Closing', storyIssues.length, 'story issues...');
    for (const story of storyIssues) {
      console.log('[deleteEpic] Closing story issue #' + story.number + ':', story.title);
      const updateResponse = await octokit.issues.update({
        owner,
        repo,
        issue_number: story.number,
        state: 'closed'
      });
      console.log('[deleteEpic] Story issue #' + story.number + ' update response status:', updateResponse.status);
      console.log('[deleteEpic] Story issue #' + story.number + ' new state:', updateResponse.data.state);
    }

    // Close the epic issue
    console.log('[deleteEpic] Step 4: Closing epic issue #' + epicIssueNumber + '...');
    const epicUpdateResponse = await octokit.issues.update({
      owner,
      repo,
      issue_number: epicIssueNumber,
      state: 'closed'
    });
    console.log('[deleteEpic] Epic issue update response status:', epicUpdateResponse.status);
    console.log('[deleteEpic] Epic issue new state:', epicUpdateResponse.data.state);

    const result = {
      epic: epicIssueNumber,
      storiesClosed: storyIssues.length
    };
    console.log('[deleteEpic] ========== FUNCTION EXIT SUCCESS ==========');
    console.log('[deleteEpic] Returning result:', JSON.stringify(result));
    return result;
  } catch (error) {
    console.error('[deleteEpic] ========== ERROR ==========');
    console.error('[deleteEpic] Error type:', error.constructor.name);
    console.error('[deleteEpic] Error message:', error.message);
    console.error('[deleteEpic] Error stack:', error.stack);
    if (error.response) {
      console.error('[deleteEpic] API Response status:', error.response.status);
      console.error('[deleteEpic] API Response data:', JSON.stringify(error.response.data, null, 2));
    }
    throw error;
  }
}

module.exports = { createIssues, updateIssues, deleteEpic, fetchReadme };
