 # Bulk Refinement After Review - Feature Summary

## Overview
Added intelligent bulk refinement that automatically addresses issues identified during the AI review process.

## Implementation Date
2026-01-20

## How It Works

### Review Issue Parsing
When the review completes, the bot:
1. Parses the "⚠️ Issues:" section from the review output
2. Numbers each issue (1, 2, 3, etc.)
3. Stores the issues in the session for later reference

### User Interaction

**After Review (with issues):**
```
Bot: 🔍 Review complete!

     ✅ Good:
     - Clear user value in all story "so that" clauses

     ⚠️ Issues:
     - Stories too large - story-002, 003, 004 should split into 2-3 smaller stories
     - Missing: privacy controls (block/report users)
     - Missing: error states (messaging failures)

     Would you like me to address these issues?

     Type `all` to address all issues, or type issue numbers (e.g., `1, 2, 4`) to address specific ones.

     Or: `Y` to create GitHub issues as-is, `refine` for interactive mode.
```

**User Options:**

1. **Address All Issues:**
   ```
   You: all
   Bot: Addressing 3 issue(s)...
        [Regenerates all stories with fixes]
        ✅ Updated stories:
        [Shows updated list with acceptance criteria]

        Create GitHub issues? [Y/n/refine]
   ```

2. **Address Specific Issues:**
   ```
   You: 1, 3
   Bot: Addressing 2 issue(s)...
        [Regenerates stories addressing only issues #1 and #3]
        ✅ Updated stories:
        [Shows updated list]

        Create GitHub issues? [Y/n/refine]
   ```

3. **Skip Bulk Refinement:**
   ```
   You: Y
   Bot: Creating GitHub issues...
        [Creates issues as-is]
   ```

4. **Interactive Refinement:**
   ```
   You: refine
   Bot: 📝 Interactive Refinement Mode
        [Enters story-by-story editing mode]
   ```

## Implementation Details

### Files Modified

**1. [bot.js:657-710](bot.js#L657-L710)** - Enhanced `runReview` function
```javascript
async function runReview(epic, threadTs, client, channelId) {
  // Parse issues from review
  const issuesSection = review.match(/⚠️ Issues:\n((?:- .+\n?)+)/);
  const reviewIssues = [];
  if (issuesSection) {
    const issueLines = issuesSection[1].trim().split('\n');
    issueLines.forEach((line, index) => {
      const issueText = line.replace(/^- /, '').trim();
      if (issueText) {
        reviewIssues.push({ number: index + 1, text: issueText });
      }
    });
  }

  // Store in session
  session.reviewText = review;
  session.reviewIssues = reviewIssues;

  // Dynamic prompt based on whether issues exist
  if (reviewIssues.length > 0) {
    promptText += `Would you like me to address these issues?\n\n...`;
  }
}
```

**2. [bot.js:520-624](bot.js#L520-L624)** - Updated REVIEW_APPROVAL state handler
```javascript
} else if (session.state === 'REVIEW_APPROVAL') {
  const trimmedText = text.trim().toLowerCase();

  // Handle "all" or issue numbers like "1, 2, 4"
  if (trimmedText === 'all' || /^\d+(?:\s*,\s*\d+)*$/.test(trimmedText)) {
    let issuesToAddress = [];

    if (trimmedText === 'all') {
      issuesToAddress = session.reviewIssues || [];
    } else {
      const selectedNumbers = trimmedText.split(',').map(n => parseInt(n.trim()));
      issuesToAddress = reviewIssues.filter(issue =>
        selectedNumbers.includes(issue.number)
      );
    }

    // Build feedback from selected issues
    const issuesList = issuesToAddress.map(issue => `- ${issue.text}`).join('\n');
    session.feedback = `Address the following issues from the review:\n${issuesList}`;

    // Trigger bulk refinement
    const updatedStories = await refineStories(session);
    // ... update session and epic file
  }
}
```

**3. [prompts.js:26-44](prompts.js#L26-L44)** - Enhanced `storyRefinement` prompt
```javascript
function storyRefinement(session) {
  const existingStories = session.stories.map((s, i) =>
    `${i + 1}. ${s.title}\n   ${s.story}\n   Acceptance Criteria:\n${s.acceptance_criteria.map(c => `   - ${c}`).join('\n')}`
  ).join('\n\n');

  return `You previously generated these stories:

${existingStories}

The user wants changes: "${session.feedback}"

Generate the updated list of stories in the same format...
Keep stories small with 1-2 suggested acceptance criteria each. Make sure stories are focused, testable, and address all the requested changes.`;
}
```

### Key Features

✅ **Automatic Issue Parsing** - Extracts and numbers issues from review output
✅ **Selective Addressing** - Users can address all or specific issues
✅ **Context-Aware Refinement** - Passes selected issues as feedback to Claude
✅ **Preserved Acceptance Criteria** - Shows full story details in refinement prompt
✅ **Flexible Flow** - Users can still skip bulk refinement and use interactive mode
✅ **Clear UX** - Explicit instructions on available options

### Issue Selection Format

The bot accepts:
- `all` - Addresses all issues from the review
- `1` - Addresses only issue #1
- `1, 3` - Addresses issues #1 and #3
- `1,2,4` - Addresses issues #1, #2, and #4 (spaces optional)
- `1, 2, 3, 4, 5` - Addresses multiple issues

Regex pattern: `/^\d+(?:\s*,\s*\d+)*$/`

### Error Handling

If user selects invalid issue numbers:
```
Bot: ❌ No valid issues selected. Please try again or type `Y` to create GitHub issues as-is.
```

## Use Cases

1. **Quick Fixes After Review**
   - Review identifies issues
   - Type "all" to fix everything automatically
   - One-shot refinement without manual editing

2. **Partial Refinement**
   - Review finds 5 issues
   - Only 2 are urgent (e.g., missing error handling)
   - Type "2, 5" to address only those
   - Accept remaining issues for later

3. **Manual Override**
   - Don't want AI to fix issues automatically
   - Type "refine" to enter interactive mode
   - Manually edit specific stories one by one

## Benefits Over Previous Approach

**Before:**
- User had to type: "Address the issues you pointed out. Split stories 2, 3, and 4..."
- Required retyping review feedback
- Easy to forget specific issues
- No way to selectively address issues

**After:**
- Type "all" or "1, 2" - two words max
- Bot remembers exact issues from review
- Can selectively address specific issues
- Clear, guided workflow

## Future Enhancements

Potential improvements:
- [ ] Show issue count in prompt: "3 issues found"
- [ ] Add "none" option to skip all issues explicitly
- [ ] Allow issue ranges: "1-3" to address issues 1, 2, and 3
- [ ] Preview which stories will be affected before applying changes
- [ ] Track which issues were addressed vs. skipped
