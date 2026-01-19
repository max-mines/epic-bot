const { Octokit } = require('@octokit/rest');

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN
});

const owner = process.env.GITHUB_OWNER;
const repo = process.env.GITHUB_REPO;

async function createIssues(epic) {
  const issues = [];

  // Create story issues first so we have their numbers for the epic
  const storyIssues = [];
  for (const story of epic.stories) {
    const response = await octokit.issues.create({
      owner,
      repo,
      title: `${story.id}: ${story.title}`,
      body: 'Temporary placeholder - will be updated', // Temporary body
      labels: ['user-story', 'epic-bot']
    });

    storyIssues.push({
      number: response.data.number,
      title: story.title,
      url: response.data.html_url,
      story: story
    });
  }

  // Create the epic issue with links to all stories
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

  // Update story issues with proper body including epic link
  for (const storyIssue of storyIssues) {
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
  const storyList = storyIssues
    .map((s, i) => `${i + 1}. [${s.title}](#${s.number})`)
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

async function deleteEpic(epicIssueNumber) {
  // First, get the epic issue to find all related story issues
  const epicIssue = await octokit.issues.get({
    owner,
    repo,
    issue_number: epicIssueNumber
  });

  // Find all issues that reference this epic
  const searchQuery = `repo:${owner}/${repo} is:issue label:user-story,epic-bot "Part of epic #${epicIssueNumber}"`;
  const searchResults = await octokit.search.issuesAndPullRequests({
    q: searchQuery
  });

  const storyIssues = searchResults.data.items;

  // Close all story issues
  for (const story of storyIssues) {
    await octokit.issues.update({
      owner,
      repo,
      issue_number: story.number,
      state: 'closed'
    });
  }

  // Close the epic issue
  await octokit.issues.update({
    owner,
    repo,
    issue_number: epicIssueNumber,
    state: 'closed'
  });

  return {
    epic: epicIssueNumber,
    storiesClosed: storyIssues.length
  };
}

module.exports = { createIssues, deleteEpic };
