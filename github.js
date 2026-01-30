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

  // Create milestone first
  console.log('[createIssues] Creating milestone...');
  const milestoneResponse = await octokit.issues.createMilestone({
    owner,
    repo,
    title: `${epic.id}: ${epic.title}`,
    description: formatMilestoneDescription(epic)
  });

  const milestoneNumber = milestoneResponse.data.number;
  const milestoneUrl = milestoneResponse.data.html_url;
  console.log('[createIssues] Milestone created: #' + milestoneNumber);

  // Create story issues assigned to the milestone
  console.log('[createIssues] Creating story issues...');
  for (const story of epic.stories) {
    console.log('[createIssues] Creating story issue:', story.id);

    const body = formatIssueBody(story);

    const response = await octokit.issues.create({
      owner,
      repo,
      title: `${story.id}: ${story.title}`,
      body,
      labels: ['user-story', 'epic-bot'],
      milestone: milestoneNumber
    });

    console.log('[createIssues] Story issue created: #' + response.data.number);
    issues.push({
      number: response.data.number,
      title: story.title,
      url: response.data.html_url
    });
  }

  console.log('[createIssues] All issues created successfully');

  // Save GitHub milestone number back to epic JSON
  console.log('[createIssues] Saving GitHub milestone number to epic JSON...');
  epic.github_milestone_number = milestoneNumber;
  epic.github_milestone_url = milestoneUrl;
  epic.stories = epic.stories.map((story, index) => ({
    ...story,
    github_issue_number: issues[index].number,
    github_issue_url: issues[index].url
  }));

  const fs = require('fs');
  fs.writeFileSync(
    `./epics/${epic.id}.json`,
    JSON.stringify(epic, null, 2)
  );
  console.log('[createIssues] Epic JSON updated with GitHub milestone number');

  return {
    milestone: {
      number: milestoneNumber,
      title: epic.title,
      url: milestoneUrl
    },
    stories: issues
  };
}

function formatMilestoneDescription(epic) {
  const metadata = JSON.stringify({
    users: epic.users,
    problem: epic.problem,
    tech_stack: epic.tech_stack
  });

  return `## Overview
${epic.problem}

**Users:** ${epic.users}
**Tech Stack:** ${epic.tech_stack}

---
*Created with [Epic Bot](https://github.com/max-mines/epic-bot)*

<!-- epic-bot-metadata
${metadata}
-->`;
}

function formatIssueBody(story) {
  const criteria = story.acceptance_criteria
    .map(c => `- [ ] ${c}`)
    .join('\n');

  return `${story.story}

## Acceptance Criteria
${criteria}`;
}

async function updateIssues(epic) {
  console.log('[updateIssues] Function called with epic:', epic.id);
  console.log('[updateIssues] Epic milestone number:', epic.github_milestone_number);

  if (!epic.github_milestone_number) {
    throw new Error('Epic does not have a GitHub milestone number. Cannot update issues.');
  }

  const milestoneNumber = epic.github_milestone_number;
  const issues = [];

  // Update story issues
  console.log('[updateIssues] Updating story issues...');
  for (const story of epic.stories) {
    if (!story.github_issue_number) {
      console.log('[updateIssues] Story', story.id, 'does not have a GitHub issue number, skipping');
      continue;
    }

    console.log('[updateIssues] Updating story issue #' + story.github_issue_number);
    const body = formatIssueBody(story);
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

  // Update milestone
  console.log('[updateIssues] Updating milestone #' + milestoneNumber);
  const milestoneResponse = await octokit.issues.updateMilestone({
    owner,
    repo,
    milestone_number: milestoneNumber,
    title: `${epic.id}: ${epic.title}`,
    description: formatMilestoneDescription(epic)
  });

  const milestoneUrl = milestoneResponse.data.html_url;
  console.log('[updateIssues] Milestone #' + milestoneNumber + ' updated successfully');

  console.log('[updateIssues] All issues updated successfully');
  return {
    milestone: {
      number: milestoneNumber,
      title: epic.title,
      url: milestoneUrl
    },
    stories: issues
  };
}

// Update a single story issue on GitHub
async function updateSingleIssue(story) {
  console.log('[updateSingleIssue] Updating story:', story.id);

  if (!story.github_issue_number) {
    throw new Error('Story does not have a GitHub issue number. Cannot update.');
  }

  const body = formatIssueBody(story);
  const response = await octokit.issues.update({
    owner,
    repo,
    issue_number: story.github_issue_number,
    title: `${story.id}: ${story.title}`,
    body
  });

  console.log('[updateSingleIssue] Issue #' + story.github_issue_number + ' updated successfully');
  return {
    number: story.github_issue_number,
    title: story.title,
    url: response.data.html_url
  };
}

async function deleteEpic(milestoneNumber) {
  console.log('[deleteEpic] ========== FUNCTION ENTRY ==========');
  console.log('[deleteEpic] Called with milestone number:', milestoneNumber);
  console.log('[deleteEpic] Milestone number type:', typeof milestoneNumber);
  console.log('[deleteEpic] Using owner:', owner);
  console.log('[deleteEpic] Using repo:', repo);

  try {
    // First, get the milestone to verify it exists
    console.log('[deleteEpic] Step 1: Fetching milestone #' + milestoneNumber + '...');
    const milestone = await octokit.issues.getMilestone({
      owner,
      repo,
      milestone_number: milestoneNumber
    });
    console.log('[deleteEpic] Milestone fetched successfully');
    console.log('[deleteEpic] Milestone title:', milestone.data.title);
    console.log('[deleteEpic] Milestone state:', milestone.data.state);

    // Find all issues assigned to this milestone
    console.log('[deleteEpic] Step 2: Finding issues in milestone...');
    const issuesResponse = await octokit.issues.listForRepo({
      owner,
      repo,
      milestone: milestoneNumber,
      state: 'all'
    });

    const storyIssues = issuesResponse.data;
    console.log('[deleteEpic] Found', storyIssues.length, 'story issues');

    if (storyIssues.length > 0) {
      console.log('[deleteEpic] Story issue numbers:', storyIssues.map(s => '#' + s.number).join(', '));
    }

    // Close all story issues
    console.log('[deleteEpic] Step 3: Closing', storyIssues.length, 'story issues...');
    for (const story of storyIssues) {
      if (story.state === 'open') {
        console.log('[deleteEpic] Closing story issue #' + story.number + ':', story.title);
        const updateResponse = await octokit.issues.update({
          owner,
          repo,
          issue_number: story.number,
          state: 'closed'
        });
        console.log('[deleteEpic] Story issue #' + story.number + ' update response status:', updateResponse.status);
        console.log('[deleteEpic] Story issue #' + story.number + ' new state:', updateResponse.data.state);
      } else {
        console.log('[deleteEpic] Story issue #' + story.number + ' already closed, skipping');
      }
    }

    // Close the milestone
    console.log('[deleteEpic] Step 4: Closing milestone #' + milestoneNumber + '...');
    const milestoneUpdateResponse = await octokit.issues.updateMilestone({
      owner,
      repo,
      milestone_number: milestoneNumber,
      state: 'closed'
    });
    console.log('[deleteEpic] Milestone update response status:', milestoneUpdateResponse.status);
    console.log('[deleteEpic] Milestone new state:', milestoneUpdateResponse.data.state);

    const result = {
      milestone: milestoneNumber,
      storiesClosed: storyIssues.filter(s => s.state === 'open').length
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

async function getMilestone(milestoneNumber) {
  console.log('[getMilestone] Fetching milestone #' + milestoneNumber);
  const milestone = await octokit.issues.getMilestone({
    owner,
    repo,
    milestone_number: milestoneNumber
  });

  // Get issues in this milestone
  const issuesResponse = await octokit.issues.listForRepo({
    owner,
    repo,
    milestone: milestoneNumber,
    state: 'all'
  });

  return {
    title: milestone.data.title,
    state: milestone.data.state,
    issues: issuesResponse.data.map(i => ({
      number: i.number,
      title: i.title,
      state: i.state
    }))
  };
}

// List all open milestones for modal dropdown
async function listOpenMilestones() {
  console.log('[listOpenMilestones] Fetching open milestones...');
  const response = await octokit.issues.listMilestones({
    owner,
    repo,
    state: 'open',
    sort: 'created',
    direction: 'desc'
  });

  console.log('[listOpenMilestones] Found', response.data.length, 'open milestones');
  return response.data.map(m => ({
    number: m.number,
    title: m.title,
    description: m.description,
    open_issues: m.open_issues,
    closed_issues: m.closed_issues
  }));
}

// Fetch milestone details and all its issues
async function fetchMilestoneWithIssues(milestoneNumber) {
  console.log('[fetchMilestoneWithIssues] Fetching milestone #' + milestoneNumber);

  // Fetch milestone
  const milestone = await octokit.issues.getMilestone({
    owner,
    repo,
    milestone_number: milestoneNumber
  });

  // Fetch all issues in milestone
  const issuesResponse = await octokit.issues.listForRepo({
    owner,
    repo,
    milestone: milestoneNumber,
    state: 'all',
    per_page: 100
  });

  console.log('[fetchMilestoneWithIssues] Found', issuesResponse.data.length, 'issues');
  return {
    milestone: milestone.data,
    issues: issuesResponse.data
  };
}

// Parse milestone description back to structured metadata
function parseMilestoneDescription(description) {
  if (!description) {
    return { users: '', problem: '', tech_stack: '' };
  }

  // Try JSON comment first (new format)
  const jsonMatch = description.match(/<!--\s*epic-bot-metadata\s*\n([\s\S]*?)\n-->/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      console.log('[parseMilestoneDescription] Parsed JSON metadata');
      return {
        users: parsed.users || '',
        problem: parsed.problem || '',
        tech_stack: parsed.tech_stack || ''
      };
    } catch (e) {
      console.warn('[parseMilestoneDescription] Failed to parse JSON metadata:', e.message);
    }
  }

  // Fallback: regex parsing (legacy format)
  console.log('[parseMilestoneDescription] Using regex fallback');
  const users = description.match(/\*\*Users:\*\*\s*(.+)/)?.[1]?.trim() || '';
  const techStack = description.match(/\*\*Tech Stack:\*\*\s*(.+)/)?.[1]?.trim() || '';

  // Problem is between "## Overview" and "**Users:**"
  const problemMatch = description.match(/## Overview\s*\n([\s\S]*?)(?=\n\*\*Users:\*\*)/);
  const problem = problemMatch?.[1]?.trim() || '';

  return { users, problem, tech_stack: techStack };
}

// Parse issue body back to story object
function parseIssueToStory(issue) {
  const body = issue.body || '';

  // Extract ID and title from issue title (format: "story-XXX: Title")
  const titleMatch = issue.title.match(/^(story-\d+):\s*(.+)/i);
  const id = titleMatch?.[1] || `story-${String(issue.number).padStart(3, '0')}`;
  const title = titleMatch?.[2] || issue.title;

  // Extract user story (first paragraph, before ## Acceptance Criteria)
  const storyMatch = body.match(/^([\s\S]*?)(?=\n\n## Acceptance Criteria|\n##|$)/);
  const story = storyMatch?.[1]?.trim() || '';

  // Extract acceptance criteria (checkbox items)
  const criteriaSection = body.match(/## Acceptance Criteria\s*\n([\s\S]*?)(?=\n##|$)/);
  const acceptance_criteria = [];
  if (criteriaSection) {
    const matches = criteriaSection[1].matchAll(/- \[[ x]\]\s*(.+)/gi);
    for (const match of matches) {
      acceptance_criteria.push(match[1].trim());
    }
  }

  return {
    id,
    title,
    story,
    acceptance_criteria,
    github_issue_number: issue.number,
    github_issue_url: issue.html_url
  };
}

module.exports = {
  createIssues,
  updateIssues,
  updateSingleIssue,
  deleteEpic,
  fetchReadme,
  getMilestone,
  listOpenMilestones,
  fetchMilestoneWithIssues,
  parseMilestoneDescription,
  parseIssueToStory
};
