const Anthropic = require('@anthropic-ai/sdk');
const prompts = require('./prompts');

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function generateStories(session) {
  // TODO: Add retry logic for API failures
  // TODO: Track token usage and costs per epic
  const prompt = prompts.storyGeneration(session);

  console.log('[generateStories] Calling Claude API...');
  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: prompt
    }]
  });

  const text = response.content[0].text;
  console.log('[generateStories] Claude response length:', text.length);
  console.log('[generateStories] Claude response (first 500 chars):', text.substring(0, 500));

  const stories = parseStories(text);
  console.log('[generateStories] Parsed', stories.length, 'stories');
  return stories;
}

async function refineStories(session) {
  const prompt = prompts.storyRefinement(session);

  console.log('[refineStories] Calling Claude API...');
  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: prompt
    }]
  });

  const text = response.content[0].text;
  console.log('[refineStories] Claude response length:', text.length);
  console.log('[refineStories] Claude response (first 500 chars):', text.substring(0, 500));

  const stories = parseStories(text);
  console.log('[refineStories] Parsed', stories.length, 'stories');
  return stories;
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
  // TODO: Improve parsing to handle edge cases and malformed responses
  // TODO: Add validation to ensure all stories have required fields
  console.log('[parseStories] Starting parse, text length:', text.length);

  // Simple parsing - look for numbered stories
  const stories = [];
  const lines = text.split('\n');
  console.log('[parseStories] Total lines:', lines.length);

  let currentStory = null;
  let inAcceptanceCriteria = false;
  let collectingStory = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match story number in multiple formats:
    // "1. Title" or "**1. Title**" or "## 1. Title" or "[1. Title]"
    const titleMatch = line.match(/^(?:##\s*)?\*?\*?\[?(\d+)\.\s*\]?\*?\*?(.+)/);
    if (titleMatch) {
      console.log('[parseStories] Found story title at line', i + ':', line);
      if (currentStory) {
        console.log('[parseStories] Pushing previous story:', currentStory.id);
        stories.push(currentStory);
      }
      currentStory = {
        id: `story-${String(titleMatch[1]).padStart(3, '0')}`,
        title: titleMatch[2].replace(/\*\*/g, '').replace(/^[\[\]]/g, '').trim(),
        story: '',
        acceptance_criteria: []
      };
      inAcceptanceCriteria = false;
      collectingStory = false;
      continue;
    }

    // Match "As a..." pattern
    if (line.trim().startsWith('As a') || line.trim().startsWith('As an')) {
      if (currentStory) {
        currentStory.story = line.trim();
        collectingStory = true;
      }
      continue;
    }

    // Continue collecting story (for "I want..." and "so that..." lines)
    if (collectingStory && currentStory && line.trim().length > 0 && !line.includes('Acceptance') && !line.trim().startsWith('-')) {
      currentStory.story += ' ' + line.trim();
      continue;
    }

    // Match acceptance criteria header (optional - we can also collect criteria without it)
    if (line.includes('Acceptance') || line.includes('acceptance')) {
      inAcceptanceCriteria = true;
      collectingStory = false;
      continue;
    }

    // Match criteria items: "- [ ] ..." or just "- ..."
    // If we have a current story and see a dash line, treat it as acceptance criteria
    if (currentStory) {
      const criteriaMatch = line.match(/^\s*-\s*(?:\[\s*\]\s*)?(.+)/);
      if (criteriaMatch) {
        // Once we see a criteria item, we're in acceptance criteria mode
        inAcceptanceCriteria = true;
        collectingStory = false;
        currentStory.acceptance_criteria.push(criteriaMatch[1].trim());
      }
    }
  }

  if (currentStory) {
    console.log('[parseStories] Pushing final story:', currentStory.id);
    stories.push(currentStory);
  }

  console.log('[parseStories] Finished parsing. Total stories:', stories.length);
  if (stories.length === 0) {
    console.error('[parseStories] WARNING: No stories parsed! First 1000 chars of text:');
    console.error(text.substring(0, 1000));
  }

  return stories;
}

async function refineSingleStory(story, userRequest, epicContext) {
  const prompt = prompts.singleStoryRefinement(story, userRequest, epicContext);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: prompt
    }]
  });

  const text = response.content[0].text;
  return parseSingleStory(text);
}

function parseSingleStory(text) {
  const lines = text.split('\n');
  const story = {
    title: '',
    story: '',
    acceptance_criteria: []
  };

  let inAcceptanceCriteria = false;
  let collectingStory = false;

  for (let line of lines) {
    // Match "Title: ..."
    const titleMatch = line.match(/^Title:\s*(.+)/i);
    if (titleMatch) {
      story.title = titleMatch[1].trim();
      continue;
    }

    // Match "Story: ..." or "As a..."
    const storyMatch = line.match(/^Story:\s*(.+)/i);
    if (storyMatch) {
      story.story = storyMatch[1].trim();
      collectingStory = true;
      continue;
    }

    // Match "As a..." pattern (in case it's on its own line)
    if (line.trim().startsWith('As a') || line.trim().startsWith('As an')) {
      story.story = line.trim();
      collectingStory = true;
      continue;
    }

    // Continue collecting story (for "I want..." and "so that..." lines)
    if (collectingStory && line.trim().length > 0 && !line.includes('Acceptance') && !line.trim().startsWith('-')) {
      story.story += ' ' + line.trim();
      continue;
    }

    // Match acceptance criteria header
    if (line.match(/^Acceptance Criteria:/i)) {
      inAcceptanceCriteria = true;
      collectingStory = false;
      continue;
    }

    // Match criteria items: "- ..."
    if (inAcceptanceCriteria) {
      const criteriaMatch = line.match(/^\s*-\s*(?:\[\s*\]\s*)?(.+)/);
      if (criteriaMatch) {
        story.acceptance_criteria.push(criteriaMatch[1].trim());
      }
    }
  }

  return story;
}

module.exports = { generateStories, refineStories, reviewEpic, refineSingleStory };
