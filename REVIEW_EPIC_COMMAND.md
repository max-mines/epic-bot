# /review-epic Command - Feature Summary

## Overview
Added the `/review-epic` slash command to re-run the review process on previously saved epic JSON files.

## Implementation Date
2026-01-20

## How It Works

### Command Usage
```
/review-epic epic-2026-01-20T03-22-56
```

The bot:
1. Loads the epic from `./epics/epic-2026-01-20T03-22-56.json`
2. Creates a new Slack thread
3. Runs the AI review immediately
4. Allows you to address issues, refine, or create GitHub issues

### User Flow

**Step 1: Find Epic ID**
```bash
ls epics/
# epic-2026-01-19T15-30-22.json
# epic-2026-01-20T03-22-56.json
```

**Step 2: Run Command**
```
/review-epic epic-2026-01-20T03-22-56
```

**Step 3: Review & Refine**
```
Bot: 📝 Reviewing epic: "Build social features for riders"

     Running review...

     🔍 Review complete!

     ✅ Good:
     - Clear user value in all story "so that" clauses
     - Acceptance criteria are specific and testable

     ⚠️ Issues:
     - Stories too large - story-002, 003, 004 should split into 2-3 smaller stories
     - Missing: privacy controls (block/report users)
     - Missing: error states (messaging failures, image upload failures)

     Would you like me to address these issues?

     Type `all` to address all issues, or type issue numbers (e.g., `1, 2, 4`) to address specific ones.

     Or: `Y` to create GitHub issues as-is, `refine` for interactive mode.
```

**Step 4: Choose Action**
- Type `all` - Address all 3 issues automatically
- Type `1, 3` - Address only issues 1 and 3
- Type `refine` - Enter interactive story-by-story editing
- Type `Y` - Create GitHub issues as-is

## Implementation Details

### Files Modified

**1. [bot.js:135-200](bot.js#L135-L200)** - New `/review-epic` command handler
```javascript
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
```

**2. [README.md:33-35](README.md#L33-L35)** - Updated Slack app setup
```markdown
5. Navigate to "Slash Commands" and create these commands:
   - `/story` - Description: "Create an epic with user stories"
   - `/review-epic` - Description: "Review an existing epic from saved file (provide epic ID)"
   - `/delete-epic` - Description: "Delete an epic and its stories (provide issue number)"
```

**3. [README.md:172-209](README.md#L172-L209)** - New usage documentation section

### Key Features

✅ **Load from JSON** - Reads epic data from saved files
✅ **Full Session Restoration** - Restores all epic context (title, users, problem, tech stack, stories)
✅ **Immediate Review** - Runs AI review automatically on load
✅ **All Refinement Options** - Access to bulk refinement, interactive mode, or direct GitHub creation
✅ **Error Handling** - Clear error messages for missing files or invalid IDs
✅ **Ephemeral Responses** - Error messages only visible to the user who ran the command

### Epic JSON Structure

The command loads epics from JSON files with this structure:
```json
{
  "id": "epic-2026-01-20T03-22-56",
  "title": "Build social features for riders",
  "created_by": "U1234567890",
  "created_at": "2026-01-20T03:22:56.789Z",
  "users": "motorcycle riders",
  "problem": "riders want to connect with other riders nearby",
  "tech_stack": "React Native, Node.js, MongoDB",
  "stories": [
    {
      "id": "story-001",
      "title": "Rider Profile Creation",
      "story": "As a rider, I want to create a profile...",
      "acceptance_criteria": [
        "Profile includes name, bike, location",
        "Photo upload supported"
      ]
    }
  ]
}
```

## Use Cases

### 1. Re-review Old Epics
You created an epic before the bulk refinement feature was added:
```
/review-epic epic-2026-01-15T10-30-00
```
Now you can use the new `all` or issue number selection features.

### 2. Fresh Review with Context
Get a second opinion after manually editing stories:
```
# Edit epics/epic-2026-01-20T03-22-56.json manually
/review-epic epic-2026-01-20T03-22-56
```

### 3. Iterate on Epic Design
Try different refinements without regenerating from scratch:
```
/review-epic epic-2026-01-20T03-22-56
# Type: all
# Review updated stories
# Type: refine
# Make manual tweaks
# Type: done
```

### 4. Recover from Interrupted Session
Bot crashed or you lost the thread:
```
/review-epic epic-2026-01-20T03-22-56
```
Continue where you left off.

## Error Handling

**Missing Epic ID:**
```
User: /review-epic
Bot: Please provide an epic ID: `/review-epic epic-2026-01-20T03-22-56`

     You can find epic IDs in the `epics/` folder.
```

**Invalid Epic ID:**
```
User: /review-epic does-not-exist
Bot: ❌ Epic file not found: ./epics/does-not-exist.json

     Make sure the epic ID is correct.
```

**Malformed JSON:**
```
User: /review-epic corrupted-file
Bot: ❌ Error loading epic: Unexpected token in JSON at position 42
```

## Integration with Other Features

This command works seamlessly with:
- **Bulk Refinement**: Address review issues with `all` or issue numbers
- **Interactive Refinement**: Use `refine` to edit individual stories
- **GitHub Creation**: Use `Y` to create issues after reviewing
- **Session Management**: Creates a new session in the same format as `/story`

## Limitations

- Only works with locally saved JSON files (not GitHub issues)
- Requires exact epic ID match (file name without `.json`)
- Creates a new thread (doesn't restore the original thread)
- Doesn't restore previous refinement history or review results

## Future Enhancements

Potential improvements:
- [ ] Add `/list-epics` to show all available epic IDs
- [ ] Support loading by GitHub issue number instead of file ID
- [ ] Show last modified date when loading epic
- [ ] Add confirmation prompt before running review
- [ ] Support loading from remote URLs or GitHub Gists
- [ ] Add option to re-generate stories instead of reviewing existing ones
