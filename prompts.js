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

2. [Next story...]

Keep stories small with 1-2 suggested acceptance criteria each. Make acceptance criteria specific and testable. Students will add more criteria later.`;
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

Keep stories small with 1-2 suggested acceptance criteria each.`;
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
- [issue 1]
- [issue 2]

Keep it under 10 lines total.`;
}

module.exports = { storyGeneration, storyRefinement, review };
