function storyGeneration(session) {
  const repoContextSection = session.repoContext
    ? `\n\nRepository Context (from README.md):\n${session.repoContext.substring(0, 3000)}\n`
    : '';

  return `You are helping students create user stories for their project.

Epic: ${session.description}
Users: ${session.answers.users}
Problem: ${session.answers.problem}
Tech Stack: ${session.answers.techStack}${repoContextSection}

Generate 4-6 user stories that break down this epic. Use the repository context above to ensure stories align with the existing project structure, conventions, and goals.

Format each story exactly like this:
1. [Title]
   As a [user], I want to [action] so that [benefit]
   - [acceptance criterion 1]
   - [acceptance criterion 2]

2. [Next story...]

Keep stories small with 1-2 suggested acceptance criteria each. Make acceptance criteria specific and testable. Students will add more criteria later.`;
}

function storyRefinement(session) {
  const existingStories = session.stories.map((s, i) =>
    `${i + 1}. ${s.title}\n   ${s.story}\n   Acceptance Criteria:\n${s.acceptance_criteria.map(c => `   - ${c}`).join('\n')}`
  ).join('\n\n');

  return `You previously generated these stories:

${existingStories}

The user wants changes: "${session.feedback}"

Generate the updated list of stories in the same format:
1. [Title]
   As a [user], I want to [action] so that [benefit]
   - [acceptance criterion 1]
   - [acceptance criterion 2]
   - [acceptance criterion 3]
   - [acceptance criterion 4]

Keep stories small with 3-4 suggested acceptance criteria each. Make sure stories are focused, testable, and address all the requested changes.`;
}

function review(epic) {
  return `Review this epic for quality. Keep feedback brief and actionable.

Epic: ${JSON.stringify(epic, null, 2)}

Check:
1. Are stories small and focused?
2. Do stories have clear user value? ("so that" clause)
3. Are there obvious missing stories? (error handling, edge cases)
4. Are the suggested acceptance criteria (1-2 per story) specific and testable?

Format your response as:
✅ Good:
- [what's good]

⚠️ Issues:
1. [issue 1]
2. [issue 2]
3. [issue 3]

IMPORTANT: Number the issues (1, 2, 3, etc.) instead of using bullet points (-).

Keep it under 10 lines total.`;
}

function singleStoryRefinement(story, userRequest, epicContext) {
  return `You are helping refine a user story.

Epic context: ${epicContext.description}
Users: ${epicContext.users}
Problem: ${epicContext.problem}
Tech Stack: ${epicContext.techStack}

Current story:
Title: ${story.title}
Story: ${story.story}
Acceptance Criteria:
${story.acceptance_criteria.map(c => `- ${c}`).join('\n')}

User request: "${userRequest}"

Provide the updated story in this exact format:
Title: [updated title]
Story: [As a user, I want to... so that...]
Acceptance Criteria:
- [criterion 1]
- [criterion 2]
- [criterion 3]

Keep it focused and testable.`;
}

module.exports = { storyGeneration, storyRefinement, review, singleStoryRefinement };
