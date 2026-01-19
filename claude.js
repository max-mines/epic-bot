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
  let collectingStory = false;

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

    // Match acceptance criteria
    if (line.includes('Acceptance') || line.includes('acceptance')) {
      inAcceptanceCriteria = true;
      collectingStory = false;
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
